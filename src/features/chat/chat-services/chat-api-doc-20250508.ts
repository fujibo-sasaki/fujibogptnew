import { userHashedId } from "@/features/auth/helpers";
import { OpenAIInstance } from "@/features/common/openai";
import { AI_NAME } from "@/features/theme/customise";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { similaritySearchVectorWithScore } from "./azure-cog-search/azure-cog-vector-store";
import { initAndGuardChatSession } from "./chat-thread-service";
import { CosmosDBChatMessageHistory } from "./cosmosdb/cosmosdb";
import { PromptGPTProps } from "./models";

// Enhanced system prompt with more detailed instructions
const SYSTEM_PROMPT = `あなたは ${AI_NAME} です。高い専門性と親しみやすさを兼ね備えた日本語アシスタントとして以下の指針に従って回答します：

1. ユーザーの質問に対して、正確で具体的な情報を提供します
2. 専門用語を使う場合は、分かりやすく説明を加えます
3. 回答は簡潔に、かつ十分な情報量を含めて構成します
4. 回答に自信がない場合は、その旨を正直に伝えます
5. 文脈に応じて、丁寧な言葉遣い（です・ます調）を基本としつつ、自然な会話の流れを大切にします
6. 検索結果から得られた情報には必ず出典を明記します

与えられた文脈情報を分析し、最も関連性の高い情報を優先して回答を組み立ててください。`;

// Query reformulation prompt
const QUERY_REFORMULATION_PROMPT = `
あなたはAI検索エンジンのための質問最適化スペシャリストです。
ユーザーの元の質問を分析し、以下の点を考慮してより効果的な検索クエリに書き換えてください：

1. 曖昧な表現や口語的な表現を明確で検索に適した表現に変換する
2. 検索に不要な言葉を削除する
3. 検索に有効な専門用語やキーワードを抽出・強調する
4. 質問の意図や文脈を保持しつつ、簡潔なフォーマットにする
5. 日本語での検索最適化を行う

元のユーザー質問: {userQuestion}

最適化された検索クエリを以下の形式で出力してください：
OPTIMIZED_QUERY: [最適化されたクエリ]
`;

// Enhanced context prompt with better instructions
const CONTEXT_PROMPT = ({
  context,
  userQuestion,
}: {
  context: string;
  userQuestion: string;
}) => {
  return `
# 検索コンテキストと質問

## 指示
- 以下に提供された文書の抜粋を基に、ユーザーの質問に対する包括的な回答を作成してください。
- 提供された文脈の情報のみを使用してください。文脈にない情報については「その情報は提供された文脈には含まれていません」と正直に伝えてください。
- 回答は論理的に構成し、最も重要な情報から順に提示してください。
- 回答の最後には必ず出典を含めてください。出典は以下の形式で記載してください: {% citation items=[{name:"ファイル名",id:"ファイルID"}, ...] /%}
- 複数の文書から情報を統合する場合は、どの情報がどの文書から来ているか明確に示してください。

## 検索コンテキスト
${context}

## ユーザーの質問
${userQuestion}
`;
};

export const ChatAPIDoc = async (props: PromptGPTProps) => {
  const { lastHumanMessage, id, chatThread } = await initAndGuardChatSession(
    props
  );

  const openAI = OpenAIInstance();

  const userId = await userHashedId();
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
  // 最適なコンテキストウィンドウを維持するため、最新の20メッセージのみを使用
  const topHistory = history.slice(Math.max(0, history.length - 20), history.length);

  // Step 1: ユーザークエリを最適化
  const optimizedQuery = await reformulateQuery(lastHumanMessage.content, openAI, chatAPIModel);
  
  // Step 2: 最適化されたクエリを使用して関連ドキュメントを検索
  const relevantDocuments = await findRelevantDocuments(
    optimizedQuery,
    id
  );

  // 検索結果の前処理とフォーマット
  const context = processSearchResults(relevantDocuments);

  try {
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
          }),
        },
      ],
      model: chatAPIModel,
      stream: true,
      // GPT-4o-miniに最適化されたパラメータ
      temperature: 0.7,
      max_tokens: 800,
      top_p: 0.9,
    });

    const stream = OpenAIStream(response, {
      async onCompletion(completion) {
        // ユーザーの元の質問を保存
        await chatHistory.addMessage({
          content: lastHumanMessage.content,
          role: "user",
        });

        // AIの回答を保存（コンテキスト情報も添付）
        await chatHistory.addMessage(
          {
            content: completion,
            role: "assistant",
          },
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
 * ユーザーの質問を分析し、検索に最適化されたクエリに書き換える
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
      temperature: 0.3, // 低い温度で一貫性のある結果を得る
      max_tokens: 200,
    });

    const content = response.choices[0].message.content || "";
    const match = content.match(/OPTIMIZED_QUERY:\s*(.+)/);
    
    if (match && match[1]) {
      // 最適化されたクエリを取得
      return match[1].trim();
    }
    
    // 最適化に失敗した場合は元のクエリを返す
    console.log("Query reformulation failed, using original query");
    return originalQuery;
  } catch (error) {
    console.error("Error in query reformulation:", error);
    // エラーが発生した場合は元のクエリを返す
    return originalQuery;
  }
};

/**
 * 検索結果を処理して人間が読みやすい形式にフォーマットする
 */
const processSearchResults = (documents: any[]): string => {
  if (!documents || documents.length === 0) {
    return "関連する情報は見つかりませんでした。";
  }

  return documents
    .map((result, index) => {
      // 改行や余分なスペースを適切に処理
      const content = result.pageContent
        .replace(/(\r\n|\n|\r)/gm, " ")
        .replace(/\s+/g, " ")
        .trim();
      
      // メタデータが存在するか確認
      const fileName = result.metadata || "不明なファイル";
      const fileId = result.id || "不明なID";
      
      // セクションとして明確に区切られた形式でコンテキストを構築
      return `### セクション ${index + 1}
ファイル名: ${fileName}
ファイルID: ${fileId}
内容:
${content}`;
    })
    .join("\n\n----------\n\n");
};

/**
 * 最適化されたクエリを使用して関連ドキュメントを検索
 */
const findRelevantDocuments = async (query: string, chatThreadId: string) => {
  const userId = await userHashedId();
  const filter = `chatType eq 'data'`;
  
  try {
    // 関連度スコアに基づいて上位10件のドキュメントを取得
    const relevantDocuments = await similaritySearchVectorWithScore(query, 10, {
      filter: filter,
    });
    
    return relevantDocuments;
  } catch (error) {
    console.error("Error in document search:", error);
    return [];
  }
};