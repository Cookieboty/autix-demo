import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessageRole, Prisma } from '@prisma/client';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  async addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.messages.create({
      data: { conversationId, role, content, metadata: metadata as Prisma.InputJsonValue },
    });
  }

  async getHistory(conversationId: string, limit?: number) {
    return this.prisma.messages.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    });
  }

  /**
   * 第二十章 20.7：取最近 `take` 条消息，按时间正序返回（用于多轮对话历史注入）。
   * 与 getHistory（取最旧 limit 条）相反，这里取最新 take 条再翻回正序。
   */
  async getRecentHistory(conversationId: string, take: number) {
    const rows = await this.prisma.messages.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.reverse();
  }

  async getHistoryAsLangChainMessages(conversationId: string): Promise<BaseMessage[]> {
    const messages = await this.getHistory(conversationId);
    return messages.map((m) =>
      m.role === MessageRole.USER
        ? new HumanMessage(m.content)
        : new AIMessage(m.content),
    );
  }

  async clearHistory(conversationId: string) {
    await this.prisma.messages.deleteMany({ where: { conversationId } });
  }
}
