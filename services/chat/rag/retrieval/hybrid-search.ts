/**
 * hybrid-search.ts
 *
 * 第十一章 11.8.3 — 混合检索（向量 + BM25 + RRF 融合）
 *
 *   - 向量检索擅长"语义模糊"，BM25 擅长"精确实体"，两者互补
 *   - RRF（Reciprocal Rank Fusion，k=60）不依赖打分量纲，只看排名 → 鲁棒
 *   - 这里把"向量检索 / BM25 检索"抽象成函数指针，方便测试与替换底层实现
 */

import type { SearchResult } from './vector-store';

export type RetrieveFn = (query: string) => Promise<SearchResult[]>;

export interface HybridSearchOptions {
  topK?: number;
  /** RRF 常数 k，论文经验值 60（11.8.3.1） */
  rrfK?: number;
  /** 初筛召回放大倍数：先各取 topK*4，再融合后取 topK */
  recallMultiplier?: number;
}

/**
 * 11.8.3.1 RRF 融合：给定 N 个排名列表，按 ∑ 1/(k+rank) 求和。
 * 不归一化分数，避免不同算法量纲互相打架。
 */
export function rrfFuse(
  rankedLists: Array<{ id: string }[]>,
  rrfK = 60,
): Map<string, number> {
  const scoreMap = new Map<string, number>();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id;
      const rank = i + 1;
      scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (rrfK + rank));
    }
  }
  return scoreMap;
}

export async function hybridSearch(
  query: string,
  vectorSearch: RetrieveFn,
  bm25Search: RetrieveFn,
  options: HybridSearchOptions = {},
): Promise<SearchResult[]> {
  const { topK = 5, rrfK = 60, recallMultiplier = 4 } = options;
  const wideK = topK * recallMultiplier;

  // 并行跑两路检索
  const [vec, bm25] = await Promise.all([
    vectorSearch(query),
    bm25Search(query),
  ]);

  // 各自截取 wideK 候选
  const vecTop = vec.slice(0, wideK);
  const bmTop = bm25.slice(0, wideK);

  // RRF 融合
  const scoreMap = rrfFuse(
    [
      vecTop.map((r) => ({ id: r.chunkId })),
      bmTop.map((r) => ({ id: r.chunkId })),
    ],
    rrfK,
  );

  // 去重 + 排序
  const merged = new Map<string, SearchResult>();
  for (const r of [...vecTop, ...bmTop]) {
    if (!merged.has(r.chunkId)) merged.set(r.chunkId, r);
  }

  return [...merged.values()]
    .map((r) => ({ ...r, score: scoreMap.get(r.chunkId) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
