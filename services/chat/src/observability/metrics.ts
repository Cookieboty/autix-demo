/**
 * metrics.ts
 *
 * Prometheus 指标注册中心。暴露 RED 指标（Rate/Errors/Duration）+ AI 特化指标。
 * prom-client 在【本进程内】累加指标并通过 /metrics 暴露；Prometheus Server / Grafana
 * 属于外部基建（见 16.9），本文件只做进程内部分。
 */
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry }); // 进程级默认指标（CPU/内存/GC/句柄）

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 请求耗时',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.3, 1, 3, 10, 30],
  registers: [registry],
});

const llmCalls = new Counter({
  name: 'llm_calls_total',
  help: 'LLM 调用次数',
  labelNames: ['ok'],
  registers: [registry],
});

const llmTokens = new Counter({
  name: 'llm_tokens_total',
  help: 'LLM token 总量',
  labelNames: ['direction'], // direction=input|output
  registers: [registry],
});

const llmLatency = new Histogram({
  name: 'llm_call_duration_seconds',
  help: '单次 LLM 调用耗时',
  buckets: [0.3, 1, 3, 10, 30, 60],
  registers: [registry],
});

export const sseConnections = new Gauge({
  name: 'sse_active_connections',
  help: '当前活跃 SSE 连接数',
  registers: [registry],
});

/** 供 LlmTracer 在每次 LLM 调用结束时调用。 */
export function recordLlmCall(p: {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
}): void {
  llmCalls.inc({ ok: String(p.ok) });
  llmTokens.inc({ direction: 'input' }, p.inputTokens);
  llmTokens.inc({ direction: 'output' }, p.outputTokens);
  llmLatency.observe(p.latencyMs / 1000);
}
