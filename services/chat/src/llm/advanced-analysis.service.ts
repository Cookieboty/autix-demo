/**
 * AdvancedAnalysisService — 本章能力收束入口
 *
 * 把第四章的三块能力串成一条业务链路：
 *   Memory（会话上下文） + 多 Agent 编排（固定工作流） + 文件落盘（报告制品）
 *
 * analyze() 是统一入口：编排分析 → 需要澄清则返回问题；否则落盘报告并写入会话记忆。
 */
import { Injectable } from '@nestjs/common';
import { OrchestratorService } from './agents/orchestrator.service';
import { FilesystemService } from './filesystem/filesystem.service';
import { RunnableMemoryService } from './memory/runnable-memory.service';

export type AnalyzeResult =
  | { needsClarification: true; questions: string[] }
  | { needsClarification: false; report: string; reportPath: string; usedAgents: string[] };

@Injectable()
export class AdvancedAnalysisService {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly filesystem: FilesystemService,
    private readonly memory: RunnableMemoryService
  ) {}

  async analyze(sessionId: string, input: string): Promise<AnalyzeResult> {
    const result = await this.orchestrator.orchestrate(input);

    if (result.status === 'need_clarification') {
      return { needsClarification: true, questions: result.clarificationQuestions };
    }

    const report = result.report ?? '分析未生成报告';
    const reportPath = this.filesystem.writeReport(
      `reports/${sessionId}-${Date.now()}.md`,
      report
    );
    await this.memory.appendMessage(sessionId, input, report);

    return {
      needsClarification: false,
      report,
      reportPath,
      usedAgents: result.usedAgents,
    };
  }
}
