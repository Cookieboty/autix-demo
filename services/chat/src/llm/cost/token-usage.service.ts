/**
 * token-usage.service.ts
 *
 * 第十章 10.8：节点级 Token usage 持久化服务。
 * 每次模型调用写一条记录到 token_usages 表。
 */
import { PrismaClient } from '@prisma/client';

export interface TokenUsageRecord {
  conversationId?: string;
  messageId?: string;
  threadId?: string;
  graphName: string;
  nodeName: string;
  agentName: string;
  modelConfigId?: string;
  modelName: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  estimatedCostUsd: number;
  isEstimated?: boolean;
  latencyMs?: number;
  overrideReason?: string;
}

export interface MonthlyStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  calls: number;
}

export interface NodeStats {
  nodeName: string;
  totalCost: number;
  calls: number;
  avgInputTokens: number;
}

export class TokenUsageService {
  constructor(private prisma: PrismaClient) {}

  async recordUsage(record: TokenUsageRecord): Promise<void> {
    try {
      await this.prisma.token_usages.create({
        data: {
          conversationId: record.conversationId,
          messageId: record.messageId,
          threadId: record.threadId,
          graphName: record.graphName,
          nodeName: record.nodeName,
          agentName: record.agentName,
          modelConfigId: record.modelConfigId,
          modelName: record.modelName,
          provider: record.provider || 'openai',
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          totalTokens: record.totalTokens ?? (record.inputTokens + record.outputTokens),
          cachedInputTokens: record.cachedInputTokens || 0,
          estimatedCostUsd: record.estimatedCostUsd,
          isEstimated: record.isEstimated || false,
          latencyMs: record.latencyMs || 0,
          overrideReason: record.overrideReason,
        },
      });
    } catch (err) {
      console.warn('[TokenUsageService] recordUsage failed, skipping:', err);
    }
  }

  async getMonthlyStats(): Promise<MonthlyStats> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const records = await this.prisma.token_usages.findMany({
      where: { createdAt: { gte: monthStart } },
    });

    return {
      totalCost: records.reduce((s, r) => s + r.estimatedCostUsd, 0),
      totalInputTokens: records.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: records.reduce((s, r) => s + r.outputTokens, 0),
      totalCachedTokens: records.reduce((s, r) => s + r.cachedInputTokens, 0),
      calls: records.length,
    };
  }

  async getStatsByNode(): Promise<NodeStats[]> {
    const records = await this.prisma.token_usages.findMany();
    const map = new Map<string, { cost: number; calls: number; inputTokens: number }>();

    for (const r of records) {
      const existing = map.get(r.nodeName) || { cost: 0, calls: 0, inputTokens: 0 };
      existing.cost += r.estimatedCostUsd;
      existing.calls += 1;
      existing.inputTokens += r.inputTokens;
      map.set(r.nodeName, existing);
    }

    return Array.from(map.entries())
      .map(([nodeName, v]) => ({
        nodeName,
        totalCost: v.cost,
        calls: v.calls,
        avgInputTokens: v.calls > 0 ? Math.round(v.inputTokens / v.calls) : 0,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  async getStatsByAgent(): Promise<{ agentName: string; totalCost: number; calls: number }[]> {
    const records = await this.prisma.token_usages.findMany();
    const map = new Map<string, { cost: number; calls: number }>();

    for (const r of records) {
      const existing = map.get(r.agentName) || { cost: 0, calls: 0 };
      existing.cost += r.estimatedCostUsd;
      existing.calls += 1;
      map.set(r.agentName, existing);
    }

    return Array.from(map.entries())
      .map(([agentName, v]) => ({ agentName, totalCost: v.cost, calls: v.calls }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  async isOverBudget(monthlyBudgetUsd: number): Promise<boolean> {
    const stats = await this.getMonthlyStats();
    return stats.totalCost >= monthlyBudgetUsd;
  }
}
