/**
 * logger.ts
 *
 * 基于 pino 的结构化日志单例。
 * - 默认输出 JSON（每行一条，可直接被 Loki/ELK/Datadog 摄取，且在 bun 下稳定）
 * - 设 LOG_PRETTY=1 时用 pino-pretty 彩色美化（本地开发可读）
 * 每条日志自动带上当前请求的 traceId（来自 trace-context）。
 */
import pino from 'pino';
import { getTraceId } from './trace-context';

const isDev = process.env.NODE_ENV !== 'production';
const usePretty = process.env.LOG_PRETTY === '1';

/** pino mixin：每次打日志时从 ALS 读当前 traceId 注入。导出以便单测验证机制。 */
export function traceMixin(): { traceId: string } {
  return { traceId: getTraceId() };
}

const base = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: usePretty
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
    : undefined,
  // 统一把 traceId 注入每条日志（mixin 在每次打日志时调用）
  mixin: traceMixin,
  // 敏感字段脱敏（呼应第十八章 18.7.2：日志里不留密钥）
  redact: {
    paths: ['apiKey', '*.apiKey', 'headers.authorization', 'password', '*.password'],
    censor: '***',
  },
});

/** 给某个模块创建带固定字段的子 logger，例如 log = createLogger('orchestrator')。 */
export function createLogger(module: string) {
  return base.child({ module });
}

export const log = base;
