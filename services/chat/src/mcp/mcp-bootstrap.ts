/**
 * mcp-bootstrap.ts —— 第二十章 20.4：把 MCP 工具接进生产主链路。
 *
 * 调研发现 MCP（第十二章）此前没接进生产——app.module 没引用它、src/ 下除 mcp 目录自己
 * 没有任何引用。这里提供一个进程级单例 + 启动期连接，让专家子图能 import { mcpManager } 取工具。
 *
 * 关键点：
 *   - prefix: '' —— 桥接后保持原始工具名（analyze_completeness 等），否则 getTools() 里
 *     第十八章的 isAllowed 白名单（按原始名登记）会把带前缀的名全过滤掉，等于静默没接上。
 *   - initMcp 永不抛错：连接失败（servers 没装/没起）由 MCPManager.connectAll 的 allSettled
 *     兜住，getTools() 返回空，专家自动降级 Mock 工具（第八章「依赖失败变有类型降级」）。
 *   - MCP server 实体在仓库根 mcp-servers/{requirement-analyzer,web-search}（stdio，bun 启动）。
 *     web-search 无 TAVILY_API_KEY 时自动 mock，不需要外部 key 也能真接、可验证。
 */
import * as path from 'path';
import { MCPManager } from './mcp-manager';

export const mcpManager = new MCPManager();

let initialized = false;
let initPromise: Promise<void> | null = null;

/** MCP server 入口（仓库根 mcp-servers/<name>/src/index.ts，相对运行时 cwd=services/chat 解析）。 */
function serverEntry(name: string): string {
  return path.resolve(
    process.cwd(),
    '..',
    '..',
    'mcp-servers',
    name,
    'src',
    'index.ts',
  );
}

/** 启动期一次性连接 MCP servers（幂等、best-effort、永不抛错）。 */
export async function initMcp(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    mcpManager.register({
      id: 'requirement-analyzer',
      prefix: '',
      config: { command: 'bun', args: [serverEntry('requirement-analyzer')] },
    });
    mcpManager.register({
      id: 'web-search',
      prefix: '',
      config: { command: 'bun', args: [serverEntry('web-search')] },
    });
    try {
      await mcpManager.connectAll();
      const names = mcpManager.getTools().map((t) => t.name);
      console.log(
        `[MCP] connected: ${mcpManager.getConnectedServerIds().join(', ') || '(none)'}; 白名单工具=[${names.join(', ')}]`,
      );
    } catch (err) {
      console.warn(
        '[MCP] connectAll 失败，专家将降级使用 Mock 工具:',
        err instanceof Error ? err.message : String(err),
      );
    }
    initialized = true;
  })();
  return initPromise;
}
