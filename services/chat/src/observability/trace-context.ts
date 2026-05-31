/**
 * trace-context.ts
 *
 * 用 AsyncLocalStorage 维护「请求级 traceId」。
 * 一次请求的整个异步调用链（controller → orchestrator → graph 节点 → LLM 回调）
 * 都能通过 getTraceId() 读到同一个 traceId，无需逐层透传。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface TraceStore {
  traceId: string;
  // 起始时间，用于算整请求耗时
  startedAt: number;
}

const storage = new AsyncLocalStorage<TraceStore>();

/** 在给定 traceId 的上下文里执行 fn。HTTP 中间件用它包住整个请求处理。 */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return storage.run({ traceId, startedAt: Date.now() }, fn);
}

/** 任意位置读取当前 traceId；不在 trace 上下文里（如启动期）则返回 'no-trace'。 */
export function getTraceId(): string {
  return storage.getStore()?.traceId ?? 'no-trace';
}

/** 读取当前请求已耗时（ms）。 */
export function getElapsedMs(): number {
  const store = storage.getStore();
  return store ? Date.now() - store.startedAt : 0;
}

/** 生成一个新的 traceId（供中间件在请求入口调用）。 */
export function newTraceId(): string {
  return randomUUID();
}
