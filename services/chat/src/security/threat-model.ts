/**
 * threat-model.ts —— Agent 威胁建模框架（第十八章）。
 *
 * 传统安全第一步是威胁建模：资产 → 攻击者 → 攻击路径 → 缓解措施。
 * Agent 系统也一样，但攻击面更大（四类边界混淆）。
 *
 * 本模块提供：
 * 1. TrustBoundary — 定义系统中的信任边界（跨越边界的数据不可信）
 * 2. SecurityInvariant — 安全不变量（无论 Agent 怎么运行都必须成立的规则）
 * 3. FailClosed — 失败时默认拒绝的包装器
 * 4. ThreatScenario — 结构化威胁场景描述
 */

// ─────────────────────── Trust Boundary ───────────────────────

export type TrustLevel = 'system' | 'developer' | 'user' | 'agent' | 'tool_output' | 'external';

const TRUST_ORDER: TrustLevel[] = ['external', 'tool_output', 'agent', 'user', 'developer', 'system'];

export interface TrustBoundary {
  id: string;
  from: TrustLevel;
  to: TrustLevel;
  description: string;
}

/**
 * 判断数据是否跨越了信任边界（从低信任流向高信任区域）。
 * 跨越边界的数据必须经过验证才能被信任。
 */
export function crossesTrustBoundary(sourceLevel: TrustLevel, targetLevel: TrustLevel): boolean {
  const srcIdx = TRUST_ORDER.indexOf(sourceLevel);
  const tgtIdx = TRUST_ORDER.indexOf(targetLevel);
  return srcIdx < tgtIdx;
}

/**
 * 获取信任级别的数值（越高越可信）。
 */
export function trustScore(level: TrustLevel): number {
  return TRUST_ORDER.indexOf(level);
}

/**
 * 判断某个信任级别的内容是否有资格改变 Agent 行为。
 * system/developer 可以，user 只能提出任务，tool_output/external 不能。
 */
export function canAlterAgentBehavior(level: TrustLevel): boolean {
  return level === 'system' || level === 'developer';
}

/**
 * 判断某个信任级别的内容是否可以提出新任务。
 */
export function canIssueTask(level: TrustLevel): boolean {
  return level === 'system' || level === 'developer' || level === 'user';
}

// ─────────────────────── Security Invariant ───────────────────────

export interface SecurityInvariant {
  id: string;
  description: string;
  check: (context: InvariantContext) => boolean;
}

export interface InvariantContext {
  action: string;
  actor: string;
  resource?: string;
  target?: string;
  dataContent?: string;
  [key: string]: unknown;
}

export class InvariantViolation extends Error {
  constructor(
    public readonly invariantId: string,
    public readonly context: InvariantContext,
  ) {
    super(`安全不变量违反：${invariantId}（action=${context.action}, actor=${context.actor}）`);
    this.name = 'InvariantViolation';
  }
}

/**
 * 预定义的 Agent 安全不变量。
 * 这些规则无论 prompt、tool、workflow 怎么变，都必须成立。
 */
export const AGENT_INVARIANTS: SecurityInvariant[] = [
  {
    id: 'no-agent-admin-creation',
    description: 'Agent 不允许创建管理员账户',
    check: (ctx) => !(ctx.action === 'create_admin' && ctx.actor.startsWith('agent')),
  },
  {
    id: 'no-pii-to-external',
    description: 'PII 不允许发送到外部网络',
    check: (ctx) => !(ctx.action === 'send_external' && ctx.dataContent?.includes('@')),
  },
  {
    id: 'no-production-delete-by-agent',
    description: '生产数据库不能被 Agent 删除',
    check: (ctx) => !(ctx.action === 'delete' && ctx.resource === 'production_database' && ctx.actor.startsWith('agent')),
  },
  {
    id: 'no-secret-in-response',
    description: 'API Key / Secret 不允许出现在 Agent 的对外响应中',
    check: (ctx) => {
      if (ctx.action !== 'respond' || !ctx.dataContent) return true;
      return !/(?:sk|pk|api[_-]?key)[_-][\w]{16,}/i.test(ctx.dataContent);
    },
  },
];

/**
 * 安全不变量检查引擎。
 * 在每个关键操作前调用，确保不变量未被违反。
 */
export class InvariantChecker {
  private readonly invariants: SecurityInvariant[];

  constructor(invariants: SecurityInvariant[] = AGENT_INVARIANTS) {
    this.invariants = invariants;
  }

  /**
   * 检查所有不变量，返回违反的不变量列表。
   */
  check(context: InvariantContext): { passed: boolean; violations: string[] } {
    const violations: string[] = [];
    for (const inv of this.invariants) {
      if (!inv.check(context)) {
        violations.push(inv.id);
      }
    }
    return { passed: violations.length === 0, violations };
  }

  /**
   * 断言式检查：违反任何不变量则抛出错误。
   */
  assert(context: InvariantContext): void {
    const result = this.check(context);
    if (!result.passed) {
      throw new InvariantViolation(result.violations[0], context);
    }
  }

  /** 列出所有注册的不变量 */
  list(): { id: string; description: string }[] {
    return this.invariants.map((i) => ({ id: i.id, description: i.description }));
  }
}

// ─────────────────────── Fail Closed ───────────────────────

/**
 * Fail Closed 包装器：当检查函数抛出异常时，默认拒绝（而不是放行）。
 * 这是安全系统的底层原则：不确定就拒绝。
 */
export async function failClosed<T>(
  checkFn: () => Promise<T> | T,
  fallback: 'deny' | 'allow' = 'deny',
): Promise<{ ok: boolean; result?: T; error?: Error }> {
  try {
    const result = await checkFn();
    return { ok: true, result };
  } catch (e) {
    if (fallback === 'deny') {
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
    return { ok: true };
  }
}

/**
 * 同步版 Fail Closed。
 */
export function failClosedSync<T>(
  checkFn: () => T,
): { ok: boolean; result?: T; error?: Error } {
  try {
    const result = checkFn();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ─────────────────────── Threat Scenario ───────────────────────

export type ThreatCategory = 'injection' | 'privilege_escalation' | 'data_leak' | 'denial_of_service' | 'denial_of_wallet' | 'context_poisoning' | 'supply_chain';

export interface ThreatScenario {
  id: string;
  category: ThreatCategory;
  asset: string;
  attacker: string;
  attackPath: string;
  mitigation: string;
}

/**
 * Agent 系统的默认威胁场景库。
 */
export const AGENT_THREAT_SCENARIOS: ThreatScenario[] = [
  {
    id: 'direct-injection',
    category: 'injection',
    asset: '系统指令完整性',
    attacker: '恶意用户',
    attackPath: '在用户输入中嵌入覆盖指令',
    mitigation: 'input-guard 检出 + 指令来源分级',
  },
  {
    id: 'indirect-injection',
    category: 'injection',
    asset: '系统指令完整性',
    attacker: '第三方内容（网页/邮件/PDF）',
    attackPath: '在外部内容中隐藏恶意指令，Agent 读取后执行',
    mitigation: 'Trust Boundary 标记 + 不可信内容不能改变 Agent 行为',
  },
  {
    id: 'agent-privilege-escalation',
    category: 'privilege_escalation',
    asset: '数据库、文件系统',
    attacker: '被注入的 Research Agent',
    attackPath: 'Research Agent 被注入 → 传递恶意指令给 Executor Agent → 执行越权操作',
    mitigation: 'Agent 间权限隔离 + 信息过滤 + 最小权限',
  },
  {
    id: 'data-exfiltration',
    category: 'data_leak',
    asset: '用户 PII / API Key',
    attacker: '恶意网页内容',
    attackPath: '诱导 Agent 读取敏感文件 → 通过合法工具调用发到外部',
    mitigation: 'DataFlowGuard source→sink 检查',
  },
  {
    id: 'denial-of-wallet',
    category: 'denial_of_wallet',
    asset: '运营预算',
    attacker: '恶意用户或被注入的 Agent',
    attackPath: '疯狂调用 LLM API / 搜索 API，一天烧掉大量费用',
    mitigation: 'QuotaTracker 配额限制 + 成本监控告警',
  },
  {
    id: 'context-poisoning',
    category: 'context_poisoning',
    asset: 'Agent 长期记忆 / RAG 知识库',
    attacker: '恶意内容写入者',
    attackPath: '向 Agent 的记忆/知识库注入虚假信息 → 后续检索时污染 context → 影响决策',
    mitigation: '记忆写入审核 + 来源标记 + 定期清洗',
  },
  {
    id: 'supply-chain-attack',
    category: 'supply_chain',
    asset: 'Agent 工具链完整性',
    attacker: '恶意 MCP Server / Plugin',
    attackPath: '替换合法的 MCP Server 为恶意版本 → Agent 调用时泄露数据',
    mitigation: '工具白名单 + 来源校验 + 签名验证',
  },
];
