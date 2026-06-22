/**
 * kill-switch.ts —— 紧急停止与恢复机制（第十八章）。
 *
 * 安全体系的最后一环不是防御，而是：检测 → 响应 → 恢复。
 * 当 Agent 已经执行了错误操作时，需要能：
 * 1. 立即停止所有 Agent 活动（Kill Switch）
 * 2. 记录操作快照，支持回滚（Action Snapshot）
 * 3. 风险自适应审批（Risk-based Approval），缓解审批疲劳
 */

// ─────────────────────── Kill Switch ───────────────────────

export type KillSwitchState = 'active' | 'killed';

/**
 * 全局紧急停止开关。
 * 任何安全模块在执行前都应该检查 kill switch 状态。
 */
export class KillSwitch {
  private state: KillSwitchState = 'active';
  private killedAt?: string;
  private reason?: string;

  isActive(): boolean {
    return this.state === 'active';
  }

  /**
   * 触发紧急停止。
   * 所有后续的 Agent 操作都应该被拒绝。
   */
  kill(reason: string): void {
    this.state = 'killed';
    this.killedAt = new Date().toISOString();
    this.reason = reason;
  }

  /**
   * 恢复（需要人工确认后才调用）。
   */
  restore(): void {
    this.state = 'active';
    this.killedAt = undefined;
    this.reason = undefined;
  }

  getStatus(): { state: KillSwitchState; killedAt?: string; reason?: string } {
    return { state: this.state, killedAt: this.killedAt, reason: this.reason };
  }

  /**
   * 断言式检查：如果已停止则抛出错误。
   */
  assertActive(): void {
    if (this.state === 'killed') {
      throw new KillSwitchEngagedError(this.reason ?? 'unknown');
    }
  }
}

export class KillSwitchEngagedError extends Error {
  constructor(public readonly reason: string) {
    super(`Agent 已被紧急停止：${reason}`);
    this.name = 'KillSwitchEngagedError';
  }
}

// ─────────────────────── Action Snapshot ───────────────────────

export interface ActionSnapshot {
  id: string;
  timestamp: string;
  agentId: string;
  action: string;
  target: string;
  params: Record<string, unknown>;
  reversible: boolean;
  compensationAction?: string;
}

/**
 * 操作快照记录器。
 * 记录 Agent 的每次操作，支持事后回滚。
 */
export class ActionLog {
  private readonly snapshots: ActionSnapshot[] = [];

  record(snapshot: Omit<ActionSnapshot, 'id' | 'timestamp'>): ActionSnapshot {
    const full: ActionSnapshot = {
      ...snapshot,
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.snapshots.push(full);
    return full;
  }

  /**
   * 获取可回滚的操作列表（按时间倒序）。
   */
  getReversible(): ActionSnapshot[] {
    return [...this.snapshots].filter((s) => s.reversible).reverse();
  }

  /**
   * 获取指定 Agent 的操作历史。
   */
  getByAgent(agentId: string): ActionSnapshot[] {
    return this.snapshots.filter((s) => s.agentId === agentId);
  }

  get size(): number {
    return this.snapshots.length;
  }

  /** 清空（仅测试用） */
  clear(): void {
    this.snapshots.length = 0;
  }
}

// ─────────────────────── Risk-based Approval ───────────────────────

export type ApprovalStrategy = 'auto_approve' | 'single_approval' | 'dual_approval' | 'deny';

export interface RiskBasedApprovalRule {
  toolPattern: string | RegExp;
  strategy: ApprovalStrategy;
}

const DEFAULT_APPROVAL_RULES: RiskBasedApprovalRule[] = [
  { toolPattern: /^(analyze|estimate|search|web_search)/, strategy: 'auto_approve' },
  { toolPattern: /^(save|create|update)/, strategy: 'single_approval' },
  { toolPattern: /^(delete|drop|remove)/, strategy: 'dual_approval' },
  { toolPattern: /^(pay|transfer|wire)/, strategy: 'deny' },
];

/**
 * 风险自适应审批策略。
 * 解决「审批疲劳」问题：不是所有操作都弹审批，按风险分级。
 */
export class RiskBasedApproval {
  private readonly rules: RiskBasedApprovalRule[];

  constructor(rules?: RiskBasedApprovalRule[]) {
    this.rules = rules ?? DEFAULT_APPROVAL_RULES;
  }

  /**
   * 根据工具名称确定审批策略。
   * 未匹配任何规则的工具默认 single_approval（Fail Closed）。
   */
  getStrategy(toolName: string): ApprovalStrategy {
    for (const rule of this.rules) {
      if (typeof rule.toolPattern === 'string') {
        if (toolName === rule.toolPattern) return rule.strategy;
      } else {
        if (rule.toolPattern.test(toolName)) return rule.strategy;
      }
    }
    return 'single_approval';
  }

  /**
   * 判断是否需要人工审批。
   */
  requiresHuman(toolName: string): boolean {
    const strategy = this.getStrategy(toolName);
    return strategy === 'single_approval' || strategy === 'dual_approval';
  }

  /**
   * 判断是否被完全禁止。
   */
  isDenied(toolName: string): boolean {
    return this.getStrategy(toolName) === 'deny';
  }
}
