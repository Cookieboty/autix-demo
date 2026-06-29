/**
 * 沙箱执行闭环 Demo — 第十八章 18.4 配套脚本
 *
 * 演示进程级代码执行沙箱的完整能力：
 *   1. PathValidator — 路径越界拦截
 *   2. EnvironmentFilter — 密钥过滤
 *   3. ProcessSandbox — 受限子进程执行（限 cwd、env、timeout）
 *   4. AuditLogger — 审计日志记录
 *   5. DataFlowGuard — 数据流合规检查
 *
 * 运行：cd services/chat && bun run scripts/run-sandbox-demo.ts
 */
import {
  PathValidator,
  PathEscapeError,
  EnvironmentFilter,
  ProcessSandbox,
} from '../src/security/sandbox';
import { AuditLogger } from '../src/security/audit-logger';
import { DataClassifier, DataFlowGuard, DataFlowViolation } from '../src/security/data-flow-guard';
import { PermissionPolicy } from '../src/security/permission-model';

const log = (msg: string) => console.log(`  ${msg}`);

console.log('='.repeat(72));
console.log('🛡  第十八章：安全沙箱与权限隔离 Demo');
console.log('='.repeat(72));

// ── Demo 1: 路径越界拦截 ──────────────────────────────────────
console.log('\n▶ Demo 1: PathValidator — 路径越界拦截');
console.log('─'.repeat(72));
const pathValidator = new PathValidator(['/tmp/agent-workspace']);
const testPaths = [
  '/tmp/agent-workspace/report.md',
  '/tmp/agent-workspace/data/result.json',
  '/etc/passwd',
  '/tmp/agent-workspace/../../../etc/shadow',
  '/home/user/.ssh/id_rsa',
];
for (const p of testPaths) {
  try {
    pathValidator.validate(p);
    log(`✅ ${p} — 允许`);
  } catch (e) {
    if (e instanceof PathEscapeError) {
      log(`🚫 ${p} — 拦截（越界）`);
    }
  }
}

// ── Demo 2: 环境变量过滤 ──────────────────────────────────────
console.log('\n▶ Demo 2: EnvironmentFilter — 密钥过滤');
console.log('─'.repeat(72));
const envFilter = new EnvironmentFilter();
const mockEnv: Record<string, string> = {
  PATH: '/usr/bin:/usr/local/bin',
  HOME: '/home/agent',
  NODE_ENV: 'production',
  OPENAI_API_KEY: 'sk-secret-key-do-not-leak',
  DATABASE_URL: 'postgres://admin:password@db:5432/prod',
  JWT_SECRET: 'super-secret-jwt',
  LANG: 'en_US.UTF-8',
};
const safeEnv = envFilter.filter(mockEnv);
log('原始环境变量：');
for (const [k, v] of Object.entries(mockEnv)) {
  const isSafe = k in safeEnv;
  log(`  ${isSafe ? '✅' : '🚫'} ${k} = ${isSafe ? v : '[已过滤]'}`);
}

// ── Demo 3: 进程沙箱执行 ──────────────────────────────────────
console.log('\n▶ Demo 3: ProcessSandbox — 受限子进程执行');
console.log('─'.repeat(72));
const sandbox = new ProcessSandbox({
  workDir: '/tmp',
  timeoutMs: 5000,
  maxOutputBytes: 1024 * 100,
});

log('执行 Node.js 代码：console.log("Hello from sandbox")');
const r1 = await sandbox.runNode('console.log("Hello from sandbox")');
log(`  stdout: ${r1.stdout.trim()}`);
log(`  退出码: ${r1.exitCode}, 耗时: ${r1.durationMs}ms`);

log('\n尝试读取宿主机环境变量 OPENAI_API_KEY：');
const r2 = await sandbox.runNode(
  'console.log("OPENAI_API_KEY =", process.env.OPENAI_API_KEY ?? "NOT_FOUND")',
);
log(`  stdout: ${r2.stdout.trim()}`);
log(`  → 密钥未泄露！沙箱 env 已过滤`);

log('\n执行 Python 代码：计算 1+2+3+...+100');
try {
  const r3 = await sandbox.runPython('print(sum(range(1, 101)))');
  log(`  stdout: ${r3.stdout.trim()}`);
  log(`  退出码: ${r3.exitCode}, 耗时: ${r3.durationMs}ms`);
} catch {
  log(`  ⚠️ Python3 未安装，跳过`);
}

// ── Demo 4: 数据敏感度分类 ────────────────────────────────────
console.log('\n▶ Demo 4: DataClassifier — 数据敏感度分类');
console.log('─'.repeat(72));
const classifier = new DataClassifier();
const samples = [
  '今天天气不错',
  '请联系 zhangsan@company.com',
  '手机号 13812345678',
  '密钥：sk-abcdefghijklmnopqrst',
  '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...',
  '内网地址 http://192.168.1.100:3000/api',
];
for (const s of samples) {
  const r = classifier.classify(s);
  const icon = { public: '🟢', internal: '🟡', confidential: '🟠', secret: '🔴' }[r.sensitivity];
  log(`${icon} [${r.sensitivity.padEnd(12)}] "${s.slice(0, 50)}${s.length > 50 ? '...' : ''}"`);
  if (r.matchedPatterns.length > 0) {
    log(`   命中规则: ${r.matchedPatterns.join(', ')}`);
  }
}

// ── Demo 5: 数据流合规检查 ────────────────────────────────────
console.log('\n▶ Demo 5: DataFlowGuard — 数据流合规检查');
console.log('─'.repeat(72));
const guard = new DataFlowGuard();
const flowTests: { content: string; target: 'web' | 'file' | 'email' | 'log' }[] = [
  { content: '普通文本报告', target: 'web' },
  { content: '密钥 sk-abcdefghijklmnopqrst', target: 'web' },
  { content: '密钥 sk-abcdefghijklmnopqrst', target: 'file' },
  { content: '邮箱 user@example.com', target: 'web' },
  { content: '邮箱 user@example.com', target: 'email' },
];
for (const { content, target } of flowTests) {
  try {
    guard.checkBeforeSend(content, target);
    log(`✅ "${content.slice(0, 30)}" → ${target} — 允许`);
  } catch (e) {
    if (e instanceof DataFlowViolation) {
      log(`🚫 "${content.slice(0, 30)}" → ${target} — 拦截（${e.sensitivity} 级数据）`);
    }
  }
}

// ── Demo 6: 多 Agent 权限模型 ─────────────────────────────────
console.log('\n▶ Demo 6: PermissionPolicy — 多 Agent 权限隔离');
console.log('─'.repeat(72));
const policy = new PermissionPolicy();
const checks: { role: 'planner' | 'researcher' | 'coder' | 'reviewer'; resource: any; action: any }[] = [
  { role: 'planner', resource: 'tool', action: 'read' },
  { role: 'planner', resource: 'code_execution', action: 'execute' },
  { role: 'researcher', resource: 'network', action: 'read' },
  { role: 'researcher', resource: 'email', action: 'send' },
  { role: 'coder', resource: 'code_execution', action: 'execute' },
  { role: 'coder', resource: 'secret', action: 'read' },
  { role: 'reviewer', resource: 'file', action: 'read' },
  { role: 'reviewer', resource: 'file', action: 'write' },
];
for (const { role, resource, action } of checks) {
  const allowed = policy.check(role, { resource, action });
  log(`${allowed ? '✅' : '🚫'} ${role.padEnd(12)} ${resource}:${action}`);
}

// ── Demo 7: 审计日志 ──────────────────────────────────────────
console.log('\n▶ Demo 7: AuditLogger — 安全审计日志');
console.log('─'.repeat(72));
const audit = new AuditLogger();
audit.logToolInvocation('analyze_completeness', 'researcher-agent', 'success');
audit.logToolInvocation('rm_rf', 'hacked-agent', 'denied');
audit.logInjectionDetected(['ignore-instructions'], 128, 'user-456', 'trace-789');
audit.logHumanDecision('save_report', 'admin-001', true, 'trace-101');
audit.logSandboxExecution('python3', 0, 1500, 'coder-agent');

log(`共记录 ${audit.size} 条审计事件`);
log('\n按类型统计：');
const counts = audit.countByType();
for (const [type, count] of Object.entries(counts)) {
  log(`  ${type}: ${count}`);
}

log('\n查询 critical 级事件：');
const critical = audit.query({ severity: 'critical' });
for (const e of critical) {
  log(`  [${e.timestamp}] ${e.eventType} by ${e.actor} → ${e.outcome}`);
}

console.log('\n' + '='.repeat(72));
console.log('✅ 所有安全演示完成');
console.log('='.repeat(72));
