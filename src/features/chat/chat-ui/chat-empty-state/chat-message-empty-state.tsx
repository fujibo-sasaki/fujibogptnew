import Typography from "@/components/typography";
import { Card } from "@/components/ui/card";
import { FC } from "react";
import { useChatContext } from "../chat-context";
import { ChatFileUI } from "../chat-file/chat-file-ui";
import { ChatStyleSelector } from "./chat-style-selector";
import { ChatTypeSelector } from "./chat-type-selector";
import { AI_NAME } from "@/features/theme/customise";
import { useSession } from "next-auth/react";

interface Prop {}

export const ChatMessageEmptyState: FC<Prop> = (props) => {
  const { fileState } = useChatContext();
  const { data: session } = useSession();

  const { showFileUpload } = fileState;

  return (
    // <div className="grid grid-cols-1 w-full items-center container mx-auto max-w-3xl justify-center h-full gap-9">
    <div className="grid grid-cols-1 w-full items-start container mx-auto max-w-3xl justify-center h-full gap-6">
      <Card className="col-span-3 flex flex-col gap-4 p-4 ">
        <Typography variant="h4" className="text-primary">
          {/* {AI_NAME}にようこそ！ */}
          富士紡ChatGPTにようこそ！
        </Typography>
          {/* <p className="text-xs text-muted-foreground">
            このChatGPT搭載のAIチャットボットは、2024年1月からプレビューで社内利用限定で公開されています。
            まだまだ未熟なAIですが、皆様のご協力により、AIの成長を目指しています。
            ご利用の際は、以下の項目を選択してください。

          </p> */
          }
          <p className="text-sm">富士紡ChatGPTは文章の要約や生成、WEB検索が可能な富士紡グループ独自の生成AI(ChatGPT)です。<br />
            以下の注意事項をご確認の上、富士紡ChatGPTのご利用をお願いいたします。</p>
          <p className="text-sm text-red-500">※質問情報が社外に漏洩することがないセキュアな環境となります<br />
            ※富士紡ChatGPT以外の個人向け生成AIは、情報漏洩の危険性があるため、利用を控えてください<br />
            ※画像生成は通常利用で、「富士山の絵を描いてください」など指定すると作成できます（New!）
          </p>
          <p className="text-sm">【注意事項】<br />
            ・第三者の著作物を入力しない。固有名詞(既存著作物、作家名、作品の名称)を入力しない<br />
            ・生成された回答結果に著作権侵害（既存の著作物との類似性・依拠性）がないか確認する<br />
            ・回答結果の出典(根拠・裏付け)の確認や、回答結果の正確性を確認する<br />
            ・業務以外のプライベートな利用は控える
          </p>

          <div className="flex justify-center flex-wrap gap-1">
            <div className="w-7 flex"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-app-window"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="M10 4v4"></path><path d="M2 8h20"></path><path d="M6 4v4"></path></svg>
            </div>
            <div className="text-xs w-auto flex pr-4">本画面の説明は<b><a href="http://groupeip1.intrafujibo.co.jp/pdf/%E5%AF%8C%E5%A3%AB%E7%B4%A1ChatGPT_%E5%AF%8C%E5%A3%AB%E7%B4%A1ChatGPT%E3%81%AE%E7%94%BB%E9%9D%A2%E8%AA%AC%E6%98%8E.pdf" target="_blank" className="text-blue-600 hover:underline">こちら</a></b>
            </div>
            <div className="w-7 flex"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-help-circle"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg>
            </div>
            <div className="text-xs w-auto flex pr-4">会話スタイル・利用機能の説明は<b><a href="http://groupeip1.intrafujibo.co.jp/pdf/%E5%AF%8C%E5%A3%AB%E7%B4%A1ChatGPT_%E4%BC%9A%E8%A9%B1%E3%82%B9%E3%82%BF%E3%82%A4%E3%83%AB%E3%83%BB%E5%88%A9%E7%94%A8%E6%A9%9F%E8%83%BD%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6.pdf" target="_blank" className="text-blue-600 hover:underline">こちら</a></b>
            </div>
            <div className="w-7 flex"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-info"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
            </div>
            <div className="text-xs w-auto flex">活用事例は<b><a href="http://groupeip1.intrafujibo.co.jp/pdf/%E5%AF%8C%E5%A3%AB%E7%B4%A1ChatGPT_%E6%B4%BB%E7%94%A8%E4%BA%8B%E4%BE%8B.pdf" target="_blank" className="text-blue-600 hover:underline">こちら</a></b>
            </div>
          </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
          会話スタイルを選択してください
          </p>
          <ChatStyleSelector disable={false} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {/* AIがお手伝いする方法を選択してください */}
            利用方法を選択してください
          </p>
          <ChatTypeSelector disable={false} />
        </div>
        {showFileUpload === "data" && <ChatFileUI />}
      </Card>
    </div>
  );
};
