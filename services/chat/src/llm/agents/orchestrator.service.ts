/**
 * orchestrator.service.ts
 *
 * 需求分析固定编排（Fixed Workflow）：
 *   1. extractAgent   抽取结构化需求（JSON）
 *   2. clarifyAgent   判断是否需要澄清（JSON），需要则短路返回
 *   3. analysisAgent  多维度分析  ┐ 并行
 *      riskAgent      风险评估    ┘
 *   4. summaryAgent   汇总生成报告（Markdown）
 *
 * 不做任何 DB / HTTP 操作，仅编排 Agent 调用并返回结构化结果。
 */
import { Injectable } from '@nestjs/common';
import {
  extractAgent,
  clarifyAgent,
  analysisAgent,
  riskAgent,
  summaryAgent,
} from './sub-agents';

export type OrchestratorResult = {
  mode: 'fixed_workflow';
  status?: 'need_clarification';
  clarificationQuestions: string[];
  usedAgents: string[];
  fallback: string | null;
  steps?: {
    extract: string;
    analysis?: string;
    risk?: string;
  };
  report?: string;
  error?: string;
};

// LLM 偶尔会带 ```json 代码块包裹，做一次容错解析
function parseJsonLoose(raw: string): any {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

@Injectable()
export class OrchestratorService {
  async orchestrate(input: string): Promise<OrchestratorResult> {
    try {
      const extractResult = await extractAgent.invoke({ input });

      // 澄清判断：信息不足时短路返回澄清问题
      const clarifyRaw = await clarifyAgent.invoke({ extractResult, input });
      let clarificationQuestions: string[] = [];
      try {
        const clarify = parseJsonLoose(clarifyRaw);
        if (clarify?.needsClarification && Array.isArray(clarify.questions)) {
          clarificationQuestions = clarify.questions;
        }
      } catch {
        // 澄清结果解析失败时不阻塞主流程，按"无需澄清"继续
      }

      if (clarificationQuestions.length > 0) {
        return {
          mode: 'fixed_workflow',
          status: 'need_clarification',
          clarificationQuestions,
          usedAgents: ['extractAgent', 'clarifyAgent'],
          fallback: 'ask_user',
        };
      }

      const [analysisResult, riskResult] = await Promise.all([
        analysisAgent.invoke({ extractResult, input }),
        riskAgent.invoke({ extractResult, input }),
      ]);

      const report = await summaryAgent.invoke({
        input,
        extractResult,
        analysisResult,
        riskResult,
        retrievedContext: '无相关参考文档',
      });

      return {
        mode: 'fixed_workflow',
        clarificationQuestions: [],
        usedAgents: [
          'extractAgent',
          'clarifyAgent',
          'analysisAgent',
          'riskAgent',
          'summaryAgent',
        ],
        fallback: null,
        steps: { extract: extractResult, analysis: analysisResult, risk: riskResult },
        report,
      };
    } catch (error) {
      return {
        mode: 'fixed_workflow',
        clarificationQuestions: [],
        usedAgents: ['extractAgent'],
        fallback: 'manual_review',
        report: '分析流程失败，请转人工复核。',
        error: String(error),
      };
    }
  }
}
