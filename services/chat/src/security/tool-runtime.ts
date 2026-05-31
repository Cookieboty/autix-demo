/**
 * tool-runtime.ts —— 工具调用的超时与配额护栏（第十八章 18.6.1）。
 *
 * Agent 调工具是不可信的：可能卡死（外部 API 不响应）、可能被诱导无限调用
 * （烧 token / 打爆下游）。两道护栏：
 *   1. 配额：每会话工具调用次数上限（防无限调用）
 *   2. 超时：单次工具调用硬上限（防卡死拖垮进程）
 *
 * 抛**类型化错误**（A6 一致错误策略），让上层能区分「超配额」与「超时」做不同降级。
 */
export class ToolQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolQuotaError';
  }
}

export class ToolTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolTimeoutError';
  }
}

/** 每会话工具调用次数计数器（进程内，简单够用；生产可换 Redis） */
export class QuotaTracker {
  private readonly used = new Map<string, number>();
  constructor(readonly limit: number = 30) {}

  /** 消费一次配额；超限返回 false（调用方据此抛 ToolQuotaError） */
  tryConsume(key: string): boolean {
    const n = this.used.get(key) ?? 0;
    if (n >= this.limit) return false;
    this.used.set(key, n + 1);
    return true;
  }

  consumed(key: string): number {
    return this.used.get(key) ?? 0;
  }
}

export interface ToolGuardContext {
  conversationId: string;
  quota: QuotaTracker;
}

export async function withToolGuards<T>(
  toolName: string,
  ctx: ToolGuardContext,
  fn: () => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  // 1. 配额
  if (!ctx.quota.tryConsume(ctx.conversationId)) {
    throw new ToolQuotaError(`会话工具调用超配额（上限 ${ctx.quota.limit}）`);
  }
  // 2. 超时
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(`${toolName} 超时（${timeoutMs}ms）`)), timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
