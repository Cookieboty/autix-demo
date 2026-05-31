import { describe, it, expect } from 'bun:test';
import { safePath } from '../src/llm/tools/business.tools';

// 纯逻辑：路径沙箱必须拦截逃逸，确定性可离线断言
describe('safePath sandbox', () => {
  it('resolves paths inside workspace', () => {
    const p = safePath('requirements/REQ-2026-001.json');
    expect(p.endsWith('workspace/requirements/REQ-2026-001.json')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(() => safePath('../../etc/passwd')).toThrow('路径不允许逃逸工作目录');
  });
});

// 端到端（真实模型）：默认跳过，RUN_LLM_E2E=1 时执行
const runIf = process.env.RUN_LLM_E2E ? it : it.skip;

describe('Advanced analyze (e2e)', () => {
  runIf(
    'produces a report or clarification questions',
    async () => {
      const { AdvancedAnalysisService } = await import(
        '../src/llm/advanced-analysis.service'
      );
      const { OrchestratorService } = await import(
        '../src/llm/agents/orchestrator.service'
      );
      const { FilesystemService } = await import(
        '../src/llm/filesystem/filesystem.service'
      );
      const { RunnableMemoryService } = await import(
        '../src/llm/memory/runnable-memory.service'
      );

      const service = new AdvancedAnalysisService(
        new OrchestratorService(),
        new FilesystemService(),
        new RunnableMemoryService()
      );
      const result = await service.analyze(
        'spec-session',
        '开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文'
      );

      if (result.needsClarification) {
        expect(Array.isArray(result.questions)).toBe(true);
      } else {
        expect(typeof result.report).toBe('string');
        expect(result.report.length).toBeGreaterThan(0);
        expect(result.usedAgents).toContain('summaryAgent');
      }
    },
    60000
  );
});
