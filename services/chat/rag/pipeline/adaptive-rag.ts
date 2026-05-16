/**
 * adaptive-rag.ts
 *
 * 第十一章 11.9.4 — Adaptive-RAG（按问题复杂度路由）
 *
 *   - simple     → 不检索，LLM 直接回答（闲聊/时间/通用知识）
 *   - single_hop → 单次检索 + 生成（标准 RAG，最常见）
 *   - multi_hop  → 拆解子问题 → 逐个检索 → 合并 → 生成（跨文档分析）
 *
 * 把分类器抽象成 ComplexityClassifier 接口，便于注入：
 *   - mock：测试里 fixedClassifier(label)
 *   - 生产：LLM Prompt 二/三分类 或 微调小模型
 */

import type { SearchResult } from '../retrieval/vector-store';
import { ragAsk, type RagLlm, RAG_NO_CONTEXT_FALLBACK } from './rag-pipeline';

export type Complexity = 'simple' | 'single_hop' | 'multi_hop';

export interface ComplexityClassifier {
  classify(question: string): Promise<Complexity>;
}

export interface AdaptiveRagInput {
  question: string;
  classifier: ComplexityClassifier;
  searchFn: (query: string, topK: number) => Promise<SearchResult[]>;
  model: RagLlm;
  /** multi_hop 时用 LLM 把问题拆成多个子问题 */
  decomposeFn?: (q: string) => Promise<string[]>;
  topK?: number;
}

export interface AdaptiveRagOutput {
  path: Complexity;
  answer: string;
  retrieved: SearchResult[];
  subQueries?: string[];
}

/** mock 用：固定返回某一档 */
export function fixedClassifier(label: Complexity): ComplexityClassifier {
  return { classify: async () => label };
}

export async function adaptiveRagAsk(
  input: AdaptiveRagInput,
): Promise<AdaptiveRagOutput> {
  const { question, classifier, searchFn, model, decomposeFn, topK = 5 } = input;
  const path = await classifier.classify(question);

  if (path === 'simple') {
    const resp = await model.invoke([
      { role: 'user', content: question },
    ]);
    return {
      path,
      answer:
        typeof resp === 'string' ? resp : String((resp as any)?.content ?? ''),
      retrieved: [],
    };
  }

  if (path === 'single_hop') {
    const result = await ragAsk({ question, searchFn, model, topK });
    return {
      path,
      answer: result.answer,
      retrieved: result.retrievedChunks,
    };
  }

  // multi_hop：先拆解子问题，逐个检索 → 合并 → 一次生成
  const subQs = decomposeFn ? await decomposeFn(question) : [question];
  const allChunks: SearchResult[] = [];
  for (const sub of subQs) {
    const chunks = await searchFn(sub, topK);
    allChunks.push(...chunks);
  }
  const dedup = new Map<string, SearchResult>();
  for (const c of allChunks) if (!dedup.has(c.chunkId)) dedup.set(c.chunkId, c);
  const merged = [...dedup.values()].sort((a, b) => b.score - a.score);

  if (merged.length === 0) {
    return { path, answer: RAG_NO_CONTEXT_FALLBACK, retrieved: [], subQueries: subQs };
  }

  // 复用 ragAsk 的 Prompt 拼装；这里再走一次 single-hop 风格生成
  const result = await ragAsk({
    question,
    searchFn: async () => merged.slice(0, topK),
    model,
    topK,
  });
  return {
    path,
    answer: result.answer,
    retrieved: result.retrievedChunks,
    subQueries: subQs,
  };
}
