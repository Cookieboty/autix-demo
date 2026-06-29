import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import {
  hybridSearch,
  bm25Search,
  embeddingRerank,
  type RetrievalResult,
} from './hybrid-retrieval';
import { loadLangChainConfig } from '../config/load-langchain-config';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  chunkIndex: number;
}

/** BM25 关键词路一次性拉取的候选上限，避免在大语料上无界扫描。 */
const BM25_CORPUS_CAP = 500;

/**
 * RAG 检索整体超时（毫秒）默认值。
 *
 * 第二十章 20.2 的承诺是"检索任一路失败都降级、不炸主链路"，但 try/catch 只能挡"失败"，
 * 挡不住"挂起"——embedding 模型首次下载、向量库（Qdrant）不可达又无限重试等场景下，
 * 检索会无限期阻塞，把整条 SSE 主链一起拖死。这里给检索套一个硬超时：超时即降级为空上下文
 * （'无相关参考文档'），让报告链路照常继续。可被 langchain.yaml 的 retrieval.timeoutMs 覆盖。
 */
const DEFAULT_SEARCH_TIMEOUT_MS = 8000;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async similaritySearch(
    query: string,
    userId: string,
    topK = 5,
  ): Promise<SearchResult[]> {
    const [vector] = await this.embedding.embedTexts([query]);
    if (!vector || vector.length === 0) {
      throw new Error('EmbeddingService returned no vector for query');
    }
    // vectorLiteral must be injected as a SQL literal (not a bind parameter) because
    // PostgreSQL cannot cast a text bind parameter to vector via $1::vector in prepared statements.
    // Prisma.raw() inlines it as SQL text. userId and topK remain parameterized (safe).
    // The vector values come from the model's float output — no user input reaches this string.
    const vectorLiteral = `[${vector.join(',')}]`;
    const vecRaw = Prisma.raw(`'${vectorLiteral}'::vector`);

    const rows = await this.prisma.$queryRaw<
      Array<{
        chunk_id: string;
        document_id: string;
        content: string;
        score: string | number;
        chunk_index: number;
      }>
    >`
      SELECT
        dc.id             AS chunk_id,
        dc."documentId"   AS document_id,
        dc.content        AS content,
        dc."chunkIndex"   AS chunk_index,
        1 - (dc.embedding <=> ${vecRaw}) AS score
      FROM document_chunks dc
      JOIN documents d ON d.id = dc."documentId"
      WHERE d."userId" = ${userId}
        AND dc.embedding IS NOT NULL
      ORDER BY dc.embedding <=> ${vecRaw}
      LIMIT ${topK}
    `;

    return rows.map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      score: Number(r.score),
      chunkIndex: r.chunk_index,
    }));
  }

  /**
   * 主链路统一检索入口（第二十章 20.2）。
   *
   * 按 langchain.yaml 的 retrieval.mode 选择检索策略：
   *   - hybrid（默认）：向量 + BM25 两路多召回（topK*3）→ RRF 融合 → embedding 余弦重排到 topK。
   *     先保 Recall（少漏）再保 Precision（去噪），对应第十七章 17.3 的两步优化。
   *   - simple：退回纯向量 similaritySearch（向后兼容）。
   *
   * hybrid 任一路失败（如 BM25 取语料异常）都降级为纯向量，不让检索升级炸掉主链路。
   *
   * 整个检索还套了一层硬超时（retrieval.timeoutMs，默认 8s）：检索"挂起"（embedding 模型
   * 首次下载、向量库不可达无限重试等）时超时降级为空上下文，绝不阻塞 SSE 主链路。
   * 因此本方法对调用方"永不抛错、永不挂起"——最差也只是返回空数组。
   */
  async search(
    query: string,
    userId: string,
    topK = 5,
  ): Promise<SearchResult[]> {
    const cfg = loadLangChainConfig().retrieval;
    const timeoutMs = cfg?.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    try {
      return await this.withTimeout(
        this.runSearch(query, userId, topK, cfg?.mode ?? 'hybrid'),
        timeoutMs,
        'RAG 检索',
      );
    } catch (err) {
      // 失败或超时都降级为空上下文，主链路以"无相关参考文档"继续。
      console.warn(
        '[SearchService] 检索失败/超时，降级为空上下文，主链路继续:',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  /** search() 的内层实现：mode 路由 + hybrid 三段式（不含超时/兜底，由 search() 统一包裹）。 */
  private async runSearch(
    query: string,
    userId: string,
    topK: number,
    mode: 'simple' | 'hybrid',
  ): Promise<SearchResult[]> {
    if (mode !== 'hybrid') {
      return this.similaritySearch(query, userId, topK);
    }

    try {
      const wideK = topK * 3;
      const vectorPath = () => this.similaritySearch(query, userId, wideK);
      const bm25Path = async () => {
        const corpus = await this.fetchUserChunks(userId);
        return bm25Search(query, corpus, wideK);
      };

      // 1) 向量 + BM25 多召回 → RRF 融合到 topK*3 候选
      const candidates = await hybridSearch(query, vectorPath, bm25Path, wideK);
      if (candidates.length === 0) return [];

      // 2) embedding 余弦重排，精排到 topK
      return embeddingRerank(
        query,
        candidates,
        (texts) => this.embedding.embedTexts(texts),
        topK,
      );
    } catch (err) {
      console.warn('[SearchService] hybrid 检索失败，降级纯向量:', err);
      return this.similaritySearch(query, userId, topK);
    }
  }

  /**
   * 给一个 Promise 套硬超时。超时只让本次检索快速失败降级，
   * 底层 embedding/DB 调用仍会在后台跑完（transformers.js 无法真正取消），但不再阻塞主链路。
   */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} 超时（>${ms}ms）`)),
        ms,
      );
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }

  /** BM25 关键词路的语料：取该 user 的 chunk 正文（带上限，纯 DB 读，不改 schema）。 */
  private async fetchUserChunks(userId: string): Promise<RetrievalResult[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        chunk_id: string;
        document_id: string;
        content: string;
        chunk_index: number;
      }>
    >`
      SELECT
        dc.id           AS chunk_id,
        dc."documentId" AS document_id,
        dc.content      AS content,
        dc."chunkIndex" AS chunk_index
      FROM document_chunks dc
      JOIN documents d ON d.id = dc."documentId"
      WHERE d."userId" = ${userId}
      LIMIT ${BM25_CORPUS_CAP}
    `;
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      chunkIndex: r.chunk_index,
      score: 0,
    }));
  }
}
