/**
 * rag-pipeline.ts
 *
 * 第十一章 11.6 — 最小但完整的 RAG Pipeline
 *
 * 流程：检索 → 拼带元信息的 Prompt → LLM 生成 → 输出 + 引用
 *
 * 设计取舍：
 *   - 检索器作为函数指针注入（searchFn），便于替换为 11.8 的混合检索 / 重排链路
 *   - LLM 抽象成最小 invoke 接口，方便 mock / 真实模型互换
 *   - 0 检索结果时按 11.6.5 防幻觉清单显式回退"无法确定"，而不是让模型瞎编
 */

import type { SearchResult } from '../retrieval/vector-store';

export interface RagLlm {
  invoke: (messages: Array<{ role: string; content: string }>) => Promise<any>;
}

export interface RagAskInput {
  question: string;
  searchFn: (query: string, topK: number) => Promise<SearchResult[]>;
  model: RagLlm;
  topK?: number;
  /** 自定义 system prompt；不传走默认防幻觉模板 */
  systemPrompt?: string;
}

export interface RagCitation {
  chunkId: string;
  documentId: string;
  score: number;
}

export interface RagAskOutput {
  answer: string;
  citations: RagCitation[];
  retrievedChunks: SearchResult[];
}

export const RAG_DEFAULT_SYSTEM_PROMPT = `你是一个基于知识库的问答助手。请严格根据[上下文]回答用户问题。

规则：
- 只用上下文中的信息回答，不要凭借常识或推测
- 如果上下文不足以回答，回复"根据提供的资料，我无法确定..."
- 每句结论后用 [chunkId: xxx] 标注引用来源
- 简洁清晰，最多 5 段`;

export const RAG_NO_CONTEXT_FALLBACK =
  '根据提供的资料，我无法确定答案。建议补充相关文档后重试。';

function formatContextBlock(chunks: SearchResult[]): string {
  return chunks
    .map(
      (c) =>
        `[chunkId: ${c.chunkId}, 来源: ${c.documentId}, 相关性: ${c.score.toFixed(2)}]\n${c.content}`,
    )
    .join('\n\n---\n\n');
}

export async function ragAsk(input: RagAskInput): Promise<RagAskOutput> {
  const { question, searchFn, model, topK = 5, systemPrompt } = input;

  const chunks = await searchFn(question, topK);

  if (chunks.length === 0) {
    return {
      answer: RAG_NO_CONTEXT_FALLBACK,
      citations: [],
      retrievedChunks: [],
    };
  }

  const contextBlock = formatContextBlock(chunks);
  const userMessage = `[上下文]\n${contextBlock}\n\n[用户问题]\n${question}`;

  const response = await model.invoke([
    { role: 'system', content: systemPrompt ?? RAG_DEFAULT_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ]);

  const answer =
    typeof response === 'string'
      ? response
      : String((response as any)?.content ?? '');

  return {
    answer,
    citations: chunks.map((c) => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      score: c.score,
    })),
    retrievedChunks: chunks,
  };
}
