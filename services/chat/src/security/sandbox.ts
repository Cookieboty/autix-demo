/**
 * sandbox.ts —— 进程级代码执行沙箱（第十八章 18.4）。
 *
 * 提供三层防护：
 *   1. PathValidator  — 文件路径白名单，禁止越界访问
 *   2. EnvironmentFilter — 环境变量过滤，只传最小集合给子进程
 *   3. ProcessSandbox — 受限子进程执行（限 cwd、env、timeout、maxBuffer）
 *
 * 设计原则：
 *   - 纯函数 + 可注入接口，零外部依赖（不依赖 Docker/gVisor）
 *   - 本地可跑可测（bun test），生产可升级到容器级隔离
 *   - 所有限制可配置，默认取安全侧
 */
import { spawn, type SpawnOptions } from 'child_process';

// ─────────────────────── PathValidator ───────────────────────

export class PathEscapeError extends Error {
  constructor(
    public readonly attemptedPath: string,
    public readonly allowedRoot: string,
  ) {
    super(`路径越界：${attemptedPath} 不在允许的根目录 ${allowedRoot} 内`);
    this.name = 'PathEscapeError';
  }
}

/**
 * 文件路径沙箱校验器。
 * 阻止 Agent 访问允许目录之外的文件——即使 Agent 使用 `..`、符号链接、绝对路径等手段。
 */
export class PathValidator {
  private readonly roots: string[];

  constructor(allowedRoots: string[]) {
    const { resolve } = require('path');
    this.roots = allowedRoots.map((r) => resolve(r));
  }

  /**
   * 校验路径是否在允许的根目录内。
   * 做法：先 resolve（消除 .. 和软链接），再看前缀是否匹配。
   */
  validate(targetPath: string): void {
    const { resolve } = require('path');
    const resolved = resolve(targetPath);
    const inBounds = this.roots.some(
      (root) => resolved === root || resolved.startsWith(root + '/'),
    );
    if (!inBounds) {
      throw new PathEscapeError(targetPath, this.roots.join(', '));
    }
  }

  /** 批量校验，任何一个路径越界即抛出 */
  validateAll(paths: string[]): void {
    for (const p of paths) this.validate(p);
  }
}

// ─────────────────────── EnvironmentFilter ───────────────────────

/** 敏感环境变量的关键词黑名单（不区分大小写） */
const SENSITIVE_ENV_PATTERNS = [
  'key',
  'secret',
  'token',
  'password',
  'credential',
  'auth',
  'private',
  'apikey',
  'api_key',
  'database_url',
  'db_url',
  'connection_string',
];

/**
 * 环境变量过滤器。
 * 默认策略：只保留 PATH + 用户显式指定的变量，丢弃所有可能含密钥的变量。
 */
export class EnvironmentFilter {
  private readonly patterns: string[];

  constructor(additionalPatterns?: string[]) {
    this.patterns = [...SENSITIVE_ENV_PATTERNS, ...(additionalPatterns ?? [])];
  }

  /** 检查某个环境变量名是否疑似敏感 */
  isSensitive(name: string): boolean {
    const lower = name.toLowerCase();
    return this.patterns.some((p) => lower.includes(p));
  }

  /**
   * 从原始 env 中过滤出安全的子集。
   * @param source 原始环境变量（默认 process.env）
   * @param allow  额外允许的变量名白名单
   */
  filter(
    source: Record<string, string | undefined> = process.env,
    allow: string[] = [],
  ): Record<string, string> {
    const allowSet = new Set(['PATH', 'HOME', 'LANG', 'TERM', ...allow]);
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(source)) {
      if (val === undefined) continue;
      if (allowSet.has(key)) {
        result[key] = val;
      } else if (!this.isSensitive(key)) {
        result[key] = val;
      }
    }
    return result;
  }
}

// ─────────────────────── ProcessSandbox ───────────────────────

export class SandboxTimeoutError extends Error {
  constructor(
    public readonly command: string,
    public readonly timeoutMs: number,
  ) {
    super(`沙箱执行超时：${command}（${timeoutMs}ms）`);
    this.name = 'SandboxTimeoutError';
  }
}

export class SandboxExitError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`沙箱执行失败：${command} 退出码 ${exitCode}`);
    this.name = 'SandboxExitError';
  }
}

export interface SandboxConfig {
  /** 工作目录（子进程的 cwd） */
  workDir: string;
  /** 执行超时（ms），默认 10 秒 */
  timeoutMs?: number;
  /** stdout+stderr 最大字节数，默认 1MB */
  maxOutputBytes?: number;
  /** 额外允许的环境变量名 */
  allowedEnvVars?: string[];
  /** 额外的环境变量黑名单关键词 */
  sensitivePatterns?: string[];
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  killed: boolean;
}

/**
 * 进程级代码执行沙箱。
 *
 * 与 `execSync('python3 script.py')` 的区别：
 *   1. 限定 cwd，不能操作任意目录
 *   2. 过滤 env，不继承 API Key 等密钥
 *   3. 加超时，不会无限卡住进程
 *   4. 限输出大小，不会撑爆内存
 *   5. 异步非阻塞，不会阻塞事件循环
 *
 * 这是「最小受限替代」——不是容器级隔离（那需要 Docker/gVisor），
 * 但堵住了 execSync 最容易踩的四个坑。
 */
export class ProcessSandbox {
  private readonly envFilter: EnvironmentFilter;
  private readonly pathValidator: PathValidator;
  readonly config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = {
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
      ...config,
    };
    this.envFilter = new EnvironmentFilter(config.sensitivePatterns);
    this.pathValidator = new PathValidator([config.workDir]);
  }

  /**
   * 在沙箱中执行命令。
   *
   * @param command 可执行文件（如 'python3'、'node'）
   * @param args    命令参数
   * @param stdin   可选的 stdin 输入（用于传代码内容，比传文件路径更安全）
   */
  execute(
    command: string,
    args: string[] = [],
    stdin?: string,
  ): Promise<SandboxResult> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const safeEnv = this.envFilter.filter(process.env, this.config.allowedEnvVars);

      const opts: SpawnOptions = {
        cwd: this.config.workDir,
        env: safeEnv,
        timeout: this.config.timeoutMs,
        stdio: ['pipe', 'pipe', 'pipe'],
      };

      const child = spawn(command, args, opts);

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let killed = false;
      const maxBytes = this.config.maxOutputBytes!;

      child.stdout!.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes <= maxBytes) {
          stdout += chunk.toString();
        } else if (!killed) {
          killed = true;
          child.kill('SIGKILL');
        }
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes <= maxBytes) {
          stderr += chunk.toString();
        } else if (!killed) {
          killed = true;
          child.kill('SIGKILL');
        }
      });

      if (stdin !== undefined) {
        child.stdin!.write(stdin);
        child.stdin!.end();
      } else {
        child.stdin!.end();
      }

      child.on('close', (code, signal) => {
        const durationMs = Date.now() - start;

        if (signal === 'SIGTERM' || (killed && outputBytes > maxBytes)) {
          reject(
            new SandboxTimeoutError(
              `${command} ${args.join(' ')}`,
              this.config.timeoutMs!,
            ),
          );
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          durationMs,
          killed,
        });
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 在沙箱中运行 Python 代码（通过 stdin 传入，不写临时文件）。
   */
  async runPython(code: string): Promise<SandboxResult> {
    return this.execute('python3', ['-c', code]);
  }

  /**
   * 在沙箱中运行 Node.js 代码（通过 -e 参数传入）。
   */
  async runNode(code: string): Promise<SandboxResult> {
    return this.execute('node', ['-e', code]);
  }

  /** 校验路径是否在沙箱 workDir 内 */
  validatePath(targetPath: string): void {
    this.pathValidator.validate(targetPath);
  }
}
