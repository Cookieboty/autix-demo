/**
 * Skills Demo — 教学级 PoC，演示 Skills 模式的最小链路
 *
 * 演示流程：
 * 1. 每个 Skill 自带 Python 工具脚本（scripts/*.py）
 * 2. Agent 拥有 load_skill + 已显式注册的 Python 工具包装
 * 3. Agent 收到请求 → load_skill 读取 SKILL.md → 按指令调用已注册工具 → 输出报告
 *
 * 运行：
 *   cd services/chat && bun run scripts/run-skill-demo.ts
 */
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
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const SKILL_DEMO_MODEL = process.env.SKILL_DEMO_MODEL || 'gpt-5.4';

// ── 调用 Python 工具 ─────────────────────────────────────────────

function callPythonTool(skillName: string, scriptName: string, input: Record<string, unknown>): string {
  const scriptPath = join(SKILLS_DIR, skillName, 'scripts', scriptName);
  return execSync(`python3 "${scriptPath}"`, {
    input: JSON.stringify(input),
    encoding: 'utf-8',
  }).trim();
}

// ── load_skill 工具 ──────────────────────────────────────────────
// LangChain Skills pattern 的核心入口：让 Agent 按需加载专业 prompt/context。
// 这个 PoC 只读取 SKILL.md 原文，不解析 frontmatter，也不自动注册工具。

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
    const skillPath = join(SKILLS_DIR, skillName, 'SKILL.md');
    console.log(`\n📂 [load_skill] 加载技能: ${skillName}`);
    console.log(`   路径: ${skillPath}`);
    const content = readFileSync(skillPath, 'utf-8');
    console.log(`   内容长度: ${content.length} 字符\n`);
    return content;
  },
});

// ── Python 工具包装 ──────────────────────────────────────────────

const allTools = [
  loadSkill,
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

// ── 创建 Agent ───────────────────────────────────────────────────

const model = new ChatOpenAI({
  model: SKILL_DEMO_MODEL,
  temperature: 0,
  configuration: { baseURL: OPENAI_BASE_URL },
});

const agent = createReactAgent({
  llm: model,
  tools: allTools,
  prompt: '你是一个产品助手。你可以通过 load_skill 加载专业技能来增强你的能力。加载技能后，严格按照技能中的指令和工作流执行，使用已注册且技能中说明的工具。',
});

// ── 运行 ─────────────────────────────────────────────────────────

const queries = [
  '帮我分析这个需求的完整性：作为管理员，我需要能够批量导入用户数据，支持 CSV 和 Excel 格式，导入时自动去重。',
  '帮我做一下项目管理工具的竞品调研，我们想做一个面向中小团队的轻量级项目管理工具。',
];

for (const query of queries) {
  console.log('\n' + '='.repeat(80));
  console.log(`🧑 用户: ${query}`);
  console.log('='.repeat(80));

  const result = await agent.invoke({
    messages: [new HumanMessage(query)],
  });

  const toolCalls = result.messages
    .filter((m: any) => m.tool_calls?.length > 0)
    .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));

  const output = result.messages[result.messages.length - 1].content.toString();

  console.log(`\n🔧 调用链: ${toolCalls.join(' → ')}`);
  console.log('\n🤖 Agent 输出:');
  console.log('─'.repeat(80));
  console.log(output);
  console.log('─'.repeat(80));
  console.log(`📊 输出长度: ${output.length} 字符`);
}
