import { userHashedId } from "@/features/auth/helpers";
import { OpenAIInstance } from "@/features/common/openai";
import { AI_NAME } from "@/features/theme/customise";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { initAndGuardChatSession } from "./chat-thread-service";
import { CosmosDBChatMessageHistory } from "./cosmosdb/cosmosdb";
import { FAQAIProjectsSearchResult } from "./Azure-bing-search/faq-ai-projects";
import { PromptGPTProps } from "./models";

// 権限タイプ定義
export type ChatAuth = "Excective" | "Manager" | "Employee" | "Contract";

// 拡張されたシステムプロンプト
const SYSTEM_PROMPT = `あなたは ${AI_NAME} です。企業内FAQ検索アシスタントとして、以下の指針に従って対応します：

1. 正確性：FAQ AgentとAzure AI Searchから得られた情報のみを回答に含め、推測や想像は避けます
2. 明確性：専門用語を使う場合は解説を付け、分かりやすい表現を心がけます
3. 構造化：重要な情報から順に論理的に情報を提示します
4. 透明性：情報源を明示し、複数のFAQから情報を取得した場合は出典を区別して示します
5. 適切な範囲：ユーザーの権限レベルに応じた情報のみを提供します
6. 丁寧さ：敬語を用い、プロフェッショナルな対応を維持します
7. 統合性：FAQ Agentの結果とAzure AI Searchの結果を統合して、包括的な回答を提供します

回答できない内容については、「その情報は提供されたFAQには含まれていません」と率直に伝えてください。
常に回答の最後には情報源の引用を必ず含めてください。`;

export const ChatAPIDoc = async (props: PromptGPTProps) => {
  const { lastHumanMessage, id, chatThread } = await initAndGuardChatSession(
    props
  );

  const openAI = OpenAIInstance();
  const userId = await userHashedId();

  // ユーザーの権限情報を取得（実際の実装に合わせて修正が必要）
  const userRole = "Employee" as ChatAuth;

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
    // クエリ最適化
    const optimizedQuery = await reformulateQuery(
      lastHumanMessage.content,
      openAI,
      chatAPIModel
    );

    console.log('Original query:', lastHumanMessage.content);
    console.log('Optimized query:', optimizedQuery);

    // Initialize FAQ AI Projects Search with error handling
    console.log('\n=== FAQ SEARCH DEBUG START ===');
    console.log(`Search Query: ${optimizedQuery}`);
    console.log('Creating FAQAIProjectsSearchResult instance...');
    
    const faqAIProjects = new FAQAIProjectsSearchResult();
    let faqSearchContent = '';
    let citations: Array<{title: string; url: string; snippet?: string; domain?: string}> = [];
    let searchResults: Array<{title: string; url: string; snippet: string; domain: string}> = [];

    try {
      console.log('Calling faqAIProjects.SearchFAQ...');
      const searchResult = await faqAIProjects.SearchFAQ(optimizedQuery);
      
      if (searchResult.answer) {
        // Agentのレスポンスをそのまま使用し、重複する情報を避ける
        faqSearchContent = `
使用した検索クエリ: "${searchResult.searchQuery}"

FAQ AI Projects Agent検索結果:
${searchResult.answer}`;
        
        citations = searchResult.citations || [];
        searchResults = searchResult.searchResults || [];
        
        // Azure AI Searchの結果も追加
        if (searchResult.azureSearchResults && searchResult.azureSearchResults.length > 0) {
          console.log(`Found ${searchResult.azureSearchResults.length} Azure AI Search results`);
        }
      }
    } catch (error) {
      console.error('FAQ AI Projects search failed:', error);
      faqSearchContent = `
FAQ検索でエラーが発生しました。既存の知識ベースに基づいて回答いたします。

エラー詳細: ${error instanceof Error ? error.message : 'Unknown error'}

環境変数の設定を確認してください:
- AZURE_FAQ_PROJECT_URL: ${process.env.AZURE_FAQ_PROJECT_URL ? `設定済み (${process.env.AZURE_FAQ_PROJECT_URL})` : '未設定'}
- AZURE_FAQ_ASSISTANT_ID: ${process.env.AZURE_FAQ_ASSISTANT_ID ? `設定済み (${process.env.AZURE_FAQ_ASSISTANT_ID})` : '未設定'}
`;
    }

    // Add user message to chat history
    await chatHistory.addMessage({
      content: lastHumanMessage.content,
      role: "user"
    } as any);

    // Construct prompt
    const prompt = `
以前の会話の文脈:
${topHistory.map(msg => `${msg.role}: ${msg.content}`).join("\n")}

最新の問い合わせ: ${lastHumanMessage.content}

${faqSearchContent}

上記の会話の文脈${faqSearchContent ? 'とFAQ Agent検索結果' : ''}を踏まえて、最新の質問に対して包括的かつ情報豊富な回答を生成してください。

Agentのレスポンスに既にURLや参考文献が含まれている場合は、重複して追加しないでください。
AgentのレスポンスにURLや参考文献が含まれていない場合のみ、以下の形式でMarkdown形式のリストを追加してください：

${citations.length > 0 || searchResults.length > 0 ? `
### 参考文献
${citations.map(citation => `- [${citation.title || citation.domain || 'FAQドキュメント'}](${citation.url})`).join('\n')}
${searchResults.length > 0 ? `
### 検索で見つかったFAQドキュメント
${searchResults.map((result, index) => `- [${result.title}](${result.url}) - ${result.domain}`).join('\n')}` : ''}
` : ''}`;

    // Create OpenAI chat completion
    const response = await openAI.chat.completions.create({
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        ...topHistory,
        {
          role: "user",
          content: prompt
        }
      ],
      model: chatAPIModel,
      stream: true,
      max_tokens: 4000,
      temperature: 0.7
    });

    // Stream the response
    const stream = OpenAIStream(response as any, {
      async onCompletion(completion) {
        await chatHistory.addMessage({
          content: completion,
          role: "assistant"
        } as any);
      }
    });

    return new StreamingTextResponse(stream);

  } catch (error) {
    console.error('ChatAPIDoc error:', error);
    return new Response(
      error instanceof Error ? error.message : "An unknown error occurred.",
      {
        status: 500,
        statusText: error instanceof Error ? error.toString() : "Unknown Error"
      }
    );
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
    const reformulationPrompt = `
あなたは企業内FAQ検索のための質問最適化スペシャリストです。
ユーザーの質問を分析し、以下の点を考慮して検索に最適化されたクエリに書き換えてください：

1. 業務FAQ検索に適したキーワードを抽出する
2. 曖昧な表現を具体的な検索語に変換する
3. 同義語や関連語を考慮して検索範囲を適切に拡張する
4. 検索ノイズになる不要な言葉を削除する
5. 日本語FAQ文書に特化した検索最適化を行う

元のユーザー質問: ${originalQuery}

最適化された検索クエリを以下の形式で出力してください：
OPTIMIZED_QUERY: [最適化されたクエリ]
`;

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