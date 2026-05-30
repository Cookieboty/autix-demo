/**
 * chapter13-skills.spec.ts
 *
 * 第十三章《Skills——把能力沉淀为可复用资产》配套测试
 *
 * Layer 1：load_skill 读 SKILL.md + Python 工具脚本（零 LLM 依赖）
 * Layer 2：Agent + load_skill + 已显式注册的 Python 工具端到端
 *          需要 OPENAI_API_KEY，并显式设置 RUN_LLM_SKILLS_TESTS=1
 *          可用 LLM_SKILLS_TEST_MODEL 指定真实模型，默认 gpt-5.4
 *
 * 运行方式：
 *   bun test test/chapter13-skills.spec.ts
 */
import { describe, it, expect } from 'bun:test';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: new URL('../.env', import.meta.url).pathname });

const SKILLS_DIR = join(import.meta.dir, '../src/skills/definitions');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const LLM_SKILLS_TEST_MODEL = process.env.LLM_SKILLS_TEST_MODEL || 'gpt-5.4';
const RUN_LLM_SKILLS_TESTS = process.env.RUN_LLM_SKILLS_TESTS === '1';
const SKIP_LLM = !OPENAI_API_KEY || !RUN_LLM_SKILLS_TESTS;

if (SKIP_LLM) {
  console.warn('⚠️  LLM 集成测试将跳过：需要 OPENAI_API_KEY 且 RUN_LLM_SKILLS_TESTS=1');
}

// ── 调用 Python 工具的通用函数 ──────────────────────────────────────

function callPythonTool(skillName: string, scriptName: string, input: Record<string, unknown>): string {
  const scriptPath = join(SKILLS_DIR, skillName, 'scripts', scriptName);
  return execSync(`python3 "${scriptPath}"`, {
    input: JSON.stringify(input),
    encoding: 'utf-8',
  }).trim();
}

// ── 构造 load_skill Tool ─────────────────────────────────────────
// LangChain Skills pattern 的核心入口：让 Agent 按需加载专业 prompt/context。
// 教学 PoC：load_skill 只读取 Markdown，不解析 frontmatter，也不自动注册工具。

const loadSkill = new DynamicStructuredTool({
  name: 'load_skill',
  description: `加载专业技能的完整提示词和上下文。

可用技能：
- requirement-analysis: 需求分析专家（自带工具：analyze_completeness, estimate_complexity）
- competitor-research: 竞品调研专家（自带工具：search_competitors, search_best_practices）

返回技能的完整 Markdown 内容。加载后，Agent 会根据技能文本使用已经显式注册的工具。`,
  schema: z.object({
    skillName: z.string().describe('技能名称'),
  }),
  func: async ({ skillName }) => {
    return readFileSync(join(SKILLS_DIR, skillName, 'SKILL.md'), 'utf-8');
  },
});

// ── Python 工具的 LangChain 包装（用于 Agent 调用） ─────────────────

const analyzeCompleteness = new DynamicStructuredTool({
  name: 'analyze_completeness',
  description: '分析需求描述的完整性，从六个维度检查是否缺少关键信息。',
  schema: z.object({ requirementText: z.string().describe('需求描述文本') }),
  func: async ({ requirementText }) =>
    callPythonTool('requirement-analysis', 'analyze_completeness.py', { requirementText }),
});

const estimateComplexity = new DynamicStructuredTool({
  name: 'estimate_complexity',
  description: '估算需求的技术复杂度，返回 T-shirt size 和预计工期。',
  schema: z.object({ requirementText: z.string().describe('需求描述') }),
  func: async ({ requirementText }) =>
    callPythonTool('requirement-analysis', 'estimate_complexity.py', { requirementText }),
});

const searchCompetitors = new DynamicStructuredTool({
  name: 'search_competitors',
  description: '搜索竞品信息，返回竞品名称、定位、定价等关键信息。',
  schema: z.object({ query: z.string().describe('搜索关键词') }),
  func: async ({ query }) =>
    callPythonTool('competitor-research', 'search_competitors.py', { query }),
});

const searchBestPractices = new DynamicStructuredTool({
  name: 'search_best_practices',
  description: '搜索行业最佳实践和常见做法。',
  schema: z.object({ topic: z.string().describe('搜索主题') }),
  func: async ({ topic }) =>
    callPythonTool('competitor-research', 'search_best_practices.py', { topic }),
});

const allTools = [loadSkill, analyzeCompleteness, estimateComplexity, searchCompetitors, searchBestPractices];

// ============================================================================
// Layer 1：Python 工具独立行为（零 LLM）
// ============================================================================

describe('13.4 load_skill Tool', () => {
  it('tool 元信息正确', () => {
    expect(loadSkill.name).toBe('load_skill');
    expect(loadSkill.description).toContain('requirement-analysis');
    expect(loadSkill.description).toContain('analyze_completeness');
    console.log('  ✅ tool name:', loadSkill.name);
  });

  it('加载 SKILL.md 包含工具说明和子扩展', async () => {
    const content = await loadSkill.invoke({ skillName: 'requirement-analysis' });
    expect(content).toContain('analyze_completeness');
    expect(content).toContain('estimate_complexity');
    expect(content).toContain('load_skill');
    console.log('  ✅ SKILL.md 说明了自带工具 + 子扩展');
  });
});

describe('13.4 Python 工具独立验证', () => {
  it('analyze_completeness.py', () => {
    const result = callPythonTool('requirement-analysis', 'analyze_completeness.py', {
      requirementText: '作为管理员，我需要能够批量导入用户数据，支持 CSV 格式',
    });
    const parsed = JSON.parse(result);
    expect(parsed.completenessScore).toBeGreaterThan(0);
    expect(parsed.coveredDimensions).toContain('用户角色');
    expect(parsed.missingDimensions.length).toBeGreaterThan(0);
    console.log('  ✅ 完整性评分:', parsed.completenessScore);
    console.log('  ✅ 覆盖:', parsed.coveredDimensions.join(', '));
    console.log('  ✅ 缺失:', parsed.missingDimensions.join(', '));
  });

  it('estimate_complexity.py', () => {
    const result = callPythonTool('requirement-analysis', 'estimate_complexity.py', {
      requirementText: '批量导入用户数据，支持 CSV，需要第三方 API 集成',
    });
    const parsed = JSON.parse(result);
    expect(['S', 'M', 'L', 'XL']).toContain(parsed.size);
    console.log('  ✅ 复杂度:', parsed.size, '预计:', parsed.estimatedDays);
  });

  it('search_competitors.py', () => {
    const result = callPythonTool('competitor-research', 'search_competitors.py', {
      query: '项目管理工具',
    });
    const parsed = JSON.parse(result);
    expect(parsed.results.length).toBeGreaterThan(2);
    console.log('  ✅ 搜索到', parsed.results.length, '个竞品');
    for (const r of parsed.results) {
      console.log(`    - ${r.name}: ${r.positioning}`);
    }
  });

  it('search_best_practices.py', () => {
    const result = callPythonTool('competitor-research', 'search_best_practices.py', {
      topic: '批量导入',
    });
    const parsed = JSON.parse(result);
    expect(parsed.practices.length).toBeGreaterThan(0);
    console.log('  ✅ 最佳实践:', parsed.practices.length, '条');
  });
});

// ============================================================================
// Layer 2：Agent + load_skill + Python 工具 端到端
// ============================================================================

describe('13.7 Agent + Skills 端到端', () => {
  if (SKIP_LLM) {
    it.skip('需要 OPENAI_API_KEY 且 RUN_LLM_SKILLS_TESTS=1', () => {});
    return;
  }

  const model = new ChatOpenAI({
    model: LLM_SKILLS_TEST_MODEL,
    temperature: 0,
    configuration: { baseURL: OPENAI_BASE_URL },
  });

  it('需求分析：Agent 加载 Skill → 调用 Python 工具 → 输出报告', async () => {
    const agent = createReactAgent({
      llm: model,
      tools: allTools,
      prompt: '你是一个产品助手。你可以通过 load_skill 加载专业技能来增强你的能力。加载技能后，严格按照技能中的指令和工作流执行，使用已注册且技能中说明的工具。',
    });

    const result = await agent.invoke({
      messages: [new HumanMessage(
        '帮我分析这个需求的完整性：作为管理员，我需要能够批量导入用户数据，支持 CSV 格式',
      )],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const output = result.messages[result.messages.length - 1].content.toString();

    console.log('  调用工具:', toolCalls.join(' → '));
    console.log('  输出前 300 字:', output.substring(0, 300));

    expect(toolCalls).toContain('load_skill');
    expect(toolCalls).toContain('analyze_completeness');
    expect(output).toMatch(/完整性.*\d+/);
    expect(output.length).toBeGreaterThan(200);
  }, 120000);

  it('竞品调研：Agent 加载 Skill → 调用 Python 工具 → 输出报告', async () => {
    const agent = createReactAgent({
      llm: model,
      tools: allTools,
      prompt: '你是一个产品助手。你可以通过 load_skill 加载专业技能来增强你的能力。加载技能后，严格按照技能中的指令和工作流执行，使用已注册且技能中说明的工具。',
    });

    const result = await agent.invoke({
      messages: [new HumanMessage(
        '帮我做一下项目管理工具的竞品调研，我们想做一个面向中小团队的轻量级项目管理工具',
      )],
    });

    const toolCalls = result.messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
    const output = result.messages[result.messages.length - 1].content.toString();

    console.log('  调用工具:', toolCalls.join(' → '));
    console.log('  输出前 300 字:', output.substring(0, 300));

    expect(toolCalls).toContain('load_skill');
    expect(toolCalls).toContain('search_competitors');
    expect(output).toMatch(/竞品/);
    expect(output.length).toBeGreaterThan(300);
  }, 120000);
});
