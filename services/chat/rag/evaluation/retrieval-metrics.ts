/**
 * retrieval-metrics.ts
 *
 * 第十一章 11.7 — 检索质量评测的三大指标（纯函数，零依赖）
 *
 *   - Recall@K：前 K 个里命中了多少相关文档
 *   - MRR：第一个相关结果倒数排名的均值
 *   - NDCG@K：DCG / IDCG，综合"相关性 + 位置"
 *
 * 设计取舍：
 *   - 相关性使用二值（命中=1，未命中=0），覆盖最常见的标注场景
 *   - 维度参数（如 k=0、relevantIds 为空）需要显式定义，函数内部走防御性默认
 */

function toSet(ids: string[]): Set<string> {
  return new Set(ids);
}

export function recallAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  if (k <= 0) return 0;
  if (relevantIds.length === 0) return 0;
  const top = retrievedIds.slice(0, k);
  const rel = toSet(relevantIds);
  let hit = 0;
  for (const id of top) if (rel.has(id)) hit += 1;
  return hit / relevantIds.length;
}

export function mrr(
  rankedListsPerQuery: string[][],
  relevantPerQuery: string[][],
): number {
  if (rankedListsPerQuery.length === 0) return 0;
  if (rankedListsPerQuery.length !== relevantPerQuery.length) {
    throw new Error('rankedListsPerQuery 与 relevantPerQuery 长度必须一致');
  }
  let sum = 0;
  for (let i = 0; i < rankedListsPerQuery.length; i++) {
    const ranked = rankedListsPerQuery[i];
    const rel = toSet(relevantPerQuery[i]);
    let rr = 0;
    for (let j = 0; j < ranked.length; j++) {
      if (rel.has(ranked[j])) {
        rr = 1 / (j + 1);
        break;
      }
    }
    sum += rr;
  }
  return sum / rankedListsPerQuery.length;
}

function dcg(retrievedIds: string[], relevantIds: Set<string>, k: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(k, retrievedIds.length); i++) {
    const rel = relevantIds.has(retrievedIds[i]) ? 1 : 0;
    s += rel / Math.log2(i + 2); // i+2 因为 log2(1)=0
  }
  return s;
}

export function ndcgAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  if (k <= 0) return 0;
  if (relevantIds.length === 0) return 0;
  const rel = toSet(relevantIds);
  const idealHits = Math.min(relevantIds.length, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  if (idcg === 0) return 0;
  return dcg(retrievedIds, rel, k) / idcg;
}
