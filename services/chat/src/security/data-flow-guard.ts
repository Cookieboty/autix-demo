/**
 * data-flow-guard.ts —— 数据流守卫（第十八章 18.6）。
 *
 * 传统权限控制管「谁能做什么」，但管不了「数据从哪里来、流向哪里」。
 * 提示注入攻击的核心手法就是：诱导 Agent 先从敏感源读取数据，再发送到外部。
 * 单看「读文件」和「发请求」都是合法操作，但组合起来就是数据外泄。
 *
 * 本模块提供：
 *   1. DataClassifier  — 对数据内容做敏感度分类（PII、密钥、普通）
 *   2. FlowRule        — 定义数据流规则（哪些数据不能流向哪些目标）
 *   3. DataFlowGuard   — 数据流检查引擎：记录读操作，在写/发操作前检查数据流合规
 *
 * 关键观点：Agent 可以阅读不可信内容，但不能服从不可信内容。
 *          Agent 可以读取敏感数据，但不能将敏感数据发到不可信目标。
 */

export type DataSensitivity = 'public' | 'internal' | 'confidential' | 'secret';

export type DataSource = 'user_input' | 'file' | 'database' | 'email' | 'web' | 'api';
export type DataTarget = 'user_output' | 'file' | 'database' | 'email' | 'web' | 'api' | 'log';

export interface ClassificationResult {
  sensitivity: DataSensitivity;
  matchedPatterns: string[];
}

// ─────────────────────── DataClassifier ───────────────────────

const CLASSIFICATION_RULES: {
  id: string;
  sensitivity: DataSensitivity;
  pattern: RegExp;
}[] = [
  // secret 级
  { id: 'api_key', sensitivity: 'secret', pattern: /(?:sk|pk|api[_-]?key)[_-][\w]{16,}/i },
  { id: 'private_key', sensitivity: 'secret', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i },
  { id: 'aws_secret', sensitivity: 'secret', pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/i },
  { id: 'password_field', sensitivity: 'secret', pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/i },
  // confidential 级
  { id: 'email_address', sensitivity: 'confidential', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { id: 'phone_cn', sensitivity: 'confidential', pattern: /1[3-9]\d{9}/g },
  { id: 'id_card_cn', sensitivity: 'confidential', pattern: /\d{17}[\dXx]/g },
  { id: 'credit_card', sensitivity: 'confidential', pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g },
  // internal 级
  { id: 'internal_url', sensitivity: 'internal', pattern: /https?:\/\/(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)\S+/g },
  { id: 'db_connection', sensitivity: 'internal', pattern: /(?:postgres|mysql|mongodb):\/\/\S+/gi },
];

/**
 * 数据内容敏感度分类器。
 * 扫描文本内容，返回最高敏感度等级和命中的模式。
 */
export class DataClassifier {
  classify(content: string): ClassificationResult {
    const matched: string[] = [];
    let highest: DataSensitivity = 'public';

    const severityOrder: DataSensitivity[] = ['public', 'internal', 'confidential', 'secret'];

    for (const rule of CLASSIFICATION_RULES) {
      if (rule.pattern.test(content)) {
        matched.push(rule.id);
        const ruleIdx = severityOrder.indexOf(rule.sensitivity);
        const currentIdx = severityOrder.indexOf(highest);
        if (ruleIdx > currentIdx) highest = rule.sensitivity;
      }
      // Reset lastIndex for global regexes
      rule.pattern.lastIndex = 0;
    }

    return { sensitivity: highest, matchedPatterns: matched };
  }
}

// ─────────────────────── FlowRule ───────────────────────

export interface FlowRule {
  /** 当数据敏感度 >= minSensitivity 时，禁止流向指定目标 */
  minSensitivity: DataSensitivity;
  /** 禁止的目标列表 */
  blockedTargets: DataTarget[];
}

const DEFAULT_FLOW_RULES: FlowRule[] = [
  // secret 级数据：不能流向任何外部目标和日志
  { minSensitivity: 'secret', blockedTargets: ['web', 'email', 'log', 'user_output'] },
  // confidential 级数据：不能流向外部网络和日志
  { minSensitivity: 'confidential', blockedTargets: ['web', 'log'] },
  // internal 级数据：不能流向外部网络
  { minSensitivity: 'internal', blockedTargets: ['web'] },
];

// ─────────────────────── DataFlowGuard ───────────────────────

export class DataFlowViolation extends Error {
  constructor(
    public readonly sensitivity: DataSensitivity,
    public readonly target: DataTarget,
    public readonly matchedPatterns: string[],
  ) {
    super(
      `数据流违规：${sensitivity} 级数据不允许流向 ${target}（命中：${matchedPatterns.join(', ')}）`,
    );
    this.name = 'DataFlowViolation';
  }
}

/**
 * 数据流检查引擎。
 *
 * 用法：
 *   const guard = new DataFlowGuard();
 *   guard.checkBeforeSend(content, 'web');  // 包含 API Key → 抛 DataFlowViolation
 *   guard.checkBeforeSend(content, 'file'); // 包含 API Key → 通过（secret 可写本地文件）
 */
export class DataFlowGuard {
  private readonly classifier: DataClassifier;
  private readonly rules: FlowRule[];
  private readonly severityOrder: DataSensitivity[] = [
    'public',
    'internal',
    'confidential',
    'secret',
  ];

  constructor(rules?: FlowRule[]) {
    this.classifier = new DataClassifier();
    this.rules = rules ?? DEFAULT_FLOW_RULES;
  }

  /**
   * 在数据发送/写入前检查合规性。
   * @param content 要发送的数据内容
   * @param target  目标类型
   * @returns 分类结果（如果检查通过）
   * @throws DataFlowViolation 如果数据流违规
   */
  checkBeforeSend(content: string, target: DataTarget): ClassificationResult {
    const classification = this.classifier.classify(content);

    for (const rule of this.rules) {
      if (!rule.blockedTargets.includes(target)) continue;
      const ruleIdx = this.severityOrder.indexOf(rule.minSensitivity);
      const dataIdx = this.severityOrder.indexOf(classification.sensitivity);
      if (dataIdx >= ruleIdx) {
        throw new DataFlowViolation(
          classification.sensitivity,
          target,
          classification.matchedPatterns,
        );
      }
    }

    return classification;
  }

  /**
   * 静默检查：返回是否允许，不抛异常。
   */
  isAllowed(content: string, target: DataTarget): boolean {
    try {
      this.checkBeforeSend(content, target);
      return true;
    } catch {
      return false;
    }
  }
}

// ─────────────────────── Data Lineage ───────────────────────

export interface LineageStep {
  agentId: string;
  action: 'read' | 'transform' | 'summarize' | 'forward';
  timestamp: string;
}

export interface DataLineageRecord {
  id: string;
  source: DataSource;
  sourceSensitivity: DataSensitivity;
  content_hash: string;
  steps: LineageStep[];
}

/**
 * 数据血缘追踪器。
 * 跟踪数据从 source 到 sink 的完整路径，即使数据被摘要、改写。
 *
 * 关键洞察：内容分类（Content Classification）只看当前文本是否含敏感信息。
 * 血缘分类（Lineage Classification）看数据来自哪里——即使内容被摘要到不含敏感关键词，
 * 如果来源是「财务报表」，整条链路仍然是 confidential。
 */
export class DataLineageTracker {
  private readonly records = new Map<string, DataLineageRecord>();
  private readonly classifier = new DataClassifier();
  private idCounter = 0;

  /**
   * 记录一次数据读取操作，开启血缘链。
   * @returns lineage ID，后续操作用它追踪
   */
  recordRead(source: DataSource, content: string, agentId: string): string {
    const id = `lineage-${++this.idCounter}`;
    const classification = this.classifier.classify(content);
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    this.records.set(id, {
      id,
      source,
      sourceSensitivity: classification.sensitivity,
      content_hash: hash,
      steps: [{ agentId, action: 'read', timestamp: new Date().toISOString() }],
    });
    return id;
  }

  /**
   * 记录数据的转换/传递操作。
   */
  recordStep(lineageId: string, agentId: string, action: LineageStep['action']): void {
    const record = this.records.get(lineageId);
    if (!record) return;
    record.steps.push({ agentId, action, timestamp: new Date().toISOString() });
  }

  /**
   * 基于血缘检查数据是否可以流向目标。
   * 即使内容被摘要到不含敏感关键词，来源敏感度仍然适用。
   */
  checkLineage(lineageId: string, target: DataTarget): { allowed: boolean; reason?: string } {
    const record = this.records.get(lineageId);
    if (!record) return { allowed: true };

    const guard = new DataFlowGuard();
    const severityOrder: DataSensitivity[] = ['public', 'internal', 'confidential', 'secret'];
    const sourceIdx = severityOrder.indexOf(record.sourceSensitivity);

    const fakeContent = sourceIdx >= 3 ? 'sk-fake_key_for_lineage_check' :
                       sourceIdx >= 2 ? 'fake@email.com' :
                       sourceIdx >= 1 ? 'http://192.168.1.1/internal' : 'public content';

    const allowed = guard.isAllowed(fakeContent, target);
    if (!allowed) {
      return {
        allowed: false,
        reason: `来源 ${record.source} 敏感度 ${record.sourceSensitivity}，不允许流向 ${target}`,
      };
    }
    return { allowed: true };
  }

  /**
   * 获取完整的血缘记录。
   */
  getLineage(lineageId: string): DataLineageRecord | undefined {
    return this.records.get(lineageId);
  }
}
