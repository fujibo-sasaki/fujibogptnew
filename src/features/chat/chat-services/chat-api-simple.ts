import { userHashedId } from "@/features/auth/helpers";
import { AI_NAME } from "@/features/theme/customise";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { initAndGuardChatSession } from "./chat-thread-service";
import { CosmosDBChatMessageHistory } from "./cosmosdb/cosmosdb";
import { PromptGPTProps } from "./models";
import OpenAI from "openai";

export const ChatAPISimple = async (props: PromptGPTProps) => {
  const { lastHumanMessage, chatThread } = await initAndGuardChatSession(props);
  const userId = await userHashedId();
  const chatHistory = new CosmosDBChatMessageHistory({
    sessionId: chatThread.id,
    userId: userId,
  });

  await chatHistory.addMessage({
    content: lastHumanMessage.content,
    role: "user",
  });

  const history = await chatHistory.getMessages();
  const topHistory = history.slice(history.length - 30, history.length);

  try {
    // 画像生成が必要かどうかを判断
    const isImageGenerationRequest = checkIfImageGenerationRequest(lastHumanMessage.content);
    
    if (isImageGenerationRequest) {
      try {
        // 画像生成リクエストを処理
        
        // 固定の画像生成エンドポイントを使用
        const dalleEndpoint = "https://noka-m7xtz7xj-swedencentral.cognitiveservices.azure.com/";
        const dalleDeploymentName = "dall-e-3";
        const dalleApiVersion = "2024-02-01";
        
        // DALL-E専用のAPIキーを取得
        const dalleApiKey = process.env.AZURE_OPENAI_DALLE_API_KEY;
        
        if (!dalleApiKey) {
          throw new Error("Azure OpenAI DALL-E用のAPIキーが設定されていません。AZURE_OPENAI_DALLE_API_KEY を設定してください。");
        }
        
        // デプロイメント名で画像生成を開始
        
        // 直接fetch APIを使用して画像生成リクエストを送信
        const endpoint = `${dalleEndpoint}openai/deployments/${dalleDeploymentName}/images/generations?api-version=${dalleApiVersion}`;
        // エンドポイントにリクエスト送信
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': dalleApiKey
          },
          body: JSON.stringify({
            prompt: lastHumanMessage.content,
            n: 1,
            size: '1024x1024'
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          // API応答エラー処理
          throw new Error(`画像生成APIエラー: ${response.status} ${errorText}`);
        }
        
        const imageData = await response.json();
        // 画像生成 API の応答を受信
        
        // OpenAIクライアントは使用しない
        /* 
        const dalleClient = new OpenAI({
          apiKey: apiKey,
          baseURL: `${dalleEndpoint}openai/deployments/${dalleDeploymentName}`,
          defaultQuery: { "api-version": dalleApiVersion },
          defaultHeaders: { "api-key": apiKey },
        });
        */
        
        // 画像 URL を取得 - 応答の形式はAzure OpenAI固有のものとなる
        const imageUrl = imageData.data?.[0]?.url;
        
        if (imageUrl) {
          // 画像 URL を取得
          
          const imageCompletion = `![生成画像](${imageUrl})`;
          
          // 履歴に画像生成結果を追加
          await chatHistory.addMessage({
            content: imageCompletion,
            role: "assistant",
          });
          
          // 画像 URL をレスポンスとして返す
          // return new Response(JSON.stringify({ type: "image", url: imageUrl,text:"l" }), {
          //   headers: { "Content-Type": "application/json" },
          // });          
          return new Response((imageCompletion), {
            headers: { "Content-Type": "application/json" },
          });
        //   return new Response(JSON.stringify({ type: "image", url: imageUrl, text: imageCompletion }), {
        //     headers: { "Content-Type": "application/json" },
        //   });
        // } else {
          throw new Error("画像 URL が取得できませんでした");
        }
      } catch (imageError) {
        // 画像生成エラー処理
        
        // エラーメッセージをユーザーに返す
        const errorMessage = "画像生成機能は現在利用できません。テキストによる回答に切り替えます。";
        
        // 履歴にエラーメッセージを追加
        await chatHistory.addMessage({
          content: errorMessage,
          role: "assistant",
        });
        
        // テキスト応答にフォールバック
      }
    }

    // モデル選択ロジック
    let chatDeploymentName = "";
    if (props.chatAPIModel === "Current_Version") {
      // Azure OpenAI Service のデプロイメント名を使用
      chatDeploymentName = process.env.AZURE_OPENAI_GPT_DEPLOYMENT_NAME || "gpt-4o-mini";
    } else {
      chatDeploymentName = "o1-mini"; // Current_Version でない場合は o1-mini を使用
    }
    
    // テキスト応答のデプロイメントを使用
    
    // 環境変数からAzure OpenAIの設定を取得
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const apiVersion = process.env.OPENAI_API_VERSION || "2023-05-15";
    
    if (!endpoint || !apiKey) {
      throw new Error("Azure OpenAIの設定が不足しています。AZURE_OPENAI_ENDPOINT と AZURE_OPENAI_API_KEY を設定してください。");
    }

    // テキスト応答用のOpenAIクライアントを作成
    const chatClient = new OpenAI({
      apiKey: apiKey,
      baseURL: `${endpoint}openai/deployments/${chatDeploymentName}`,
      defaultQuery: { "api-version": apiVersion },
      defaultHeaders: { "api-key": apiKey },
    });

    // システムプロンプト
    const systemPrompt = `あなたは ${AI_NAME} です。ユーザーからの質問に対して日本語で丁寧に回答します。
- 簡潔かつ正確な情報を提供し、専門用語がある場合は分かりやすく説明します。
- 質問の意図が不明確な場合は、具体的な質問をして意図を明確にしてから回答します。
- ユーザーの知識レベルに合わせて、適切な詳細さで回答します。
- 確実な情報のみを提供し、不確かな情報には「確認が必要です」と明示します。
- 複雑な質問には段階的に説明し、理解しやすいように例を交えます。
- 常に礼儀正しく、親切な対応を心がけます。`;

    // チャット応答を生成
    const response = await chatClient.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        ...topHistory,
      ],
      model: chatDeploymentName, // TypeScriptの型チェックのために必要
      stream: true,
    });

    const stream = OpenAIStream(response, {
      async onCompletion(completion) {
        await chatHistory.addMessage({
          content: completion,
          role: "assistant",
        });
      },
    });
    
    return new StreamingTextResponse(stream);
  } catch (e: unknown) {
    // 全体的なエラー処理
    
    if (e instanceof Error) {
      return new Response(e.message, {
        status: 500,
        statusText: e.toString(),
      });
    } else {
      return new Response("An unknown error occurred.", {
        status: 500,
        statusText: "Unknown Error",
      });
    }
  }
};

/**
 * ユーザーの入力が画像生成リクエストかどうかを判断する関数
 */
function checkIfImageGenerationRequest(content: string): boolean {
  const imageGenerationKeywords = [
    "絵を描いて", "画像を生成", "イラストを作って", "写真を作成", "画像を作って",
    "描いて", "絵を作って", "イメージを生成", "画像生成", "ビジュアル化して",
    "イラスト化", "絵にして", "visualize", "draw", "generate image"
  ];

  const lowerContent = content.toLowerCase();
  return imageGenerationKeywords.some(keyword => lowerContent.includes(keyword));
}