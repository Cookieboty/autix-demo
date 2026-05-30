/**
 * DeepAgent 产品调研 Demo — 第十四章 14.5 / 14.9 配套脚本
 *
 * 演示流程：
 * 1. 复用第十三章的 Python 工具脚本（competitor-research / requirement-analysis）
 * 2. createDeepAgent 自动提供 write_todos / 虚拟文件系统 / task 子 Agent
 * 3. 通过 FilesystemBackend + skills 把第十三章的 SKILL.md 资产接入 DeepAgent
 *
 * 说明（与第十四章正文一致的关键点）：
 * - skills 是“从 backend 加载”的，不是直接读 OS 磁盘。
 *   默认 backend 是内存态 StateBackend，加载不到磁盘上的 SKILL.md。
 *   要从真实磁盘加载，必须显式传 FilesystemBackend({ rootDir: '/' })。
 * - Python 工具仍需在 tools 中显式注册；SKILL.md 的 allowed-tools 只是声明性引用。
 *
 * 运行：
 *   cd services/chat && bun run scripts/run-deepagent-research-demo.ts
 */
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { execSync } from 'child_process';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: new URL('../.env', import.meta.url).pathname });

const SKILLS_DIR = join(import.meta.dir, '../src/skills/definitions');

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

const model = new ChatOpenAI({
  model: process.env.DEEPAGENT_MODEL || 'gpt-5.4',
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
});

const agent = createDeepAgent({
  model,
  tools,
  // 关键：用 FilesystemBackend 才能从真实磁盘加载 SKILL.md
  backend: new FilesystemBackend({ rootDir: '/' }),
  skills: [SKILLS_DIR],
  systemPrompt: '你是一位产品调研分析师。需要专业能力时，可以加载相应的 skill；输出专业的竞品分析报告。',
});

console.log('='.repeat(80));
console.log('🔬 DeepAgent 产品调研 Demo（含 Skills 接入）');
console.log('='.repeat(80));

const result = await agent.invoke({
  messages: [{ role: 'user', content: '调研中小团队项目管理工具竞品，我们想做一个轻量级项目管理工具。' }],
});

const toolCalls = result.messages
  .filter((m: any) => m.tool_calls?.length > 0)
  .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));

const output = result.messages[result.messages.length - 1].content.toString();

console.log(`\n🔧 调用链: ${toolCalls.join(' → ')}`);
console.log(`📋 todos: ${(result.todos ?? []).length} 项`);
console.log(`📁 files: ${Object.keys(result.files ?? {}).join(', ') || '(无)'}`);
console.log('\n🤖 Agent 输出:');
console.log('─'.repeat(80));
console.log(output);
console.log('─'.repeat(80));
console.log(`📊 输出长度: ${output.length} 字符`);
