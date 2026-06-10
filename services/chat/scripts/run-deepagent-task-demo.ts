/**
 * DeepAgent Subagent task 委派 Demo — 第十四章 14.8 配套脚本
 *
 * 演示 task 子 Agent 委派：
 * 1. 声明一个专用子 Agent（requirement-analyst）
 * 2. 给两个需求，要求主 Agent 委派子 Agent 分别分析
 * 3. 观察调用链中 task 的出现，以及主 Agent 只做汇总
 *
 * 运行：
 *   cd services/chat && bun run scripts/run-deepagent-task-demo.ts
 */
import { createDeepAgent, type SubAgent } from 'deepagents';
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

const requirementAnalyst: SubAgent = {
  name: 'requirement-analyst',
  description: '对单个需求进行完整性分析、复杂度评估和风险识别',
  systemPrompt: '你是需求分析专家。请对指定需求进行完整性检查、复杂度估算和风险评估。',
  tools,
};

const agent = createDeepAgent({
  model: new ChatOpenAI({
    model: process.env.DEEPAGENT_MODEL || 'gpt-5.4',
    temperature: 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  }),
  tools,
  subagents: [requirementAnalyst],
  systemPrompt: '你是需求分析专家。需要深入分析单个需求时，委托给 requirement-analyst 子 Agent。',
});

console.log('='.repeat(80));
console.log('🔀 DeepAgent Subagent task 委派 Demo');
console.log('='.repeat(80));

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
const todos = result.todos ?? [];
const files = Object.keys(result.files ?? {});

console.log(`\n🔧 调用链: ${toolCalls.join(' → ')}`);
console.log(`📋 todos: ${todos.length} 项`);
console.log(`📁 files: ${files.join(', ') || '(无)'}`);

const taskCount = toolCalls.filter(t => t === 'task').length;
if (taskCount > 0) {
  console.log(`🔀 task 委派次数: ${taskCount}`);
} else {
  console.log('⚠️ 模型未使用 task 委派（可能直接在主 Agent 内完成了分析）');
}

const output = result.messages[result.messages.length - 1].content.toString();
console.log('\n🤖 Agent 输出:');
console.log('─'.repeat(80));
console.log(output);
console.log('─'.repeat(80));
console.log(`📊 输出长度: ${output.length} 字符`);
