import { userHashedId } from "@/features/auth/helpers";
import { OpenAIInstance } from "@/features/common/openai";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { initAndGuardChatSession } from "./chat-thread-service";
import { CosmosDBChatMessageHistory } from "./cosmosdb/cosmosdb";
import { BingAIProjectsSearchResult } from "./Azure-bing-search/bing-ai-projects";
import { PromptGPTProps } from "./models";

export const ChatAPIWeb = async (props: PromptGPTProps) => {
  try {
    // Destructure and initialize variables
    const { lastHumanMessage, chatThread } = await initAndGuardChatSession(props);
    const openAI = OpenAIInstance();
    const userId = await userHashedId();

    // Initialize chat history
    const chatHistory = new CosmosDBChatMessageHistory({
      sessionId: chatThread.id,
      userId: userId,
    });

    // Get recent chat history
    const history = await chatHistory.getMessages();
    const topHistory = history.slice(-50);

    // Generate search query using GPT-4o
    const searchQueryResponse = await openAI.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `あなたは検索クエリ生成の専門家です。
ユーザーの質問と会話の文脈から、最適な検索クエリを生成してください。
以下の点に注意してください：
1. 会話の文脈を考慮し、前の質問と関連する情報も含めてください
2. 企業名、人名、数値などの具体的な情報は必ず含めてください
3. 日本語で検索するため、重要なキーワードは日本語で出力してください
4. 検索クエリはシンプルで簡潔にしてください
5. 検索クエリのみを出力してください（説明は不要です）`
        },
        ...topHistory.map(msg => ({
          role: msg.role as any,
          content: msg.content
        })),
        {
          role: "user",
          content: `これまでの会話履歴と最新の質問から、最適な検索クエリを生成してください。
最新の質問: ${lastHumanMessage.content}`
        }
      ],
      model: "gpt-4o-mini",
      max_tokens: 100,
      temperature: 0.3
    });

    const searchQuery = searchQueryResponse.choices[0]?.message?.content || lastHumanMessage.content;
    console.log('Generated search query:', searchQuery);

    // Initialize Bing AI Projects Search with error handling
    console.log('\n=== WEB SEARCH DEBUG START ===');
    console.log(`Search Query: ${searchQuery}`);
    console.log('Creating BingAIProjectsSearchResult instance...');
    
    const bingAIProjects = new BingAIProjectsSearchResult();
    let webSearchContent = '';
    let citations: Array<{title: string; url: string; snippet?: string; domain?: string}> = [];
    let searchResults: Array<{title: string; url: string; snippet: string; domain: string}> = [];

    try {
      console.log('Calling bingAIProjects.SearchWeb...');
      const searchResult = await bingAIProjects.SearchWeb(searchQuery);
      
      if (searchResult.answer) {
        // Agentのレスポンスをそのまま使用し、重複する情報を避ける
        webSearchContent = `
使用した検索クエリ: "${searchResult.searchQuery}"

Bing AI Projects Agent検索結果:
${searchResult.answer}`;
        
        citations = searchResult.citations || [];
        searchResults = searchResult.searchResults || [];
      }
    } catch (error) {
      console.error('Bing AI Projects search failed:', error);
      webSearchContent = `
Web検索でエラーが発生しました。既存の知識ベースに基づいて回答いたします。

エラー詳細: ${error instanceof Error ? error.message : 'Unknown error'}

環境変数の設定を確認してください:
- AZURE_BING_PROJECT_URL: ${process.env.AZURE_BING_PROJECT_URL ? `設定済み (${process.env.AZURE_BING_PROJECT_URL})` : '未設定'}
- AZURE_BING_ASSISTANT_ID: ${process.env.AZURE_BING_ASSISTANT_ID ? `設定済み (${process.env.AZURE_BING_ASSISTANT_ID})` : '未設定'}
`;
    }

    // Add user message to chat history
    await chatHistory.addMessage({
      id: "user-" + Date.now(),
      content: lastHumanMessage.content,
      role: "user"
    });

    // Construct prompt
    const prompt = `
以前の会話の文脈:
${topHistory.map(msg => `${msg.role}: ${msg.content}`).join("\n")}

最新の問い合わせ: ${lastHumanMessage.content}

${webSearchContent}

上記の会話の文脈${webSearchContent ? 'とAgent検索結果' : ''}を踏まえて、最新の質問に対して包括的かつ情報豊富な回答を生成してください。

Agentのレスポンスに既にURLや参考文献が含まれている場合は、重複して追加しないでください。
AgentのレスポンスにURLや参考文献が含まれていない場合のみ、以下の形式でMarkdown形式のリストを追加してください：

${citations.length > 0 || searchResults.length > 0 ? `
### 参考文献
${citations.map(citation => `- [${citation.title || citation.domain || 'Webページ'}](${citation.url})`).join('\n')}
${searchResults.length > 0 ? `
### 検索で見つかったWebページ
${searchResults.map((result, index) => `- [${result.title}](${result.url}) - ${result.domain}`).join('\n')}` : ''}
` : ''}`;

    // Create OpenAI chat completion
    const response = await openAI.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `あなたは ${process.env.NEXT_PUBLIC_AI_NAME} です。ユーザーからの質問に対して日本語で丁寧に回答します。以下の指示に従ってください：

1. 質問には会話の文脈を考慮しながら、正直かつ正確に答えてください。
2. Bing AI Projects Agent検索結果がある場合は、その内容を参考にして回答してください。
3. Agentのレスポンスに既にURLや参考文献が含まれている場合は、重複して追加しないでください。
4. AgentのレスポンスにURLや参考文献が含まれていない場合のみ、以下の形式でMarkdown形式のリストを追加してください：
   - 「### 参考文献」セクション：回答で参照したURLを列挙
   - 「### 検索で見つかったWebページ」セクション：検索で見つかったWebページのリスト
5. URLは必ずMarkdown形式のリンクとして表示してください：[タイトル](URL)
6. 以前の会話内容と矛盾する情報を提供しないように注意してください。
7. HTMLタグは一切使用せず、必ずMarkdown記法を使用してください。
8. Agentのレスポンスをそのまま活用し、不要な重複を避けてください。`
        },
        ...topHistory.map(msg => ({
          role: msg.role as any,
          content: msg.content
        })),
        {
          role: "user",
          content: prompt
        }
      ],
      model: "gpt-4o-mini",
      stream: true,
      max_tokens: 4000,
      temperature: 0.7
    });

    // Stream the response
    const stream = OpenAIStream(response as any, {
      async onCompletion(completion) {
        await chatHistory.addMessage({
          id: "assistant-" + Date.now(),
          content: completion,
          role: "assistant"
        });
      }
    });

    return new StreamingTextResponse(stream);

  } catch (error) {
    console.error('ChatAPIWeb error:', error);
    return new Response(
      error instanceof Error ? error.message : "An unknown error occurred.",
      {
        status: 500,
        statusText: error instanceof Error ? error.toString() : "Unknown Error"
      }
    );
  }
};