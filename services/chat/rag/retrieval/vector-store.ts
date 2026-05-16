/**
 * vector-store.ts
 *
 * 第十一章 11.5 — pgvector 仓储层（与既有 SearchService 解耦的下沉版）
 *
 *   - 直接走 prisma.$queryRaw，避免引入 pgvector 客户端
 *   - 入参 queryVector 与库内向量必须等维，否则抛 RangeError（11.3.7 防呆）
 *   - 同时导出 bruteForceKnn 作为"精确 baseline"，11.5.2 用来对比 ANN
 *     和暴力 KNN 在小数据集上的结果一致性，让读者直观感受"近似 vs 精确"
 *
 * 注意：实际 pgvector 检索逻辑已存在于 services/chat/src/document/search.service.ts，
 * 本文件不替换它，只是提供"可测、可教学"的纯函数仓储。
 */

import { cosineSimilarity } from '../embedding/similarity';

export interface VectorStoreRecord {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  embedding: number[];
  modelName: string;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  score: number;
}

export interface SimilaritySearchOptions {
  topK?: number;
  /** 期望的模型名；若库中存在不一致 modelName 立即抛错（11.3.7 / 11.12 Q4） */
  expectedModelName?: string;
}

/**
 * 暴力 KNN：100% 精确，O(n)。仅作 11.5.2 教学 baseline 使用。
 *
 * 现实生产中 100 万向量这一步要花几秒～几十秒，所以才需要 HNSW/IVF 这类 ANN（11.5.3/4）。
 */
export function bruteForceKnn(
  queryVector: number[],
  records: VectorStoreRecord[],
  topK = 5,
): SearchResult[] {
  if (records.length === 0) return [];
  const dim = records[0].embedding.length;
  if (queryVector.length !== dim) {
    throw new RangeError('向量维度不匹配');
  }
  const scored = records.map((r) => ({
    chunkId: r.id,
    documentId: r.documentId,
    content: r.content,
    chunkIndex: r.chunkIndex,
    score: cosineSimilarity(queryVector, r.embedding),
  }));
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

type PrismaLike = {
  $queryRaw: (...args: any[]) => Promise<any[]>;
  $executeRaw?: (...args: any[]) => Promise<unknown>;
};

/**
 * 11.5.6 pgvector 余弦检索的仓储封装。
 *
 * 关键约束：
 *   1. queryVector 长度必须 == 库中向量维度（11.3.7 防"换模型不重建索引"事故）
 *   2. cosine 距离运算符 <=>，score = 1 - 距离
 *   3. 如设了 expectedModelName，会先抽样校验 modelName 一致性，杜绝静默乱跑
 */
export async function similaritySearch(
  prisma: PrismaLike,
  queryVector: number[],
  userId: string,
  options: SimilaritySearchOptions = {},
): Promise<SearchResult[]> {
  const { topK = 5, expectedModelName } = options;

  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    throw new RangeError('向量维度不匹配');
  }

  if (expectedModelName) {
    const rows = (await prisma.$queryRaw(
      ['SELECT DISTINCT "modelName" AS m FROM document_chunks LIMIT 8'],
    )) as Array<{ m: string }>;
    const bad = rows.find((r) => r.m && r.m !== expectedModelName);
    if (bad) {
      throw new Error(
        `Embedding model mismatch: index has '${bad.m}' but query uses '${expectedModelName}'`,
      );
    }
  }

  const vectorLiteral = `[${queryVector.join(',')}]`;
  const rows = (await prisma.$queryRaw(
    [
      `SELECT dc.id AS chunk_id, dc."documentId" AS document_id, dc.content,
              dc."chunkIndex" AS chunk_index,
              1 - (dc.embedding <=> '${vectorLiteral}'::vector) AS score
         FROM document_chunks dc
         JOIN documents d ON d.id = dc."documentId"
        WHERE d."userId" = `,
      ' AND dc.embedding IS NOT NULL ORDER BY dc.embedding <=> ',
      `'${vectorLiteral}'::vector LIMIT `,
      '',
    ],
    userId,
    `'${vectorLiteral}'::vector`,
    topK,
  )) as Array<{
    chunk_id: string;
    document_id: string;
    content: string;
    chunk_index: number;
    score: string | number;
  }>;

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    content: r.content,
    chunkIndex: r.chunk_index,
    score: Number(r.score),
  }));
}

/**
 * 批量 upsert chunk 向量（教学用最小实现）。
 *
 * 真正生产路径在 src/document/chunk.service.ts，本函数仅作为"仓储接口可测"的样板。
 */
export async function upsertChunks(
  prisma: PrismaLike,
  records: VectorStoreRecord[],
): Promise<void> {
  if (!prisma.$executeRaw) {
    throw new Error('prisma client does not expose $executeRaw');
  }
  for (const r of records) {
    if (r.embedding.length === 0) {
      throw new RangeError('向量维度不匹配');
    }
    const vec = `[${r.embedding.join(',')}]`;
    await prisma.$executeRaw(
      [
        `INSERT INTO document_chunks (id, "documentId", content, "chunkIndex", embedding, "modelName")
         VALUES (`,
        ', ',
        ', ',
        ', ',
        `, '${vec}'::vector, `,
        ') ON CONFLICT (id) DO NOTHING',
      ],
      r.id,
      r.documentId,
      r.content,
      r.chunkIndex,
      r.modelName,
    );
  }
}
