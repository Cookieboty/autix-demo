/**
 * DeepAgent 虚拟文件系统 Demo — 第十四章 14.7 配套脚本
 *
 * 演示虚拟文件系统的写入和读取：
 * 1. 明确要求 Agent 将分析结果写入指定路径
 * 2. Agent 调用 write_file 写入、read_file 读回
 * 3. 打印 result.files 中的文件路径和内容摘要
 *
 * 运行：
 *   cd services/chat && bun run scripts/run-deepagent-vfs-demo.ts
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
    '重要规则：你必须使用 write_file 工具将分析结果保存到文件，然后用 read_file 读取并汇总。',
  ].join('\n'),
});

console.log('='.repeat(80));
console.log('📁 DeepAgent 虚拟文件系统 Demo');
console.log('='.repeat(80));

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
const files = result.files ?? {};
const fileKeys = Object.keys(files);

console.log(`\n🔧 调用链: ${toolCalls.join(' → ')}`);
console.log(`📁 files: ${fileKeys.length} 个`);
for (const [path, content] of Object.entries(files)) {
  const preview = String(content).replace(/\s+/g, ' ').slice(0, 100);
  console.log(`  ${path} (${String(content).length} 字符): ${preview}...`);
}

const output = result.messages[result.messages.length - 1].content.toString();
console.log('\n🤖 Agent 输出:');
console.log('─'.repeat(80));
console.log(output);
console.log('─'.repeat(80));
console.log(`📊 输出长度: ${output.length} 字符`);
