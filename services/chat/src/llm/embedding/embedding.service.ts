/**
 * EmbeddingService — 本地向量生成
 *
 * 使用 @xenova/transformers 在 Node.js 直接运行嵌入模型，无需外部 API。
 * 模型：Xenova/paraphrase-multilingual-MiniLM-L12-v2（384 维，支持中文）。
 *
 * 继承 LangChain 的 Embeddings 抽象类，因此可直接喂给 MemoryVectorStore。
 */
import { Injectable } from '@nestjs/common';
import { Embeddings } from '@langchain/core/embeddings';
import { pipeline, mean_pooling } from '@xenova/transformers';

@Injectable()
export class EmbeddingService extends Embeddings {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private embedder: any = null;
  private readonly modelName = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

  constructor() {
    super({});
  }

  // 延迟初始化：模型下载一次后复用
  private async getEmbedder() {
    if (!this.embedder) {
      this.embedder = await pipeline('feature-extraction', this.modelName);
    }
    return this.embedder;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const embedder = await this.getEmbedder();
    const cleanTexts = texts.map((t) => t.replace(/\n/g, ' '));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawOutput = (await embedder(cleanTexts)) as any;
    const inputs = embedder.tokenizer(cleanTexts, {
      padding: true,
      truncation: true,
    });
    // mean pooling（按 attention_mask 加权）+ L2 单位化（余弦相似度 = 点积）
    const pooled = mean_pooling(rawOutput, inputs.attention_mask);
    return pooled.normalize(2, -1).tolist();
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    return vector;
  }
}
