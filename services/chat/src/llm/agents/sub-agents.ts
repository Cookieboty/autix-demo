/**
 * sub-agents.ts
 *
 * 需求分析五个专职 Agent。每个 Agent 都是一条独立的小链：
 * prompt.pipe(model).pipe(StringOutputParser)，职责单一、可独立测试。
 */
import { StringOutputParser } from '@langchain/core/output_parsers';
import { createChatModel } from '../model.factory';
import {
  extractPrompt,
  clarifyPrompt,
  analysisPrompt,
  riskPrompt,
  summaryPrompt,
} from '../prompts/requirement.prompts';

const model = createChatModel();
const parser = new StringOutputParser();

// 抽取 Agent：输出结构化需求 JSON
export const extractAgent = extractPrompt.pipe(model).pipe(parser);

// 澄清 Agent：判断是否需要澄清并生成问题
export const clarifyAgent = clarifyPrompt.pipe(model).pipe(parser);

// 多维度分析 Agent
export const analysisAgent = analysisPrompt.pipe(model).pipe(parser);

// 风险评估 Agent（与 analysisAgent 并行）
export const riskAgent = riskPrompt.pipe(model).pipe(parser);

// 汇总 Agent：生成最终需求分析报告
export const summaryAgent = summaryPrompt.pipe(model).pipe(parser);
