/**
 * chapter15-deepagent-advanced.spec.ts
 *
 * 第十五章《DeepAgent——长链任务与自主规划》配套测试
 *
 * Layer 1：零 LLM 依赖（确定性）
 *   - extractLatestUserText：messages → input 字符串的映射
 *   - createAnalysisSubagent：子 Agent 结构（名字/描述/runnable）
 *   - createDeepOrchestrator：构造与 interruptOn 守卫
 *   - FilesystemBackend：文件落到真实磁盘、跨实例可读回（持久化的可跑部分）
 * Layer 2：跨工单端到端（需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1）
 *   - DeepAgent 自主规划 + 委派 requirement_analyst 子 Agent
 *
 * 运行方式：
 *   bun test test/chapter15-deepagent-advanced.spec.ts
 */
import { describe, it, expect } from 'bun:test';
import { FilesystemBackend } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from 'dotenv';
import {
  extractLatestUserText,
  createAnalysisSubagent,
  createDeepOrchestrator,
  ANALYSIS_SUBAGENT_NAME,
} from '../src/llm/deepagent/deep-orchestrator.service';

config({ path: new URL('../.env', import.meta.url).pathname });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const LLM_DEEPAGENT_TEST_MODEL = process.env.LLM_DEEPAGENT_TEST_MODEL || 'gpt-5.4';
const RUN_LLM_DEEPAGENT_TESTS = process.env.RUN_LLM_DEEPAGENT_TESTS === '1';
const SKIP_LLM = !OPENAI_API_KEY || !RUN_LLM_DEEPAGENT_TESTS;

if (SKIP_LLM) {
  console.warn('⚠️  LLM 集成测试将跳过：需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1');
}

// 仅用于构造（不发起真实调用）的占位模型
function makeStubModel() {
  return new ChatOpenAI({
    model: LLM_DEEPAGENT_TEST_MODEL,
    configuration: { baseURL: OPENAI_BASE_URL },
    apiKey: OPENAI_API_KEY || 'sk-test',
  });
}

// ============================================================================
// Layer 1：零 LLM 依赖
// ============================================================================

describe('15.3 适配器：messages → input 映射', () => {
  it('取最近一条 human 消息文本', () => {
    const text = extractLatestUserText([
      new HumanMessage('第一条'),
      new AIMessage('助手回复'),
      new HumanMessage('分析 REQ-001'),
    ]);
    expect(text).toBe('分析 REQ-001');
  });

  it('忽略 system / ai，只回 human', () => {
    const text = extractLatestUserText([
      new SystemMessage('你是协调者'),
      new HumanMessage('评估 REQ-002'),
    ]);
    expect(text).toBe('评估 REQ-002');
  });

  it('空列表返回空串', () => {
    expect(extractLatestUserText([])).toBe('');
  });
});

describe('15.3 createAnalysisSubagent 结构', () => {
  it('返回 CompiledSubAgent（name/description/runnable）', () => {
    const sub = createAnalysisSubagent(makeStubModel());
    expect(sub.name).toBe(ANALYSIS_SUBAGENT_NAME);
    expect(sub.description.length).toBeGreaterThan(0);
    expect(typeof (sub.runnable as any).invoke).toBe('function');
    console.log('  ✅ 子 Agent:', sub.name);
  });
});

describe('15.3 createDeepOrchestrator 构造与守卫', () => {
  it('最小构造可创建 Agent', () => {
    const agent = createDeepOrchestrator({ model: makeStubModel() });
    expect(typeof agent.invoke).toBe('function');
  });

  it('带磁盘后端 + 权限规则可创建 Agent', () => {
    const agent = createDeepOrchestrator({
      model: makeStubModel(),
      rootDir: '/tmp/deepagent-ch15',
      permissions: [
        { operations: ['write'], paths: ['/readonly/**'], mode: 'deny' },
      ],
    });
    expect(typeof agent.invoke).toBe('function');
  });

  it('interruptOn 缺少 checkpointer 时抛错', () => {
    expect(() =>
      createDeepOrchestrator({
        model: makeStubModel(),
        interruptOn: { save_report: true },
      }),
    ).toThrow(/checkpointer/);
  });
});

describe('15.6 本地磁盘 FilesystemBackend：跨实例读回', () => {
  it('一个实例写、另一个实例读回，文件真实落盘', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ch15-fs-'));
    try {
      const backend = new FilesystemBackend({ rootDir: root, virtualMode: true });
      const w = await backend.write('/REQ-001.md', 'REQ-001 总体影响：高，涉及登录链路改造。');
      expect(w.error).toBeUndefined();

      // 文件确实落到真实磁盘
      expect(existsSync(join(root, 'REQ-001.md'))).toBe(true);

      // 全新实例（模拟新进程）按同一 rootDir 读回
      const reopened = new FilesystemBackend({ rootDir: root, virtualMode: true });
      const r = await reopened.read('/REQ-001.md');
      expect(r.error).toBeUndefined();
      expect(String(r.content)).toContain('REQ-001');
      console.log('  ✅ 跨实例读回成功，文件位于', join(root, 'REQ-001.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Layer 2：跨工单端到端
// ============================================================================

describe('15.3 / 15.4 跨工单端到端：委派子 Agent + 自主规划', () => {
  if (SKIP_LLM) {
    it.skip('需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1', () => {});
    return;
  }

  it('DeepAgent 自主规划 → task 委派 requirement_analyst → 产出分析', async () => {
    const model = new ChatOpenAI({
      model: LLM_DEEPAGENT_TEST_MODEL,
      temperature: 0,
      configuration: { baseURL: OPENAI_BASE_URL },
    });
    const agent = createDeepOrchestrator({ model });

    const result = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: '评估需求 REQ-001（支持企业微信扫码登录）对核心系统的影响，给出分析结论。',
        },
      ],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const output = result.messages[result.messages.length - 1].content.toString();

    console.log('  调用链:', toolCalls.join(' → '));
    console.log('  todos:', (result.todos ?? []).length, '项');
    console.log('  输出前 300 字:', output.substring(0, 300));

    expect(toolCalls).toContain('task');
    expect(output.length).toBeGreaterThan(200);
  }, 600000);
});
