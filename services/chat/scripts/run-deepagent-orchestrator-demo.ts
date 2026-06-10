/**
 * DeepAgent 跨需求协调 Demo — 第十五章 15.3 / 15.4 配套脚本
 *
 * 演示流程：
 * 1. createDeepOrchestrator 把第九章 createAnalysisGraph 包成 requirement_analyst 子 Agent
 * 2. DeepAgent 外层自己用 write_todos 拆「逐需求分析 + 汇总」
 * 3. 对每个需求用 task 委派给子 Agent，子 Agent 内部跑 Supervisor + 4 专家 + Critic-Refine
 * 4. 把每个需求摘要写进虚拟文件系统，最后汇总成总体影响评估
 *
 * 本脚本用 streamEvents(v2) 实时打印「每一步」与「每一次真实 LLM 调用」：
 * - 🧠 每次真实 LLM 调用（含子 Agent 内部第九章那张图的调用）
 * - 🔧 每次工具调用（write_todos / task 委派 / write_file / read_file / save_report）
 * - ✅ 工具返回
 *
 * 运行：
 *   cd services/chat && bun run scripts/run-deepagent-orchestrator-demo.ts
 */
import { ChatOpenAI } from '@langchain/openai';
import { config } from 'dotenv';
import { createDeepOrchestrator } from '../src/llm/deepagent/deep-orchestrator.service';

config({ path: new URL('../.env', import.meta.url).pathname });

const model = new ChatOpenAI({
  model: process.env.DEEPAGENT_MODEL || 'gpt-5.4',
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
});

const agent = createDeepOrchestrator({ model });

const task = [
  '我们要评估以下三个需求对核心系统的总体影响，请逐个分析后给出整体结论：',
  '- REQ-001：支持企业微信扫码登录',
  '- REQ-002：订单导出支持百万行级别的异步下载',
  '- REQ-003：为后台操作增加细粒度的审计日志',
].join('\n');

console.log('='.repeat(80));
console.log('🧭 DeepAgent 跨需求协调 Demo（createAnalysisGraph 作为子 Agent）');
console.log('='.repeat(80));
console.log('📨 任务：\n' + task);
console.log('─'.repeat(80));
console.log('▶ 开始执行（实时打印每一步 + 每次真实 LLM 调用）\n');

const oneLine = (v: unknown, n = 100) =>
  String(typeof v === 'string' ? v : JSON.stringify(v) ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, n);

// 工具入参在事件里被包成 { input: "<json 字符串>" }，这里拆出真实参数对象
function toolArgs(data: unknown): any {
  const raw = (data as any)?.input;
  const inner = raw && typeof raw === 'object' && 'input' in raw ? (raw as any).input : raw;
  if (typeof inner === 'string') {
    try {
      return JSON.parse(inner);
    } catch {
      return inner;
    }
  }
  return inner;
}

// task 委派会进入子 Agent；用一个标志给子图内的步骤加缩进，便于看出层级
let inSubagent = 0;
const indent = () => '  '.repeat(inSubagent > 0 ? 1 : 0);

let llmCalls = 0;
let rootRunId: string | undefined;
let finalState: any = null;

for await (const ev of agent.streamEvents({ messages: [{ role: 'user', content: task }] }, { version: 'v2' })) {
  if (!rootRunId && ev.event === 'on_chain_start') rootRunId = ev.run_id;

  switch (ev.event) {
    case 'on_chat_model_start': {
      llmCalls++;
      const m = (ev.metadata as any)?.ls_model_name || (model as any).model || 'llm';
      console.log(`${indent()}🧠 [真实 LLM 调用 #${llmCalls}] 模型=${m}`);
      break;
    }
    case 'on_tool_start': {
      const args = toolArgs(ev.data);
      if (ev.name === 'task') {
        inSubagent++;
        console.log(`📂 委派子 Agent：${args?.subagent_type ?? ''} — ${oneLine(args?.description, 60)}`);
      } else {
        console.log(`${indent()}🔧 工具：${ev.name}  入参=${oneLine(args, 80)}`);
      }
      break;
    }
    case 'on_tool_end': {
      const out = (ev.data as any)?.output;
      const content = typeof out?.content === 'string' ? out.content : out;
      console.log(`${indent()}   ✅ 返回：${oneLine(content, 80)}`);
      if (ev.name === 'task') inSubagent = Math.max(0, inSubagent - 1);
      break;
    }
    case 'on_chain_end': {
      if (ev.run_id === rootRunId) finalState = (ev.data as any)?.output;
      break;
    }
  }
}

console.log('\n' + '─'.repeat(80));
console.log(`📊 共触发真实 LLM 调用：${llmCalls} 次`);
console.log(`📋 todos：${(finalState?.todos ?? []).length} 项`);
console.log(`📁 files：${Object.keys(finalState?.files ?? {}).join(', ') || '(无)'}`);

const messages = finalState?.messages ?? [];
const output = messages.length ? String(messages[messages.length - 1].content) : '(无输出)';
console.log('\n🤖 总体影响评估:');
console.log('─'.repeat(80));
console.log(output);
console.log('─'.repeat(80));
console.log(`📊 输出长度: ${output.length} 字符`);
