/**
 * 可观测性 Demo — 第十六章配套脚本
 *
 * 演示「本地零外部依赖」的运维态可观测性如何在一次真实分析里同时生效：
 * - 🧵 traceId 贯穿：整段执行包在 runWithTrace 里，所有结构化日志带同一 traceId
 * - 🧠 LLM 调用观测：LlmTracer 作为 callbacks 挂在模型上，每次真实 LLM 调用打 llm_start/llm_end（含 token/latency）
 * - 💰 Token 成本：createAnalysisGraph({ usageService }) opt-in 接入，真实节点调用把 token 写给计量服务
 * - 📈 指标：prom-client 进程内累加，结束时打印 /metrics 的关键片段
 *
 * 运行：
 *   cd services/chat && bun run scripts/run-observability-demo.ts
 *   # 想看彩色日志：LOG_PRETTY=1 bun run scripts/run-observability-demo.ts
 */
import { ChatOpenAI } from '@langchain/openai';
import { config } from 'dotenv';
import { LlmTracer } from '../src/observability/llm-tracer';
import { registry } from '../src/observability/metrics';
import { runWithTrace, newTraceId, getTraceId } from '../src/observability/trace-context';
import { createAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph';
import type { TokenUsageRecord, TokenUsageService } from '../src/llm/cost/token-usage.service';

config({ path: new URL('../.env', import.meta.url).pathname });

// LlmTracer 挂在模型上 → 所有嵌套调用（专家子图、Critic-Refine）都会触发回调
const tracer = new LlmTracer();
const model = new ChatOpenAI({
  model: process.env.LLM_OBS_TEST_MODEL || 'gpt-5.4',
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  apiKey: process.env.OPENAI_API_KEY,
  callbacks: [tracer],
});

// 内存版计量服务：演示 withTokenUsage 的写入路径（真实生产里换成接了 Prisma 的 TokenUsageService 即落库）
const tokenRecords: TokenUsageRecord[] = [];
const usageService = {
  recordUsage: async (r: TokenUsageRecord) => {
    tokenRecords.push(r);
  },
} as unknown as TokenUsageService;

const traceId = newTraceId();

console.log('='.repeat(80));
console.log('🔭 可观测性 Demo（traceId 贯穿 + LLM 观测 + Token 计量 + 指标）');
console.log('='.repeat(80));
console.log(`🧵 本次 traceId：${traceId}`);
console.log('▶ 开始执行（下方 JSON 行为结构化日志，均带同一 traceId）\n');

await runWithTrace(traceId, async () => {
  // 确认上下文已建立
  console.log(`   (确认 getTraceId() = ${getTraceId()})\n`);

  const graph = createAnalysisGraph(model, {
    usageService,
    conversationId: 'obs-demo',
  });

  const result = await graph.invoke({
    input: '给电商后台加一个支持百万行的订单异步导出功能，导出完成后邮件通知',
    retrievedContext: '',
    messages: [],
  });

  console.log('\n' + '─'.repeat(80));
  console.log('✅ 分析完成');
  console.log(`📝 报告长度：${(result.summary || '').length} 字符`);
});

// ---- Token 计量汇总（这些就是会写进 token_usages 表的记录） ----
console.log('\n' + '─'.repeat(80));
console.log(`💰 Token 计量记录（${tokenRecords.length} 条，opt-in 接入后逐节点落下）：`);
let totalIn = 0;
let totalOut = 0;
let totalCost = 0;
for (const r of tokenRecords) {
  totalIn += r.inputTokens;
  totalOut += r.outputTokens;
  totalCost += r.estimatedCostUsd ?? 0;
  console.log(
    `   - ${r.nodeName.padEnd(20)} agent=${(r.agentName || '').padEnd(10)} ` +
      `in=${r.inputTokens} out=${r.outputTokens} ${r.isEstimated ? '(估算)' : '(真实)'}`,
  );
}
console.log(
  `   合计：input=${totalIn} output=${totalOut} 估算成本≈$${totalCost.toFixed(6)}`,
);

// ---- 进程内指标片段（/metrics 端点暴露的就是这些） ----
console.log('\n' + '─'.repeat(80));
console.log('📈 /metrics 关键片段（进程内累加，prom-client）：');
console.log(await registry.getSingleMetricAsString('llm_calls_total'));
console.log(await registry.getSingleMetricAsString('llm_tokens_total'));
console.log('─'.repeat(80));
console.log('提示：/metrics、/ready 是应用启动后暴露的 HTTP 端点；本脚本只演示进程内机制。');
