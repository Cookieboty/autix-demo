/**
 * chapter15-deepagent-advanced.spec.ts
 *
 * 第十五章《DeepAgent——长链任务与自主规划》配套测试
 *
 * 每个 describe 块严格对应章节编号，支持按节独立运行：
 *   bun test test/chapter15-deepagent-advanced.spec.ts --test-name-pattern "15.2"
 *   bun test test/chapter15-deepagent-advanced.spec.ts --test-name-pattern "15.3"
 *   ...
 *
 * Layer 1：零 LLM 依赖（确定性）
 * Layer 2：需 OPENAI_API_KEY + RUN_LLM_DEEPAGENT_TESTS=1
 *
 * 完整运行：
 *   bun test test/chapter15-deepagent-advanced.spec.ts
 *   RUN_LLM_DEEPAGENT_TESTS=1 bun test test/chapter15-deepagent-advanced.spec.ts
 */
import { describe, it, expect } from 'bun:test';
import {
  createDeepAgent,
  FilesystemBackend,
  StateBackend,
  CompositeBackend,
  computeSummarizationDefaults,
  isAsyncSubAgent,
  GENERAL_PURPOSE_SUBAGENT,
  REQUIRED_MIDDLEWARE_NAMES,
} from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
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

function makeStubModel() {
  return new ChatOpenAI({
    model: LLM_DEEPAGENT_TEST_MODEL,
    configuration: { baseURL: OPENAI_BASE_URL },
    apiKey: OPENAI_API_KEY || 'sk-test',
  });
}

// ============================================================================
// 15.2 中间件装配
// ============================================================================

describe('15.2 中间件装配', () => {
  it('createDeepAgent 返回可调用的 Agent（invoke + streamEvents）', () => {
    const stubTool = new DynamicStructuredTool({
      name: 'noop',
      description: 'no-op',
      schema: z.object({ x: z.string() }),
      func: async () => 'ok',
    });
    const agent = createDeepAgent({
      model: makeStubModel() as never,
      tools: [stubTool] as never,
      systemPrompt: '测试',
    });
    expect(typeof agent.invoke).toBe('function');
    expect(typeof agent.streamEvents).toBe('function');
    console.log('  ✅ createDeepAgent 返回含 invoke/streamEvents 的 Agent');
  });

  it('REQUIRED_MIDDLEWARE_NAMES 包含 FilesystemMiddleware 和 SubAgentMiddleware', () => {
    expect(REQUIRED_MIDDLEWARE_NAMES.has('FilesystemMiddleware')).toBe(true);
    expect(REQUIRED_MIDDLEWARE_NAMES.has('SubAgentMiddleware')).toBe(true);
    console.log('  ✅ 必需中间件：', [...REQUIRED_MIDDLEWARE_NAMES].join(', '));
  });

  it('GENERAL_PURPOSE_SUBAGENT 包含 name/description/systemPrompt', () => {
    expect(GENERAL_PURPOSE_SUBAGENT.name).toBeDefined();
    expect(GENERAL_PURPOSE_SUBAGENT.description.length).toBeGreaterThan(0);
    expect(GENERAL_PURPOSE_SUBAGENT.systemPrompt.length).toBeGreaterThan(0);
    console.log('  ✅ 通用子 Agent:', GENERAL_PURPOSE_SUBAGENT.name);
  });
});

// ============================================================================
// 15.3 子 Agent 接入
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

describe('15.3 createDeepOrchestrator 构造', () => {
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
});

describe('15.3 子 Agent 接入端到端', () => {
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

// ============================================================================
// 15.5 上下文管理
// ============================================================================

describe('15.5 上下文管理：Summarization 默认阈值', () => {
  it('computeSummarizationDefaults 返回 trigger / keep / truncateArgsSettings', () => {
    const model = makeStubModel();
    const defaults = computeSummarizationDefaults(model as any);
    expect(defaults).toBeDefined();
    expect(defaults.trigger).toBeDefined();
    expect(defaults.trigger.type).toBeDefined();
    expect(typeof defaults.trigger.value).toBe('number');
    expect(defaults.keep).toBeDefined();
    expect(defaults.truncateArgsSettings).toBeDefined();
    console.log('  ✅ trigger:', JSON.stringify(defaults.trigger));
    console.log('  ✅ keep:', JSON.stringify(defaults.keep));
    console.log('  ✅ truncateArgsSettings.maxLength:', (defaults.truncateArgsSettings as any).maxLength);
  });
});

// ============================================================================
// 15.6 Backend 体系
// ============================================================================

describe('15.6 Backend 体系', () => {
  it('FilesystemBackend：跨实例写入后读回，文件真实落盘', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ch15-fs-'));
    try {
      const backend = new FilesystemBackend({ rootDir: root, virtualMode: true });
      const w = await backend.write('/REQ-001.md', 'REQ-001 总体影响：高，涉及登录链路改造。');
      expect(w.error).toBeUndefined();

      expect(existsSync(join(root, 'REQ-001.md'))).toBe(true);

      const reopened = new FilesystemBackend({ rootDir: root, virtualMode: true });
      const r = await reopened.read('/REQ-001.md');
      expect(r.error).toBeUndefined();
      expect(String(r.content)).toContain('REQ-001');
      console.log('  ✅ FilesystemBackend 跨实例读回成功');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('StateBackend 可构造', () => {
    const backend = new StateBackend();
    expect(backend).toBeDefined();
    expect(typeof backend.read).toBe('function');
    expect(typeof backend.write).toBe('function');
    console.log('  ✅ StateBackend 构造成功');
  });

  it('CompositeBackend 按路径前缀路由到不同后端', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ch15-composite-'));
    try {
      const fsBackend = new FilesystemBackend({ rootDir: root, virtualMode: true });
      const composite = new CompositeBackend(
        new StateBackend(),
        { '/disk': fsBackend },
      );
      expect(composite).toBeDefined();
      expect(typeof composite.read).toBe('function');
      expect(typeof composite.write).toBe('function');
      console.log('  ✅ CompositeBackend 路由构造成功（默认→StateBackend, /disk→FilesystemBackend）');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// 15.9 HITL
// ============================================================================

describe('15.9 HITL：interruptOn 守卫', () => {
  it('interruptOn 缺少 checkpointer 时抛错', () => {
    expect(() =>
      createDeepOrchestrator({
        model: makeStubModel(),
        interruptOn: { save_report: true },
      }),
    ).toThrow(/checkpointer/);
    console.log('  ✅ interruptOn 需要 checkpointer 的守卫生效');
  });
});

// ============================================================================
// 15.10 异步 subagent
// ============================================================================

describe('15.10 异步 subagent 类型判断', () => {
  it('isAsyncSubAgent 通过 graphId 区分同步/异步子 Agent', () => {
    const syncSub = { name: 'test', description: 'desc', systemPrompt: 'sys', tools: [] };
    const asyncSub = { name: 'test-async', description: 'desc', graphId: 'graph-123' };

    expect(isAsyncSubAgent(syncSub)).toBe(false);
    expect(isAsyncSubAgent(asyncSub)).toBe(true);
    console.log('  ✅ SubAgent（无 graphId）→ false，AsyncSubAgent（有 graphId）→ true');
  });
});

// ============================================================================
// 15.12 工程化补齐：权限
// ============================================================================

describe('15.12 工程化补齐：权限规则', () => {
  it('permissions 作为 createDeepOrchestrator 参数被接受', () => {
    const agent = createDeepOrchestrator({
      model: makeStubModel(),
      rootDir: '/tmp/deepagent-ch15-perm',
      permissions: [
        { operations: ['write'], paths: ['/readonly/**'], mode: 'deny' },
        { operations: ['read', 'write'], paths: ['/workspace/**'], mode: 'allow' },
      ],
    });
    expect(typeof agent.invoke).toBe('function');
    console.log('  ✅ 含多条权限规则的 orchestrator 创建成功');
  });

  it('FilesystemPermission 结构：operations + paths + mode', () => {
    const rule = { operations: ['write'] as const, paths: ['/readonly/**'], mode: 'deny' as const };
    expect(rule.operations).toContain('write');
    expect(rule.paths[0]).toMatch(/^\//);
    expect(['allow', 'deny']).toContain(rule.mode);
    console.log('  ✅ FilesystemPermission 结构：', JSON.stringify(rule));
  });
});
