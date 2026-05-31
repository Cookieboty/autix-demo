/**
 * hybrid-retrieval.ts —— 第二十章 20.2 主链路检索升级的「生产版」实现。
 *
 * 为什么在 src/ 里再落一份，而不是 import 第十一章的 rag/？
 *   第十一章的 rag/ 是「教学镜像」，刻意放在 src/ 之外（vector-store.ts 文件头明说
 *   「与既有 SearchService 解耦的下沉版…不替换它，只提供可测可教学的纯函数」）。
 *   生产 tsconfig 的 rootDir=./src，跨界 import rag/ 会触发 TS6059；改 rootDir 又会
 *   破坏第十九章 Docker 的 dist/main.js 路径。故沿用本仓库既有的「教学镜像 vs 生产」
 *   分工：算法与 rag/ 同源，这里是可被主链路 import 的生产副本。
 *
 * 三段式：BM25 关键词路（零数据模型变更）→ RRF 融合多召回 → embedding 余弦重排精排。
 * 取舍见 20.2：这是「轻量真实」，非工业满血（tsvector+GIN / cross-encoder），但货真价实、
 * 可被第十七章指标量化，且不动 schema、不引入外部依赖。
 */

export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  score: number;
}

export type RetrieveFn = (query: string) => Promise<RetrievalResult[]>;

// ── 余弦（与 rag/embedding/similarity.ts 同式，内联以保持本模块自包含）──
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── BM25 关键词检索（中文按单字、latin 按词）──
const BM25_K1 = 1.5;
const BM25_B = 0.75;

export function tokenize(text: string): string[] {
  if (!text) return [];
  const latin = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
  return [...latin, ...cjk];
}

/** 在内存里对候选语料算 BM25（IDF 用语料内文档频次现算，故须传完整候选集）。 */
export function bm25Search(
  query: string,
  corpus: RetrievalResult[],
  topK = 5,
): RetrievalResult[] {
  if (corpus.length === 0) return [];
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const docTokens = corpus.map((d) => tokenize(d.content));
  const docLengths = docTokens.map((t) => t.length);
  const avgDocLength = docLengths.reduce((a, b) => a + b, 0) / corpus.length || 1;

  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const toks of docTokens) if (toks.includes(term)) count++;
    df.set(term, count);
  }

  const N = corpus.length;
  return corpus
    .map((doc, i) => {
      const tf = new Map<string, number>();
      for (const t of docTokens[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of queryTerms) {
        const f = tf.get(term) ?? 0;
        if (f === 0) continue;
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const denom =
          f + BM25_K1 * (1 - BM25_B + (BM25_B * docLengths[i]) / avgDocLength);
        score += idf * ((f * (BM25_K1 + 1)) / denom);
      }
      return { ...doc, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── RRF 融合（不归一化分数，只看排名，避免不同算法量纲打架）──
function rrfFuse(rankedLists: Array<{ id: string }[]>, rrfK = 60): Map<string, number> {
  const scoreMap = new Map<string, number>();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id;
      scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (rrfK + i + 1));
    }
  }
  return scoreMap;
}

/** 向量 + BM25 两路多召回 → RRF 融合 → 截到 topK。 */
export async function hybridSearch(
  query: string,
  vectorSearch: RetrieveFn,
  bm25Search: RetrieveFn,
  topK = 5,
): Promise<RetrievalResult[]> {
  const [vec, bm25] = await Promise.all([vectorSearch(query), bm25Search(query)]);
  const scoreMap = rrfFuse([
    vec.map((r) => ({ id: r.chunkId })),
    bm25.map((r) => ({ id: r.chunkId })),
  ]);
  const merged = new Map<string, RetrievalResult>();
  for (const r of [...vec, ...bm25]) if (!merged.has(r.chunkId)) merged.set(r.chunkId, r);
  return [...merged.values()]
    .map((r) => ({ ...r, score: scoreMap.get(r.chunkId) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** embedding 余弦重排：query 与每个候选各算 embedding，按余弦精排到 topK。 */
export async function embeddingRerank(
  query: string,
  candidates: RetrievalResult[],
  embed: (texts: string[]) => Promise<number[][]>,
  topK = 5,
): Promise<RetrievalResult[]> {
  if (candidates.length === 0) return [];
  const vectors = await embed([query, ...candidates.map((c) => c.content)]);
  const queryVec = vectors[0];
  if (!queryVec || queryVec.length === 0) return candidates.slice(0, topK);
  return candidates
    .map((c, i) => ({ ...c, score: cosineSimilarity(queryVec, vectors[i + 1]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
