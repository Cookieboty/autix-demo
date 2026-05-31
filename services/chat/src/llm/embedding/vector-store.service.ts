/**
 * VectorStoreService — 进程内向量库（教学用）
 *
 * 使用 LangChain v1 的 MemoryVectorStore（@langchain/classic）做最小可用的
 * 相似度检索：把文本存入内存向量库，再按查询语义召回最相近的片段。
 *
 * 注意：这是单进程、不持久化的 demo。生产环境用 pgvector（见第五章）。
 */
import { Injectable } from '@nestjs/common';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { Document } from '@langchain/core/documents';
import { EmbeddingService } from './embedding.service';

@Injectable()
export class VectorStoreService {
  private store: MemoryVectorStore;

  constructor(private readonly embeddings: EmbeddingService) {
    this.store = new MemoryVectorStore(this.embeddings);
  }

  async addTexts(texts: string[]) {
    const docs = texts.map((text) => new Document({ pageContent: text }));
    await this.store.addDocuments(docs);
    return { added: texts.length };
  }

  async search(query: string, k = 3) {
    const results = await this.store.similaritySearchWithScore(query, k);
    return results.map(([doc, score]) => ({
      content: doc.pageContent,
      score,
    }));
  }
}
