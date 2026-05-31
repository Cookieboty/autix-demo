/**
 * AdvancedAnalysisService — 生产级统一分析入口（第五章整合版）
 *
 * 把第四章的内存版能力升级为数据库 + RAG + 多 Agent 的端到端链路：
 *   1. 从数据库读取会话历史（DbChatHistory）
 *   2. 语义检索当前用户的文档（pgvector，按 userId 隔离）
 *   3. 拼接历史 + 检索上下文 + 当前输入，交给多 Agent 编排
 *   4. 把用户输入与分析结论持久化到 Message 表
 *   5. 返回报告与引用文档
 */
import { Injectable } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { MessageService } from '../message/message.service';
import { DbChatHistory } from '../message/db-chat-history';
import { SearchService } from '../document/search.service';
import { OrchestratorService } from './agents/orchestrator.service';

@Injectable()
export class AdvancedAnalysisService {
  constructor(
    private readonly messageService: MessageService,
    private readonly searchService: SearchService,
    private readonly orchestrator: OrchestratorService
  ) {}

  async analyze(userId: string, conversationId: string, input: string) {
    // 1. 读取会话历史
    const history = new DbChatHistory(conversationId, this.messageService);
    const messages = await history.getMessages();

    // 2. 语义检索用户文档（按 userId 隔离）
    let retrievedDocs: Awaited<ReturnType<SearchService['similaritySearch']>> = [];
    try {
      retrievedDocs = await this.searchService.similaritySearch(input, userId, 3);
    } catch {
      // 无文档或检索失败时，继续无文档上下文分析
    }

    const retrievedContext =
      retrievedDocs.length > 0
        ? retrievedDocs
            .map((d, i) => `[文档片段 ${i + 1}]（相关度：${d.score.toFixed(3)}）\n${d.content}`)
            .join('\n\n')
        : '无相关参考文档';

    // 3. 拼接完整上下文
    const enrichedInput = [
      messages.length
        ? `历史对话：\n${messages.map((m) => `${m.getType()}: ${m.content}`).join('\n')}`
        : '',
      `当前输入：${input}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    // 4. 多 Agent 分析（注入检索上下文）
    const result = await this.orchestrator.orchestrate(enrichedInput, retrievedContext);

    // 5. 持久化用户消息与分析结论
    await this.messageService.addMessage(conversationId, MessageRole.USER, input);
    if (result.status !== 'need_clarification') {
      await this.messageService.addMessage(
        conversationId,
        MessageRole.ASSISTANT,
        result.report ?? '分析未完成',
        { usedAgents: result.usedAgents, retrievedDocuments: retrievedDocs.length }
      );
    }

    return {
      ...result,
      retrievedDocuments: retrievedDocs.map((d) => ({
        documentId: d.documentId,
        content: d.content.slice(0, 200),
        score: d.score,
      })),
    };
  }
}
