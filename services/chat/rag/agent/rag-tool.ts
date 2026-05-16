/**
 * rag-tool.ts
 *
 * 第十一章 11.10 — 把 RAG 包装成 LangChain Tool，挂入第八九章 Multi-Agent
 *
 * 关键设计：
 *   1. description 显式包含"适用 / 不适用"，让 LLM 在闲聊场景不要误调用
 *   2. 第一步先做预算检查（resolveBudgetAction），reject 时直接返回，
 *      避免昂贵的 ragAsk 已经跑完才发现超预算
 *   3. 返回值统一为 JSON 字符串（LangChain 工具协议要求 string）
 *
 * 这里不引入 @langchain/core/tools 的硬依赖，让测试更轻；
 * 暴露一个工厂函数返回一个"对象 + invoke"形态的工具描述，
 * 真正接入 LangGraph 时再用 tool(...) 包一下即可（见 11.10.3 示例）。
 */

import { resolveBudgetAction } from '../../src/llm/cost/budget-policy';
import type { SearchResult } from '../retrieval/vector-store';
import { ragAsk, type RagLlm } from '../pipeline/rag-pipeline';

export interface BudgetSnapshot {
  /** 当前月度预算使用百分比（0–110） */
  usedPercent: number;
}

export interface RagToolDeps {
  model: RagLlm;
  userId: string;
  searchFn: (query: string, topK: number) => Promise<SearchResult[]>;
  /** 同步给出预算快照；测试时传 mock 即可 */
  getBudget: () => Promise<BudgetSnapshot> | BudgetSnapshot;
}

export interface RagToolInput {
  question: string;
  topK?: number;
}

export interface RagToolResultOk {
  answer: string;
  citations: Array<{ chunkId: string; documentId: string; score: number }>;
}
export interface RagToolResultBudgetReject {
  error: 'budget_exceeded';
  message: string;
}

export type RagToolResult = RagToolResultOk | RagToolResultBudgetReject;

export const RAG_TOOL_DESCRIPTION =
  '根据问题检索企业内部知识库，返回基于知识库的回答和引用来源。' +
  '适用于查询业务规则、产品文档、内部规范、历史决策等需要从知识库找答案的场景。' +
  '不适用于：闲聊、纯计算、时间查询。';

export const RAG_TOOL_NAME = 'search_knowledge_base';

export function createRagTool(deps: RagToolDeps) {
  async function invoke(input: RagToolInput): Promise<string> {
    const topK = input.topK ?? 5;

    // 1) 预算检查（先做，避免空跑昂贵的 LLM 调用）
    const snapshot = await deps.getBudget();
    const action = resolveBudgetAction({
      budgetUsedPercent: snapshot.usedPercent,
      agentName: 'rag_tool',
    });
    if (action.action === 'reject') {
      const reject: RagToolResultBudgetReject = {
        error: 'budget_exceeded',
        message: action.reason,
      };
      return JSON.stringify(reject);
    }

    // 2) 调用真正的 RAG 流水线
    const result = await ragAsk({
      question: input.question,
      searchFn: deps.searchFn,
      model: deps.model,
      topK,
    });

    // 3) citations 按 chunkId 去重（防止 11.10.7 验收点漏掉）
    const dedup = new Map<string, RagToolResultOk['citations'][number]>();
    for (const c of result.citations) {
      if (!dedup.has(c.chunkId)) {
        dedup.set(c.chunkId, {
          chunkId: c.chunkId,
          documentId: c.documentId,
          score: Number(c.score.toFixed(3)),
        });
      }
    }

    const ok: RagToolResultOk = {
      answer: result.answer,
      citations: [...dedup.values()],
    };
    return JSON.stringify(ok);
  }

  return {
    name: RAG_TOOL_NAME,
    description: RAG_TOOL_DESCRIPTION,
    invoke,
  };
}
