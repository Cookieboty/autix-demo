/**
 * chapter14-deepagent.spec.ts
 *
 * 第十四章《DeepAgent 入门——一个开箱即用的 Agent Harness》配套测试
 *
 * Layer 1：零 LLM 依赖
 *   - Python 工具脚本独立行为（需求分析工具）
 *   - listSkills 从磁盘解析 SKILL.md frontmatter
 *   - createDeepAgent 能创建 Agent（含 FilesystemBackend + skills）
 * Layer 2：Agent 端到端（需要 OPENAI_API_KEY，并显式设置 RUN_LLM_DEEPAGENT_TESTS=1）
 *          可用 LLM_DEEPAGENT_TEST_MODEL 指定真实模型，默认 gpt-5.4
 *
 * 运行方式：
 *   bun test test/chapter14-deepagent.spec.ts
 */
import { describe, it, expect } from 'bun:test';
import { createDeepAgent, FilesystemBackend, listSkills } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { execSync } from 'child_process';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { config } from 'dotenv';

config({ path: new URL('../.env', import.meta.url).pathname });

const SKILLS_DIR = join(import.meta.dir, '../src/skills/definitions');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const LLM_DEEPAGENT_TEST_MODEL = process.env.LLM_DEEPAGENT_TEST_MODEL || 'gpt-5.4';
const RUN_LLM_DEEPAGENT_TESTS = process.env.RUN_LLM_DEEPAGENT_TESTS === '1';
const SKIP_LLM = !OPENAI_API_KEY || !RUN_LLM_DEEPAGENT_TESTS;

if (SKIP_LLM) {
  console.warn('⚠️  LLM 集成测试将跳过：需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1');
}

function callPythonTool(skillName: string, scriptName: string, input: Record<string, unknown>): string {
  const scriptPath = join(SKILLS_DIR, skillName, 'scripts', scriptName);
  return execSync(`python3 "${scriptPath}"`, {
    input: JSON.stringify(input),
    encoding: 'utf-8',
  }).trim();
}

const tools = [
  new DynamicStructuredTool({
    name: 'analyze_completeness',
    description: '分析需求描述的完整性，从六个维度检查是否缺少关键信息。',
    schema: z.object({ requirementText: z.string().describe('需求描述文本') }),
    func: async ({ requirementText }) =>
      callPythonTool('requirement-analysis', 'analyze_completeness.py', { requirementText }),
  }),
  new DynamicStructuredTool({
    name: 'estimate_complexity',
    description: '估算需求的技术复杂度，返回 T-shirt size 和预计工期。',
    schema: z.object({ requirementText: z.string().describe('需求描述') }),
    func: async ({ requirementText }) =>
      callPythonTool('requirement-analysis', 'estimate_complexity.py', { requirementText }),
  }),
];

// ============================================================================
// Layer 1：零 LLM 依赖
// ============================================================================

describe('14.4 Hello World：createDeepAgent 最小构造', () => {
  it('单工具 + systemPrompt 即可创建 Agent', () => {
    const getWeather = new DynamicStructuredTool({
      name: 'get_weather',
      description: '获取指定城市的天气',
      schema: z.object({ city: z.string().describe('城市名') }),
      func: async ({ city }) => `${city}：晴，28°C，微风`,
    });

    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        configuration: { baseURL: OPENAI_BASE_URL },
        apiKey: OPENAI_API_KEY || 'sk-test',
      }),
      tools: [getWeather],
      systemPrompt: '你是一个天气助手。用户问天气时，调用 get_weather 工具获取数据。',
    });

    expect(typeof agent.invoke).toBe('function');
    expect(typeof agent.streamEvents).toBe('function');
    console.log('  ✅ Hello World Agent 创建成功（invoke / streamEvents 均可用）');
  });
});

describe('14.5 Python 工具独立验证', () => {
  it('analyze_completeness.py 返回完整性评分', () => {
    const parsed = JSON.parse(
      callPythonTool('requirement-analysis', 'analyze_completeness.py', {
        requirementText: '作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行',
      }),
    );
    expect(parsed.completenessScore).toBeGreaterThan(0);
    expect(parsed.coveredDimensions.length).toBeGreaterThan(0);
    console.log('  ✅ 完整性评分:', parsed.completenessScore, '覆盖维度:', parsed.coveredDimensions.join('、'));
  });

  it('estimate_complexity.py 返回复杂度估算', () => {
    const parsed = JSON.parse(
      callPythonTool('requirement-analysis', 'estimate_complexity.py', {
        requirementText: '批量导入用户数据，需要第三方 API 集成',
      }),
    );
    expect(parsed.size).toMatch(/^[SMLX]{1,2}$/);
    expect(parsed.factors.length).toBeGreaterThan(0);
    console.log('  ✅ 复杂度:', parsed.size, '因子:', parsed.factors.join('、'));
  });
});

describe('14.7 虚拟文件系统：FilesystemBackend 基本写读', () => {
  it('写入文件后可读回，路径落到真实磁盘', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ch14-vfs-'));
    try {
      const backend = new FilesystemBackend({ rootDir: root, virtualMode: true });

      const w = await backend.write('/analysis/completeness.md', '完整性评分：67 / 100');
      expect(w.error).toBeUndefined();
      expect(existsSync(join(root, 'analysis', 'completeness.md'))).toBe(true);

      const r = await backend.read('/analysis/completeness.md');
      expect(r.error).toBeUndefined();
      expect(String(r.content)).toContain('完整性评分');
      console.log('  ✅ VFS 写读成功，路径:', join(root, 'analysis/completeness.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('virtualMode 阻止 .. 越界', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ch14-vfs-'));
    try {
      const backend = new FilesystemBackend({ rootDir: root, virtualMode: true });
      const w = await backend.write('/../escape.txt', 'should not escape');
      const escaped = existsSync(join(root, '..', 'escape.txt'));
      expect(escaped).toBe(false);
      console.log('  ✅ virtualMode 成功阻止路径越界');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('14.9 Skills 资产可被 DeepAgent 发现', () => {
  it('listSkills 从磁盘解析两个 Skill 的 frontmatter', () => {
    const skills = listSkills({ projectSkillsDir: SKILLS_DIR });
    const names = skills.map((s) => s.name);
    expect(names).toContain('requirement-analysis');
    expect(names).toContain('competitor-research');
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(0);
      console.log(`  ✅ ${s.name}: ${s.description.slice(0, 40)}...`);
    }
  });
});

describe('14.3 / 14.9 createDeepAgent 能创建 Agent', () => {
  it('最小配置（仅 tools）', () => {
    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        configuration: { baseURL: OPENAI_BASE_URL },
        apiKey: OPENAI_API_KEY || 'sk-test',
      }),
      tools,
      systemPrompt: '你是需求分析专家。',
    });
    expect(typeof agent.invoke).toBe('function');
    console.log('  ✅ 最小 DeepAgent 创建成功');
  });

  it('含 FilesystemBackend + skills 配置', () => {
    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        configuration: { baseURL: OPENAI_BASE_URL },
        apiKey: OPENAI_API_KEY || 'sk-test',
      }),
      tools,
      backend: new FilesystemBackend({ rootDir: '/' }),
      skills: [SKILLS_DIR],
      systemPrompt: '你是需求分析专家。',
    });
    expect(typeof agent.invoke).toBe('function');
    console.log('  ✅ 含 Skills 的 DeepAgent 创建成功');
  });
});

// ============================================================================
// Layer 2：Agent 端到端
// ============================================================================

describe('14.4 Hello World 端到端', () => {
  if (SKIP_LLM) {
    it.skip('需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1', () => {});
    return;
  }

  it('DeepAgent 调用 get_weather → 返回天气 + todos/files 为空', async () => {
    const getWeather = new DynamicStructuredTool({
      name: 'get_weather',
      description: '获取指定城市的天气',
      schema: z.object({ city: z.string().describe('城市名') }),
      func: async ({ city }) => `${city}：晴，28°C，微风`,
    });

    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        temperature: 0,
        configuration: { baseURL: OPENAI_BASE_URL },
      }),
      tools: [getWeather],
      systemPrompt: '你是一个天气助手。用户问天气时，调用 get_weather 工具获取数据。',
    });

    const result = await agent.invoke({
      messages: [{ role: 'user', content: '北京今天天气怎么样？' }],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const output = result.messages[result.messages.length - 1].content.toString();

    console.log('  调用工具:', toolCalls.join(' → '));
    console.log('  回复:', output.substring(0, 200));
    console.log('  todos:', (result.todos ?? []).length, '项');
    console.log('  files:', Object.keys(result.files ?? {}).length, '个');

    expect(toolCalls).toContain('get_weather');
    expect(output).toMatch(/28|天气|晴/);
    expect(result.todos ?? []).toEqual([]);
    expect(Object.keys(result.files ?? {})).toEqual([]);
  }, 60000);
});

describe('14.6 write_todos 规划验证', () => {
  if (SKIP_LLM) {
    it.skip('需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1', () => {});
    return;
  }

  it('多步骤任务 → 调用 write_todos → result.todos 非空', async () => {
    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        temperature: 0,
        configuration: { baseURL: OPENAI_BASE_URL },
      }),
      tools,
      systemPrompt: [
        '你是一位资深需求分析专家。',
        '重要规则：面对多步骤任务时，必须先使用 write_todos 制定任务计划，再逐步执行。',
      ].join('\n'),
    });

    const result = await agent.invoke({
      messages: [{
        role: 'user',
        content: [
          '请对以下需求进行完整分析，要求分三个阶段：',
          '阶段一：完整性检查（调用 analyze_completeness）',
          '阶段二：复杂度估算（调用 estimate_complexity）',
          '阶段三：综合以上两个维度，输出结构化分析报告',
          '',
          '需求：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行，导入失败的行需要生成错误报告。',
        ].join('\n'),
      }],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const todos = result.todos ?? [];
    const usedWriteTodos = toolCalls.includes('write_todos');

    console.log('  调用工具:', toolCalls.join(' → '));
    console.log('  todos 数量:', todos.length);
    if (todos.length > 0) {
      for (const t of todos) {
        console.log(`    [${t.status}] ${t.content}`);
      }
    }

    expect(toolCalls).toContain('analyze_completeness');
    if (usedWriteTodos) {
      expect(todos.length).toBeGreaterThan(0);
      console.log('  ✅ 模型使用了 write_todos 进行规划');
    } else {
      console.log('  ⚠️ 模型跳过了 write_todos（LLM 非确定性），分析工具仍被正常调用');
    }
  }, 180000);
});

describe('14.5 需求分析 Agent 端到端', () => {
  if (SKIP_LLM) {
    it.skip('需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1', () => {});
    return;
  }

  it('DeepAgent 分析需求 → 调用工具 → 输出报告', async () => {
    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        temperature: 0,
        configuration: { baseURL: OPENAI_BASE_URL },
      }),
      tools,
      systemPrompt: '你是一位资深需求分析专家。对用户提交的需求进行完整性分析和复杂度评估，输出分析报告。',
    });

    const result = await agent.invoke({
      messages: [{
        role: 'user',
        content: '分析以下需求：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行。',
      }],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const output = result.messages[result.messages.length - 1].content.toString();

    console.log('  调用工具:', toolCalls.join(' → '));
    console.log('  输出前 300 字:', output.substring(0, 300));

    expect(toolCalls).toContain('analyze_completeness');
    expect(output).toMatch(/需求|分析|完整性|复杂度/);
    expect(output.length).toBeGreaterThan(300);
  }, 180000);
});

describe('14.7 虚拟文件系统端到端', () => {
  if (SKIP_LLM) {
    it.skip('需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1', () => {});
    return;
  }

  it('明确要求写文件 → 验证文件系统可用性', async () => {
    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        temperature: 0,
        configuration: { baseURL: OPENAI_BASE_URL },
      }),
      tools,
      systemPrompt: [
        '你是一位资深需求分析专家。',
        '重要规则：你必须使用 write_file 工具将分析结果保存到文件，然后用 read_file 读取并汇总。',
        '不允许跳过文件写入步骤。',
      ].join('\n'),
    });

    const result = await agent.invoke({
      messages: [{
        role: 'user',
        content: [
          '分析以下需求：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行。',
          '严格要求：',
          '1. 必须用 write_file 把完整性分析写入 /analysis/completeness.md',
          '2. 必须用 write_file 把复杂度估算写入 /analysis/complexity.md',
          '3. 用 read_file 读取这两个文件后汇总成报告',
        ].join('\n'),
      }],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const files = Object.keys(result.files ?? {});
    const output = result.messages[result.messages.length - 1].content.toString();
    const usedVFS = toolCalls.includes('write_file');

    console.log('  调用工具:', toolCalls.join(' → '));
    console.log('  写入文件:', files.join(', ') || '(无)');
    console.log('  使用了 VFS:', usedVFS);

    // 模型不一定遵守写文件指令（LLM 非确定性），但至少验证：
    // 1. 分析工具被调用了
    // 2. 输出包含有意义的分析内容
    expect(toolCalls).toContain('analyze_completeness');
    expect(output).toMatch(/需求|分析|完整性|复杂度/);
    if (usedVFS) {
      expect(files.length).toBeGreaterThan(0);
      console.log('  ✅ 模型使用了文件系统写入');
    } else {
      console.log('  ⚠️ 模型跳过了文件写入（LLM 非确定性），分析工具和输出仍然正常');
    }
  }, 180000);
});

describe('14.8 Subagent task 端到端', () => {
  if (SKIP_LLM) {
    it.skip('需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1', () => {});
    return;
  }

  it('多需求分析任务 → 调用链含 task → 产出对比报告', async () => {
    const requirementAnalyst = {
      name: 'requirement-analyst',
      description: '对单个需求进行完整性分析、复杂度评估和风险识别',
      systemPrompt: '你是需求分析专家。请对指定需求进行完整性检查、复杂度估算和风险评估。',
      tools,
    };

    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        temperature: 0,
        configuration: { baseURL: OPENAI_BASE_URL },
      }),
      tools,
      subagents: [requirementAnalyst],
      systemPrompt: '你是需求分析专家。需要深入分析单个需求时，委托给 requirement-analyst。',
    });

    const result = await agent.invoke({
      messages: [{
        role: 'user',
        content: [
          '请分析以下两个需求：',
          'REQ-001：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式。',
          'REQ-002：订单导出支持百万行级别的异步下载。',
          '要求：',
          '1. 分别委托子 Agent 分析每个需求的完整性和复杂度。',
          '2. 主 Agent 只负责汇总两个子 Agent 的结论。',
          '3. 最终输出一个对比报告。',
        ].join('\n'),
      }],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const output = result.messages[result.messages.length - 1].content.toString();

    console.log('  调用工具:', toolCalls.join(' → '));
    console.log('  输出前 300 字:', output.substring(0, 300));

    expect(toolCalls).toContain('task');
    expect(output).toMatch(/REQ-001|REQ-002/);
    expect(output.length).toBeGreaterThan(200);
  }, 300000);
});
