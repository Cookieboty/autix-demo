/**
 * HITL 审批闭环 Demo — 第十八章 18.5 配套脚本
 *
 * 演示「敏感操作（write 级 save_report）停下来等人工审批」的完整闭环：
 *   1. createDeepAgent 传入 checkpointer(MemorySaver) + interruptOn { save_report: true }
 *   2. Agent 跑到要调 save_report 时 interrupt()——保存执行快照、挂起、把控制权交回
 *   3. 我们读出待审批的工具调用，模拟「人工点批准 / 拒绝」
 *   4. 用同一个 thread_id + Command({ resume }) 从快照恢复，Agent 真正执行（或跳过）save_report
 *
 * 为了让 HITL 机制清晰可见，这里用一个**单工具**的精简 DeepAgent（只挂 save_report），
 * 而不是第十五章那个跨工单重型编排——焦点是审批闸，不是分析深度。
 * 每一步实时打印 + 调用真实 LLM。
 *
 * 运行：cd services/chat && bun run scripts/run-hitl-approval-demo.ts
 */
import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver, Command } from '@langchain/langgraph';
import { createDeepAgent } from 'deepagents';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';

config({ path: new URL('../.env', import.meta.url).pathname });

const SAVE_REPORT = 'save_report';

const model = new ChatOpenAI({
  model: process.env.DEEPAGENT_MODEL || 'gpt-5.4',
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
});

const saveReport = new DynamicStructuredTool({
  name: SAVE_REPORT,
  description: '把最终报告归档（敏感写操作，需要人工审批）。',
  schema: z.object({ title: z.string().describe('报告标题'), content: z.string().describe('报告正文') }),
  func: async ({ title }) => `已归档报告：《${title}》`,
});

// HITL 三件套：checkpointer（执行快照）+ interruptOn（哪些工具要审批）
const checkpointer = new MemorySaver();
const agent = createDeepAgent({
  model: model as never,
  tools: [saveReport] as never,
  systemPrompt:
    '你是报告助手。针对用户给的主题，先写一段 3-4 句的简短结论，然后必须调用 save_report 工具把它归档（title 用主题、content 用结论）。',
  checkpointer,
  interruptOn: { [SAVE_REPORT]: true },
});

const threadId = `hitl-demo-${Date.now()}`;
const runConfig = { version: 'v2' as const, configurable: { thread_id: threadId } };
const task = '主题：为后台操作增加细粒度审计日志的价值。';

const oneLine = (v: unknown, n = 120) =>
  String(typeof v === 'string' ? v : JSON.stringify(v) ?? '').replace(/\s+/g, ' ').slice(0, n);

let llmCalls = 0;

async function streamPhase(input: unknown, label: string) {
  console.log(`\n▶ ${label}\n` + '─'.repeat(72));
  for await (const ev of agent.streamEvents(input as never, runConfig)) {
    if (ev.event === 'on_chat_model_start') {
      llmCalls++;
      console.log(`🧠 [真实 LLM 调用 #${llmCalls}]`);
    } else if (ev.event === 'on_tool_start') {
      console.log(`🔧 工具调用：${ev.name}`);
    } else if (ev.event === 'on_tool_end') {
      console.log(`   ✅ ${ev.name} 返回：${oneLine((ev.data as any)?.output?.content ?? (ev.data as any)?.output)}`);
    }
  }
}

console.log('='.repeat(72));
console.log('🛡  HITL 审批闭环 Demo（save_report 为 write 级，需人工审批）');
console.log('='.repeat(72));
console.log('📨 任务：' + task);

// 阶段一：跑到 save_report 前挂起
await streamPhase({ messages: [{ role: 'user', content: task }] }, '阶段一：执行至敏感操作前挂起');

const state = await agent.getState(runConfig);
const pending = (state.tasks ?? []).flatMap((t: any) => t.interrupts ?? []);

if (pending.length === 0) {
  console.log('\n⚠️  本次未触发 save_report 审批（模型未调用该工具），可重跑。');
  console.log(`📊 共触发真实 LLM 调用：${llmCalls} 次`);
  process.exit(0);
}

console.log('\n⏸  执行已挂起，等待人工审批：');
for (const intr of pending) {
  console.log('   审批请求：' + oneLine(intr.value, 160));
}

// 模拟「人工点批准」——每个挂起的工具调用给一个 approve 决策
console.log('\n👤 人工决策：approve（批准归档）');
await streamPhase(
  new Command({ resume: { decisions: pending.map(() => ({ type: 'approve' })) } }),
  '阶段二：审批通过，从快照恢复并执行 save_report',
);

const finalState = await agent.getState(runConfig);
const messages = (finalState.values as any)?.messages ?? [];
const output = messages.length ? String(messages[messages.length - 1].content) : '(无输出)';

console.log('\n' + '─'.repeat(72));
console.log(`📊 共触发真实 LLM 调用：${llmCalls} 次`);
console.log('🤖 最终输出：' + oneLine(output, 300));
