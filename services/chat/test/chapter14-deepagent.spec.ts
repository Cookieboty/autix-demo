/**
 * chapter14-deepagent.spec.ts
 *
 * 第十四章《DeepAgent 入门——一个开箱即用的 Agent Harness》配套测试
 *
 * Layer 1：零 LLM 依赖
 *   - Python 工具脚本独立行为
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
    name: 'search_competitors',
    description: '搜索竞品信息，返回竞品名称、定位、定价等关键信息。',
    schema: z.object({ query: z.string().describe('搜索关键词') }),
    func: async ({ query }) =>
      callPythonTool('competitor-research', 'search_competitors.py', { query }),
  }),
  new DynamicStructuredTool({
    name: 'search_best_practices',
    description: '搜索行业最佳实践和常见做法。',
    schema: z.object({ topic: z.string().describe('搜索主题') }),
    func: async ({ topic }) =>
      callPythonTool('competitor-research', 'search_best_practices.py', { topic }),
  }),
];

// ============================================================================
// Layer 1：零 LLM 依赖
// ============================================================================

describe('14.5 Python 工具独立验证', () => {
  it('search_competitors.py 返回竞品列表', () => {
    const parsed = JSON.parse(
      callPythonTool('competitor-research', 'search_competitors.py', { query: '项目管理工具' }),
    );
    expect(parsed.results.length).toBeGreaterThan(2);
    console.log('  ✅ 搜索到', parsed.results.length, '个竞品');
  });

  it('search_best_practices.py 返回最佳实践', () => {
    const parsed = JSON.parse(
      callPythonTool('competitor-research', 'search_best_practices.py', { topic: '批量导入' }),
    );
    expect(parsed.practices.length).toBeGreaterThan(0);
    console.log('  ✅ 最佳实践:', parsed.practices.length, '条');
  });
});

describe('14.9 Skills 资产可被 DeepAgent 发现', () => {
  it('listSkills 从磁盘解析两个 Skill 的 frontmatter', () => {
    const skills = listSkills({ projectSkillsDir: SKILLS_DIR });
    const names = skills.map((s) => s.name);
    expect(names).toContain('competitor-research');
    expect(names).toContain('requirement-analysis');
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
      systemPrompt: '你是产品调研分析师。',
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
      systemPrompt: '你是产品调研分析师。',
    });
    expect(typeof agent.invoke).toBe('function');
    console.log('  ✅ 含 Skills 的 DeepAgent 创建成功');
  });
});

// ============================================================================
// Layer 2：Agent 端到端
// ============================================================================

describe('14.5 调研 Agent 端到端', () => {
  if (SKIP_LLM) {
    it.skip('需要 OPENAI_API_KEY 且 RUN_LLM_DEEPAGENT_TESTS=1', () => {});
    return;
  }

  it('DeepAgent 调研竞品 → 调用工具 → 输出报告', async () => {
    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_DEEPAGENT_TEST_MODEL,
        temperature: 0,
        configuration: { baseURL: OPENAI_BASE_URL },
      }),
      tools,
      systemPrompt: '你是一位产品调研分析师。调研竞品并输出竞品分析报告。',
    });

    const result = await agent.invoke({
      messages: [{ role: 'user', content: '调研中小团队项目管理工具竞品，我们想做一个轻量级项目管理工具。' }],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const output = result.messages[result.messages.length - 1].content.toString();

    console.log('  调用工具:', toolCalls.join(' → '));
    console.log('  输出前 300 字:', output.substring(0, 300));

    expect(toolCalls).toContain('search_competitors');
    expect(output).toMatch(/竞品|项目管理/);
    expect(output.length).toBeGreaterThan(300);
  }, 180000);
});
