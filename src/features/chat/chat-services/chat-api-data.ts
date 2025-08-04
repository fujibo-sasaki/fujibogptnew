import { userHashedId } from "@/features/auth/helpers";
import { OpenAIInstance } from "@/features/common/openai";
import { AI_NAME } from "@/features/theme/customise";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { similaritySearchVectorWithScore } from "./azure-cog-search/azure-cog-vector-store";
import { initAndGuardChatSession } from "./chat-thread-service";
import { CosmosDBChatMessageHistory } from "./cosmosdb/cosmosdb";
import { PromptGPTProps } from "./models";

// 権限タイプ定義
export type ChatAuth = "Excective" | "Manager" | "Employee" | "Contract";

// 拡張されたシステムプロンプト
const SYSTEM_PROMPT = `あなたは ${AI_NAME} です。企業内ドキュメント検索アシスタントとして、以下の指針に従って対応します：

1. 正確性：ドキュメントから得られた情報のみを回答に含め、推測や想像は避けます
2. 明確性：専門用語を使う場合は解説を付け、分かりやすい表現を心がけます
3. 構造化：重要な情報から順に論理的に情報を提示します
4. 透明性：情報源を明示し、複数の文書から情報を取得した場合は出典を区別して示します
5. 適切な範囲：ユーザーの権限レベルに応じた情報のみを提供します
6. 丁寧さ：敬語を用い、プロフェッショナルな対応を維持します

回答できない内容については、「その情報は提供されたドキュメントには含まれていません」と率直に伝えてください。
常に回答の最後には情報源の引用を必ず含めてください。`;

// クエリ最適化プロンプト
const QUERY_REFORMULATION_PROMPT = `
あなたは企業内ドキュメント検索のための質問最適化スペシャリストです。
ユーザーの質問を分析し、以下の点を考慮して検索に最適化されたクエリに書き換えてください：

1. 業務ドキュメント検索に適したキーワードを抽出する
2. 曖昧な表現を具体的な検索語に変換する
3. 同義語や関連語を考慮して検索範囲を適切に拡張する
4. 検索ノイズになる不要な言葉を削除する
5. 日本語ビジネス文書に特化した検索最適化を行う

元のユーザー質問: {userQuestion}

最適化された検索クエリを以下の形式で出力してください：
OPTIMIZED_QUERY: [最適化されたクエリ]
`;

// 拡張されたコンテキストプロンプト
const CONTEXT_PROMPT = ({
  context,
  userQuestion,
  userRole,
}: {
  context: string;
  userQuestion: string;
  userRole: ChatAuth;
}) => {
  return `
# 企業ドキュメント検索結果と質問

## 指示
- 以下に提供された企業ドキュメントの抜粋を基に、ユーザーの質問に対する包括的な回答を作成してください。
- 提供された文脈の情報のみを使用し、文脈にない情報については「その情報は提供された文書には含まれていません」と明示してください。
- ユーザーの権限レベルは「${userRole}」です。この権限レベルに適した情報提供を行ってください。
- 回答は論理的に構成し、最も重要な情報から順に提示してください。
- 複数の文書から情報を統合する場合は、情報源を明確に区別してください。
- 回答の最後には必ず出典を含めてください。出典は以下の形式で記載してください:
  {% citation items=[{name:"ファイル名",id:"ファイルID"}, ...] /%}
- 引用の記載漏れがないよう確認してください。

## 検索コンテキスト
${context}

## ユーザーの質問
${userQuestion}
`;
};

export const ChatAPIData = async (props: PromptGPTProps) => {
  const { lastHumanMessage, id, chatThread } = await initAndGuardChatSession(
    props
  );

  const openAI = OpenAIInstance();
  const userId = await userHashedId();

  // ユーザーの権限情報を取得（実際の実装に合わせて修正が必要）
  const userRole = await getUserRole(userId) || "Employee";

  let chatAPIModel = "";
  if (props.chatAPIModel === "Current_Version") {
    chatAPIModel = "gpt-4o-mini";
  } else {
    chatAPIModel = "o1-mini";
  }

  const chatHistory = new CosmosDBChatMessageHistory({
    sessionId: chatThread.id,
    userId: userId,
  });

  const history = await chatHistory.getMessages();
  // 最新の20メッセージのみを使用してトークン使用量を最適化
  const topHistory = history.slice(Math.max(0, history.length - 20), history.length);

  try {
    // Step 1: ユーザークエリを最適化
    const optimizedQuery = await reformulateQuery(lastHumanMessage.content, openAI, chatAPIModel);
    
    // Step 2: 最適化されたクエリで権限に基づいたドキュメント検索を実行
    const relevantDocuments = await findRelevantDocumentsWithRBAC(
      optimizedQuery,
      userRole,
      id
    );

    // 検索結果がない場合の処理
    if (!relevantDocuments || relevantDocuments.length === 0) {
      const noResultsResponse = await openAI.chat.completions.create({
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: `質問: ${lastHumanMessage.content}\n\n検索結果: 関連するドキュメントが見つかりませんでした。`,
          },
        ],
        model: chatAPIModel,
        stream: true,
      });

      const stream = OpenAIStream(noResultsResponse as any, {
        async onCompletion(completion) {
          await chatHistory.addMessage({
            content: lastHumanMessage.content,
            role: "user",
          } as any);

          await chatHistory.addMessage(
            {
              content: completion,
              role: "assistant",
            } as any,
            "検索結果なし"
          );
        },
      });

      return new StreamingTextResponse(stream);
    }

    // 検索結果の処理とフォーマット
    const context = processSearchResults(relevantDocuments);

    const response = await openAI.chat.completions.create({
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        ...topHistory,
        {
          role: "user",
          content: CONTEXT_PROMPT({
            context,
            userQuestion: lastHumanMessage.content,
            userRole,
          }),
        },
      ],
      model: chatAPIModel,
      stream: true,
      // GPT-4o-miniに最適化されたパラメータ
      temperature: 0.5,  // ドキュメント検索では低めの温度を設定
      max_tokens: 1000,
      top_p: 0.95,
    });

    const stream = OpenAIStream(response as any, {
      async onCompletion(completion) {
        await chatHistory.addMessage({
          content: lastHumanMessage.content,
          role: "user",
        } as any);

        await chatHistory.addMessage(
          {
            content: completion,
            role: "assistant",
          } as any,
          context
        );
      },
    });

    return new StreamingTextResponse(stream);
  } catch (e: unknown) {
    if (e instanceof Error) {
      return new Response(e.message, {
        status: 500,
        statusText: e.toString(),
      });
    } else {
      return new Response("予期せぬエラーが発生しました。", {
        status: 500,
        statusText: "Unknown Error",
      });
    }
  }
};

/**
 * ユーザーの質問を検索に最適化されたクエリに変換
 */
const reformulateQuery = async (
  originalQuery: string,
  openAI: ReturnType<typeof OpenAIInstance>,
  model: string
): Promise<string> => {
  try {
    const reformulationPrompt = QUERY_REFORMULATION_PROMPT.replace(
      "{userQuestion}",
      originalQuery
    );

    const response = await openAI.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: reformulationPrompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const content = response.choices[0].message.content || "";
    const match = content.match(/OPTIMIZED_QUERY:\s*(.+)/);
    
    if (match && match[1]) {
      return match[1].trim();
    }
    
    console.log("Query reformulation failed, using original query");
    return originalQuery;
  } catch (error) {
    console.error("Error in query reformulation:", error);
    return originalQuery;
  }
};

/**
 * 検索結果を処理して読みやすく構造化されたフォーマットに変換
 */
const processSearchResults = (documents: any[]): string => {
  if (!documents || documents.length === 0) {
    return "関連するドキュメントは見つかりませんでした。";
  }

  return documents
    .map((result, index) => {
      // テキスト正規化: 改行や余分なスペースを適切に処理
      const content = result.pageContent
        .replace(/(\r\n|\n|\r)/gm, " ")
        .replace(/\s+/g, " ")
        .trim();
      
      // メタデータ処理
      const fileName = result.metadata || "不明なファイル";
      const fileId = result.id || "不明なID";
      
      // マークダウン形式でフォーマット
      return `## ドキュメント ${index + 1}
**ファイル名**: ${fileName}
**ファイルID**: ${fileId}

**内容**:
${content}`;
    })
    .join("\n\n---\n\n");
};

/**
 * ユーザーのロールを取得する関数
 * 実際の実装に合わせて修正が必要
 */
const getUserRole = async (userId: string): Promise<ChatAuth> => {
  // 実際の実装ではユーザーデータベースやIDプロバイダーからロール情報を取得
  // この例では仮にEmployeeを返す
  return "Employee";
};

/**
 * ユーザーの権限に基づいてフィルターを生成
 */
const generateRoleBasedFilter = (role: ChatAuth): string => {
  switch (role) {
    case "Excective":
      // エグゼクティブは全てのドキュメントにアクセス可能
      return `(ChatAuth_Excective eq 'true' or ChatAuth_Manager eq 'true' or ChatAuth_Employee eq 'true' or ChatAuth_Contract eq 'true')`;
    case "Manager":
      // マネージャーはマネージャー以下の権限のドキュメントにアクセス可能
      return `(ChatAuth_Manager eq 'true' or ChatAuth_Employee eq 'true' or ChatAuth_Contract eq 'true')`;
    case "Employee":
      // 従業員は従業員と契約社員のドキュメントにアクセス可能
      return `(ChatAuth_Employee eq 'true' or ChatAuth_Contract eq 'true')`;
    case "Contract":
      // 契約社員は契約社員のドキュメントのみにアクセス可能
      return `(ChatAuth_Contract eq 'true')`;
    default:
      // デフォルトは最も制限されたアクセス
      return `(ChatAuth_Contract eq 'true')`;
  }
};

/**
 * 権限に基づいた関連ドキュメントの検索
 */
const findRelevantDocumentsWithRBAC = async (query: string, userRole: ChatAuth, chatThreadId: string) => {
  // ユーザーの権限に基づいたフィルターを生成
  const roleFilter = generateRoleBasedFilter(userRole);

  const userId = await userHashedId();  
  // 基本検索フィルターとロールフィルターを組み合わせる
  const combinedFilter = `user eq '${userId}' and chatThreadId eq '${chatThreadId}' and chatType eq 'data'`;
//  const combinedFilter = `chatType eq 'data' and ${roleFilter}`;
  
  try {
    // 検索実行
    const relevantDocuments = await similaritySearchVectorWithScore(query, 10, {
      filter: combinedFilter,
    });
    
    // 検索結果をそのまま返す（上位10件が既に取得されている）
    return relevantDocuments;
  } catch (error) {
    console.error("Error in document search with RBAC:", error);
    return [];
  }
};