/**
 * query-rewriter.ts
 *
 * 第十一章 11.8.1 — Query 改写
 *
 * 让 LLM 把"短/口语化/带上下文依赖"的原始问题改写成 1–3 个更利于检索的版本：
 *   - 同义改写（Query Expansion）
 *   - 子问题分解（Sub-query Decomposition）
 *   - 历史上下文回填
 *
 * 实现策略：优先用 withStructuredOutput 强约束 schema；
 *           退路是普通 invoke 后从内容里抽 JSON。
 */

import { z } from 'zod';

const REWRITE_SCHEMA = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
});

const REWRITE_SYSTEM = `你是一个查询改写助手。把用户的原始问题改写为 1-3 个更利于检索的版本：
- 保持原意
- 用规范的书面表达
- 复杂问题可以拆成多个子问题
返回 JSON: { "queries": ["改写1", "改写2", ...] }`;

export interface RewriteModel {
  withStructuredOutput?: (schema: any) => { invoke: (messages: any) => Promise<any> };
  invoke: (messages: any) => Promise<any>;
}

export interface RewriteOptions {
  conversationHistory?: string;
  /** 上限保护：即使模型乱来，最多保留前 N 条 */
  maxQueries?: number;
}

export async function rewriteQuery(
  model: RewriteModel,
  originalQuery: string,
  options: RewriteOptions = {},
): Promise<string[]> {
  if (!originalQuery || originalQuery.trim() === '') return [];
  const { conversationHistory, maxQueries = 3 } = options;

  const userMessage = conversationHistory
    ? `历史对话：\n${conversationHistory}\n\n当前问题：${originalQuery}`
    : originalQuery;

  let queries: string[] = [];
  try {
    if (typeof model.withStructuredOutput === 'function') {
      const structured = model.withStructuredOutput(REWRITE_SCHEMA);
      const result = (await structured.invoke([
        { role: 'system', content: REWRITE_SYSTEM },
        { role: 'user', content: userMessage },
      ])) as { queries: string[] };
      queries = result.queries ?? [];
    } else {
      const raw = await model.invoke([
        { role: 'system', content: REWRITE_SYSTEM },
        { role: 'user', content: userMessage },
      ]);
      const text =
        typeof raw === 'string' ? raw : String((raw as any)?.content ?? '');
      const parsed = REWRITE_SCHEMA.safeParse(JSON.parse(text));
      if (parsed.success) queries = parsed.data.queries;
    }
  } catch {
    // 改写失败不应阻塞主流程：退化为原句单跑
    queries = [];
  }

  if (queries.length === 0) return [originalQuery];

  // 去重 + 截断
  const dedup = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  return dedup.slice(0, maxQueries);
}
