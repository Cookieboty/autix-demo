/**
 * hyde.ts
 *
 * 第十一章 11.9.1 — HyDE（Hypothetical Document Embeddings）
 *
 * 思路：让 LLM 先"幻想"一段答案，再用幻想答案而非原始问题去检索。
 * 幻想答案哪怕事实有误也无妨——它的用词、长度、结构更接近真实文档，
 * 因此向量空间里离真实文档更近。
 */

import type { SearchResult } from '../retrieval/vector-store';
import type { RagLlm } from './rag-pipeline';

export interface HydeOptions {
  topK?: number;
  /** 自定义"幻想答案"的 system prompt */
  systemPrompt?: string;
}

const HYDE_SYSTEM_PROMPT =
  '请用一段简短的事实陈述回答下面的问题。如果不知道，也编一个看起来合理的答案。50-150 字。';

export async function hydeSearch(
  model: RagLlm,
  searchFn: (query: string, topK: number) => Promise<SearchResult[]>,
  question: string,
  options: HydeOptions = {},
): Promise<{ hypothetical: string; results: SearchResult[] }> {
  const { topK = 5, systemPrompt = HYDE_SYSTEM_PROMPT } = options;

  const resp = await model.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ]);

  const hypothetical =
    typeof resp === 'string' ? resp : String((resp as any)?.content ?? '');

  const queryForSearch = hypothetical.trim() === '' ? question : hypothetical;
  const results = await searchFn(queryForSearch, topK);
  return { hypothetical, results };
}
