import {
  FindAllChats,
  UpsertChat,
} from "@/features/chat/chat-services/chat-service";
import {
  ChatMessageModel,
  MESSAGE_ATTRIBUTE,
  ChatRole,
} from "@/features/chat/chat-services/models";
import { CosmosDBContainer } from "@/features/common/cosmos";
import { uniqueId } from "@/features/common/util";
import { Message } from "ai";

export interface CosmosDBChatMessageHistoryFields {
  sessionId: string;
  userId: string;
}

export class CosmosDBChatMessageHistory {
  private sessionId: string;
  private userId: string;

  constructor({ sessionId, userId }: CosmosDBChatMessageHistoryFields) {
    this.sessionId = sessionId;
    this.userId = userId;
  }

  async getMessages(): Promise<Message[]> {
    const chats = await FindAllChats(this.sessionId);
    return mapOpenAIChatMessages(chats);
  }

  async clear(): Promise<void> {
    const container = await CosmosDBContainer.getInstance().getContainer();
    await container.delete();
  }

  async addMessage(message: Message, citations: string = "") {
    const modelToSave: ChatMessageModel = {
      id: uniqueId(),
      createdAt: new Date(),
      type: MESSAGE_ATTRIBUTE,
      isDeleted: false,
      content: message.content ?? "",
      role: message.role as ChatRole,
      threadId: this.sessionId,
      userId: this.userId,
      context: citations,
    };

    await UpsertChat(modelToSave);
  }
}

function mapOpenAIChatMessages(
  messages: ChatMessageModel[]
): Message[] {
  return messages.map((message) => {
    return {
      role: message.role as any,
      content: message.content,
    } as any;
  });
}
