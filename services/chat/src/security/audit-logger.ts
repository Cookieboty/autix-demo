/**
 * audit-logger.ts —— 安全审计日志（第十八章 18.8）。
 *
 * 与第十六章的 observability/logger.ts 不同：
 *   - logger.ts 是通用结构化日志（pino），面向开发调试和运维
 *   - audit-logger 是安全审计日志，面向安全事件追踪和合规审计
 *
 * 设计要求：
 *   1. 事件必须结构化（typed AuditEvent，不是 any）
 *   2. 敏感字段自动脱敏（不记原文、不记密钥）
 *   3. 事件不可篡改（追加写入，不允许修改已记录的事件）
 *   4. 可查询（支持按时间、类型、角色、严重程度过滤）
 *
 * 本模块是进程内实现（事件存在内存数组里），生产可替换为：
 *   - 追加写入文件（JSONL 格式，防篡改靠文件系统权限）
 *   - 写入数据库审计表
 *   - 发到外部 SIEM 系统
 */

export type AuditSeverity = 'info' | 'warn' | 'critical';

export type AuditEventType =
  | 'tool_invoked'
  | 'tool_blocked'
  | 'permission_denied'
  | 'permission_granted'
  | 'injection_detected'
  | 'session_revoked'
  | 'human_approved'
  | 'human_rejected'
  | 'sandbox_execution'
  | 'data_access'
  | 'secret_accessed'
  | 'path_escape_blocked';

export interface AuditEvent {
  timestamp: string;
  eventType: AuditEventType;
  severity: AuditSeverity;
  /** 操作发起者（Agent 角色或用户 ID，不记用户名） */
  actor: string;
  /** 操作目标（工具名、文件路径、资源 ID，敏感路径需脱敏） */
  target: string;
  /** 结果：成功 / 拒绝 / 错误 */
  outcome: 'success' | 'denied' | 'error';
  /** 结构化详情（类型化字段，不含原文） */
  details: Record<string, string | number | boolean>;
  /** 关联的 traceId（可选，呼应第十六章） */
  traceId?: string;
}

export interface AuditQuery {
  eventType?: AuditEventType;
  severity?: AuditSeverity;
  actor?: string;
  outcome?: AuditEvent['outcome'];
  since?: Date;
  until?: Date;
  limit?: number;
}

/**
 * 安全审计日志记录器。
 *
 * 用法：
 *   const audit = new AuditLogger();
 *   audit.log({ eventType: 'tool_invoked', ... });
 *   audit.query({ eventType: 'injection_detected', severity: 'critical' });
 */
export class AuditLogger {
  private readonly events: AuditEvent[] = [];
  private readonly onEvent?: (event: AuditEvent) => void;

  /**
   * @param onEvent 可选的事件回调（用于转发到外部系统）
   */
  constructor(onEvent?: (event: AuditEvent) => void) {
    this.onEvent = onEvent;
  }

  log(
    event: Omit<AuditEvent, 'timestamp'> & { timestamp?: string },
  ): AuditEvent {
    const full: AuditEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    this.events.push(full);
    this.onEvent?.(full);
    return full;
  }

  /** 记录工具调用事件 */
  logToolInvocation(
    toolName: string,
    actor: string,
    outcome: AuditEvent['outcome'],
    details: Record<string, string | number | boolean> = {},
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: outcome === 'denied' ? 'tool_blocked' : 'tool_invoked',
      severity: outcome === 'denied' ? 'warn' : 'info',
      actor,
      target: toolName,
      outcome,
      details,
      traceId,
    });
  }

  /** 记录注入检出事件 */
  logInjectionDetected(
    matchedPatterns: string[],
    inputLength: number,
    actor: string,
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: 'injection_detected',
      severity: 'critical',
      actor,
      target: 'user_input',
      outcome: 'denied',
      details: {
        matchedPatterns: matchedPatterns.join(','),
        inputLength,
      },
      traceId,
    });
  }

  /** 记录人工审批事件 */
  logHumanDecision(
    toolName: string,
    approver: string,
    approved: boolean,
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: approved ? 'human_approved' : 'human_rejected',
      severity: 'info',
      actor: approver,
      target: toolName,
      outcome: approved ? 'success' : 'denied',
      details: { decision: approved ? 'approve' : 'reject' },
      traceId,
    });
  }

  /** 记录沙箱执行事件 */
  logSandboxExecution(
    command: string,
    exitCode: number,
    durationMs: number,
    actor: string,
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: 'sandbox_execution',
      severity: exitCode === 0 ? 'info' : 'warn',
      actor,
      target: command,
      outcome: exitCode === 0 ? 'success' : 'error',
      details: { exitCode, durationMs },
      traceId,
    });
  }

  /** 查询审计事件 */
  query(q: AuditQuery = {}): AuditEvent[] {
    let results = [...this.events];

    if (q.eventType) results = results.filter((e) => e.eventType === q.eventType);
    if (q.severity) results = results.filter((e) => e.severity === q.severity);
    if (q.actor) results = results.filter((e) => e.actor === q.actor);
    if (q.outcome) results = results.filter((e) => e.outcome === q.outcome);
    if (q.since) {
      const since = q.since.toISOString();
      results = results.filter((e) => e.timestamp >= since);
    }
    if (q.until) {
      const until = q.until.toISOString();
      results = results.filter((e) => e.timestamp <= until);
    }

    // 默认按时间倒序
    results.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));

    if (q.limit) results = results.slice(0, q.limit);

    return results;
  }

  /** 统计：按事件类型计数 */
  countByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this.events) {
      counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;
    }
    return counts;
  }

  /** 获取所有事件数量 */
  get size(): number {
    return this.events.length;
  }

  /** 清空（仅测试用，生产审计日志不应可清空） */
  clear(): void {
    this.events.length = 0;
  }
}
