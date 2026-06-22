/**
 * agent-identity.ts —— Agent 身份与能力委托（第十八章）。
 *
 * 核心观点：Agent 不是用户本人，而是用户临时委托的执行器。
 * 它不应该继承用户的全部权限，而应该被授予临时的、有范围的、可撤销的能力。
 *
 * 本模块提供：
 * 1. AgentIdentity — 每个 Agent 的身份定义
 * 2. CapabilityToken — 临时、有范围、可过期、可撤销的能力令牌
 * 3. CapabilityManager — 能力的发放、验证、撤销
 */
import { createHash, randomUUID } from 'crypto';

// ─────────────────────── Agent Identity ───────────────────────

export interface AgentIdentity {
  id: string;
  role: string;
  owner: string;
  createdAt: string;
  metadata?: Record<string, string>;
}

/**
 * Agent 注册表：追踪所有活跃的 Agent 身份。
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentIdentity>();

  register(identity: AgentIdentity): void {
    this.agents.set(identity.id, identity);
  }

  lookup(agentId: string): AgentIdentity | undefined {
    return this.agents.get(agentId);
  }

  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  listByOwner(owner: string): AgentIdentity[] {
    return [...this.agents.values()].filter((a) => a.owner === owner);
  }

  get size(): number {
    return this.agents.size;
  }
}

// ─────────────────────── Capability Token ───────────────────────

export interface CapabilityToken {
  id: string;
  agentId: string;
  capability: string;
  scope: string;
  maxOperations: number;
  usedOperations: number;
  destructive: boolean;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export class CapabilityExpiredError extends Error {
  constructor(public readonly tokenId: string) {
    super(`Capability 已过期：${tokenId}`);
    this.name = 'CapabilityExpiredError';
  }
}

export class CapabilityRevokedError extends Error {
  constructor(public readonly tokenId: string) {
    super(`Capability 已撤销：${tokenId}`);
    this.name = 'CapabilityRevokedError';
  }
}

export class CapabilityExhaustedError extends Error {
  constructor(public readonly tokenId: string) {
    super(`Capability 已用尽：${tokenId}`);
    this.name = 'CapabilityExhaustedError';
  }
}

export class CapabilityScopeError extends Error {
  constructor(
    public readonly tokenId: string,
    public readonly requestedPath: string,
  ) {
    super(`操作超出 Capability 范围：${requestedPath}（token=${tokenId}）`);
    this.name = 'CapabilityScopeError';
  }
}

/**
 * 能力管理器：发放、验证、消费、撤销能力令牌。
 *
 * 与 RBAC 的区别：
 * - RBAC：角色 → 永久权限
 * - Capability：任务 → 临时、有范围、有配额、可撤销的能力
 */
export class CapabilityManager {
  private readonly tokens = new Map<string, CapabilityToken>();

  /**
   * 为 Agent 发放一个临时能力令牌。
   */
  issue(params: {
    agentId: string;
    capability: string;
    scope: string;
    maxOperations?: number;
    ttlMs?: number;
    destructive?: boolean;
  }): CapabilityToken {
    const now = Date.now();
    const token: CapabilityToken = {
      id: randomUUID(),
      agentId: params.agentId,
      capability: params.capability,
      scope: params.scope,
      maxOperations: params.maxOperations ?? 100,
      usedOperations: 0,
      destructive: params.destructive ?? false,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (params.ttlMs ?? 600_000)).toISOString(),
      revoked: false,
    };
    this.tokens.set(token.id, token);
    return token;
  }

  /**
   * 验证并消费一次能力。
   * 检查：是否过期、是否被撤销、是否超配额、操作是否在范围内。
   */
  consume(tokenId: string, operationPath?: string): void {
    const token = this.tokens.get(tokenId);
    if (!token) throw new CapabilityRevokedError(tokenId);
    if (token.revoked) throw new CapabilityRevokedError(tokenId);
    if (new Date(token.expiresAt).getTime() <= Date.now()) throw new CapabilityExpiredError(tokenId);
    if (token.usedOperations >= token.maxOperations) throw new CapabilityExhaustedError(tokenId);
    if (operationPath && !operationPath.startsWith(token.scope)) {
      throw new CapabilityScopeError(tokenId, operationPath);
    }
    token.usedOperations++;
  }

  /**
   * 撤销能力令牌。
   */
  revoke(tokenId: string): boolean {
    const token = this.tokens.get(tokenId);
    if (!token) return false;
    token.revoked = true;
    return true;
  }

  /**
   * 查询 Agent 的所有活跃能力。
   */
  listActive(agentId: string): CapabilityToken[] {
    const now = Date.now();
    return [...this.tokens.values()].filter(
      (t) =>
        t.agentId === agentId &&
        !t.revoked &&
        new Date(t.expiresAt).getTime() > now &&
        t.usedOperations < t.maxOperations,
    );
  }

  /**
   * 撤销 Agent 的所有能力（紧急情况）。
   */
  revokeAll(agentId: string): number {
    let count = 0;
    for (const token of this.tokens.values()) {
      if (token.agentId === agentId && !token.revoked) {
        token.revoked = true;
        count++;
      }
    }
    return count;
  }
}

// ─────────────────────── Reasoning Hash ───────────────────────

/**
 * 对 Agent 的推理过程生成不可逆的 hash。
 * 用于审计：能追溯 Agent 当时的推理过程（通过 hash 匹配），但不记录原文（保护隐私）。
 */
export function hashReasoning(reasoning: string): string {
  return createHash('sha256').update(reasoning).digest('hex').slice(0, 16);
}

/**
 * 对工具调用参数生成 hash（同理：可追溯但不泄露）。
 */
export function hashToolArgs(args: Record<string, unknown>): string {
  const sorted = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}
