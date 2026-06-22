/**
 * permission-model.ts —— 多 Agent 权限模型（第十八章 18.5）。
 *
 * 在多 Agent 系统（第九/十五章的 Planner-Executor、专家子图协作）里，
 * 每个 Agent 不应该拥有相同的权限。规划 Agent 不需要执行权限，
 * 执行 Agent 不需要看到完整用户隐私。
 *
 * 本模块提供：
 *   1. AgentRole — 预定义的 Agent 角色
 *   2. Permission — 细粒度权限定义（资源 + 操作）
 *   3. PermissionPolicy — 策略引擎：检查某角色是否有某权限
 *   4. PermissionDeniedError — 类型化越权错误
 *
 * 设计原则：
 *   - 默认 deny：未显式授权的 = 拒绝
 *   - 白名单模式：只有注册过的权限才可能被授予
 *   - 纯函数 + 可配置，零外部依赖
 */

export type AgentRole =
  | 'planner'
  | 'researcher'
  | 'coder'
  | 'executor'
  | 'reviewer'
  | 'admin';

export type ResourceType =
  | 'file'
  | 'database'
  | 'email'
  | 'calendar'
  | 'api'
  | 'code_execution'
  | 'network'
  | 'secret'
  | 'tool';

export type ActionType = 'read' | 'write' | 'delete' | 'execute' | 'send';

export interface Permission {
  resource: ResourceType;
  action: ActionType;
}

export class PermissionDeniedError extends Error {
  constructor(
    public readonly role: AgentRole,
    public readonly permission: Permission,
  ) {
    super(
      `权限拒绝：角色 ${role} 不具备 ${permission.resource}:${permission.action} 权限`,
    );
    this.name = 'PermissionDeniedError';
  }
}

/** 角色 → 允许的权限集合 */
type PolicyMap = Record<AgentRole, Permission[]>;

/**
 * 默认权限策略。
 * 每个角色只拥有完成其职责所需的最小权限集。
 */
const DEFAULT_POLICY: PolicyMap = {
  planner: [
    { resource: 'tool', action: 'read' },
  ],
  researcher: [
    { resource: 'network', action: 'read' },
    { resource: 'file', action: 'read' },
    { resource: 'database', action: 'read' },
  ],
  coder: [
    { resource: 'code_execution', action: 'execute' },
    { resource: 'file', action: 'read' },
    { resource: 'file', action: 'write' },
  ],
  executor: [
    { resource: 'tool', action: 'execute' },
    { resource: 'file', action: 'read' },
    { resource: 'api', action: 'read' },
  ],
  reviewer: [
    { resource: 'file', action: 'read' },
    { resource: 'database', action: 'read' },
  ],
  admin: [
    { resource: 'file', action: 'read' },
    { resource: 'file', action: 'write' },
    { resource: 'file', action: 'delete' },
    { resource: 'database', action: 'read' },
    { resource: 'database', action: 'write' },
    { resource: 'database', action: 'delete' },
    { resource: 'email', action: 'read' },
    { resource: 'email', action: 'send' },
    { resource: 'api', action: 'read' },
    { resource: 'api', action: 'execute' },
    { resource: 'code_execution', action: 'execute' },
    { resource: 'network', action: 'read' },
    { resource: 'tool', action: 'read' },
    { resource: 'tool', action: 'execute' },
    { resource: 'secret', action: 'read' },
  ],
};

/**
 * 权限策略引擎。
 *
 * 用法：
 *   const policy = new PermissionPolicy();
 *   policy.check('researcher', { resource: 'network', action: 'read' }); // true
 *   policy.check('researcher', { resource: 'email', action: 'send' }); // false
 *   policy.assert('planner', { resource: 'code_execution', action: 'execute' }); // throws
 */
export class PermissionPolicy {
  private readonly grants: Map<string, Set<string>>;

  constructor(policy: PolicyMap = DEFAULT_POLICY) {
    this.grants = new Map();
    for (const [role, perms] of Object.entries(policy)) {
      const keys = new Set(perms.map((p) => `${p.resource}:${p.action}`));
      this.grants.set(role, keys);
    }
  }

  /** 静默检查：有权限返回 true，无权限返回 false */
  check(role: AgentRole, perm: Permission): boolean {
    const rolePerms = this.grants.get(role);
    if (!rolePerms) return false;
    return rolePerms.has(`${perm.resource}:${perm.action}`);
  }

  /** 断言式检查：无权限抛 PermissionDeniedError */
  assert(role: AgentRole, perm: Permission): void {
    if (!this.check(role, perm)) {
      throw new PermissionDeniedError(role, perm);
    }
  }

  /** 批量检查：返回通过和拒绝的权限清单 */
  checkAll(
    role: AgentRole,
    perms: Permission[],
  ): { granted: Permission[]; denied: Permission[] } {
    const granted: Permission[] = [];
    const denied: Permission[] = [];
    for (const p of perms) {
      if (this.check(role, p)) granted.push(p);
      else denied.push(p);
    }
    return { granted, denied };
  }

  /** 列出某角色的所有权限 */
  listPermissions(role: AgentRole): Permission[] {
    const rolePerms = this.grants.get(role);
    if (!rolePerms) return [];
    return [...rolePerms].map((key) => {
      const [resource, action] = key.split(':') as [ResourceType, ActionType];
      return { resource, action };
    });
  }

  /** 列出所有已注册的角色 */
  listRoles(): AgentRole[] {
    return [...this.grants.keys()] as AgentRole[];
  }
}
