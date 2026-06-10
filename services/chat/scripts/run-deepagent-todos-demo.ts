/**
 * DeepAgent write_todos 规划 Demo — 第十四章 14.6 配套脚本
 *
 * 演示 write_todos 的规划行为：
 * 1. 给一个多步骤的需求分析任务
 * 2. 观察模型是否先调用 write_todos 拆解步骤
 * 3. 打印 todos 的完整内容（id / content / status）
 *
 * 运行：
 *   cd services/chat && bun run scripts/run-deepagent-todos-demo.ts
 */
import { createDeepAgent } from 'deepagents';
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
  return execSync(`python3 "${scriptPath}"`, { input: JSON.stringify(input), encoding: 'utf-8' }).trim();
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

const agent = createDeepAgent({
  model: new ChatOpenAI({
    model: process.env.DEEPAGENT_MODEL || 'gpt-5.4',
    temperature: 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  }),
  tools,
  systemPrompt: [
    '你是一位资深需求分析专家。',
    '重要规则：面对多步骤任务时，必须先使用 write_todos 制定任务计划，再逐步执行。',
  ].join('\n'),
});

console.log('='.repeat(80));
console.log('📋 DeepAgent write_todos 规划 Demo');
console.log('='.repeat(80));

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

console.log(`\n🔧 调用链: ${toolCalls.join(' → ')}`);
console.log(`📋 todos: ${todos.length} 项`);
if (todos.length > 0) {
  for (const t of todos) {
    console.log(`  [${t.status}] ${t.content}`);
  }
} else {
  console.log('  ⚠️ 模型未使用 write_todos（任务可能被判定为不需要规划）');
}

const output = result.messages[result.messages.length - 1].content.toString();
console.log('\n🤖 Agent 输出:');
console.log('─'.repeat(80));
console.log(output);
console.log('─'.repeat(80));
console.log(`📊 输出长度: ${output.length} 字符`);
