/**
 * similarity.ts
 *
 * 第十一章 11.2.4 — 向量相似度纯函数工具
 *
 * 设计目标：
 * - 零外部依赖（不引入 numpy / @xenova / pgvector）
 * - 不使用 Float32Array，保持 number[]，便于读者按公式一步步对照
 * - 维度不一致抛 RangeError('向量维度不匹配')，让"入库 / 查询"维度不一致的事故
 *   尽早爆发（对应 11.3.7 / 11.12 Q4 的 modelName 校验思路）
 *
 * L2 归一化后 cosineSimilarity === dot（点积），这是 RAG 用余弦的关键工程前提
 * （见 11.2.2）。这里通过测试显式断言这条等式。
 */

function assertSameDim(a: number[], b: number[]): void {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new RangeError('向量维度不匹配');
  }
  if (a.length === 0 || b.length === 0) {
    throw new RangeError('向量维度不匹配');
  }
  if (a.length !== b.length) {
    throw new RangeError('向量维度不匹配');
  }
}

export function dot(a: number[], b: number[]): number {
  assertSameDim(a, b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function l2Norm(v: number[]): number {
  if (!Array.isArray(v) || v.length === 0) {
    throw new RangeError('向量维度不匹配');
  }
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

export function normalize(v: number[]): number[] {
  const n = l2Norm(v);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  assertSameDim(a, b);
  const na = l2Norm(a);
  const nb = l2Norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export function euclideanDistance(a: number[], b: number[]): number {
  assertSameDim(a, b);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}
