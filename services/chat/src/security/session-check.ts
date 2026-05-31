/**
 * session-check.ts —— 会话吊销校验机制（第十八章 18.2.2）。
 *
 * 现实约束：chat 与 user-system 是**独立数据库**（chat=autix_chat_demo，
 * user-system=user_system），chat 没有直接访问 UserSession 的能力。
 * 所以这里把「会话来源」做成**可插拔接口** SessionStore：
 *   - chat 默认用 noopSessionStore（不校验、放行），不硬依赖跨库
 *   - 生产可注入 DB 实现（连 user_system 库查 UserSession.isActive/expiresAt）
 *     或 HTTP 实现（调 user-system 接口校验）
 *
 * 这样「会话吊销」的判定逻辑（机制）是完整、可测的，而「数据从哪来」
 * 是部署时的注入决策，互不耦合。
 */
import { UnauthorizedException } from '@nestjs/common';

/**
 * 会话裁决：
 *   - alive：会话有效
 *   - revoked：会话已吊销/过期 → 拒绝
 *   - skip：本环境不做校验（如 noop），放行
 */
export type SessionVerdict = 'alive' | 'revoked' | 'skip';

export interface SessionStore {
  check(sessionId: string): Promise<SessionVerdict>;
}

/** 默认实现：不校验（chat 不硬依赖跨库；生产显式注入真实实现） */
export const noopSessionStore: SessionStore = {
  async check() {
    return 'skip';
  },
};

/**
 * 真实 UserSession 状态 → 裁决的纯映射（共享 schema 是 isActive/expiresAt，无 revokedAt）。
 * DB/HTTP 实现拿到会话记录后调它，保证判定口径一致、可单测。
 */
export function verdictFromSession(
  session: { isActive: boolean; expiresAt: Date } | null,
  now: Date = new Date(),
): SessionVerdict {
  if (!session) return 'revoked'; // 查不到 = 已吊销
  if (!session.isActive || session.expiresAt.getTime() <= now.getTime()) return 'revoked';
  return 'alive';
}

export async function assertSessionAlive(
  store: SessionStore,
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) return; // 旧 token 无 sessionId 时放行（向后兼容，可按需收紧）
  const verdict = await store.check(sessionId);
  if (verdict === 'revoked') {
    throw new UnauthorizedException('会话已失效，请重新登录');
  }
}
