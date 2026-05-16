/**
 * reranker.ts
 *
 * 第十一章 11.8.4 — 重排序（Cross-Encoder）
 *
 * 双塔向量初筛 Top-50 → 交叉重排 Top-5 是工业 RAG 的及格线。
 * 这里把 reranker 抽象成 RerankerClient 接口，便于注入：
 *   - 生产可对接 BGE-reranker / Cohere rerank-v3
 *   - 测试用 mock：返回 (index, score)，本函数按新分数重排并覆盖 score 字段
 */

import type { SearchResult } from './vector-store';

export interface RerankerClient {
  rerank(
    query: string,
    documents: string[],
  ): Promise<Array<{ index: number; score: number }>>;
}

export async function rerankResults(
  reranker: RerankerClient,
  query: string,
  candidates: SearchResult[],
  topK = 5,
): Promise<SearchResult[]> {
  if (candidates.length === 0) return [];
  const documents = candidates.map((c) => c.content);
  const scored = await reranker.rerank(query, documents);

  return scored
    .filter((s) => s.index >= 0 && s.index < candidates.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      ...candidates[s.index],
      score: s.score,
    }));
}
