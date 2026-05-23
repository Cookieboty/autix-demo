/**
 * MCP Manager
 *
 * 统一管理多个 MCP Server 连接，提供：
 * - 工具命名空间隔离（前缀策略）
 * - 按需连接 / 启动时预连接
 * - 降级策略：Server 不可用时回退本地工具
 * - 所有工具的聚合列表
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { MCPClientService, MCPClientConfig } from './mcp-client.service.js';
import { bridgeMCPToLangChain } from './mcp-to-langchain.js';

export interface ServerRegistration {
  id: string;
  config: MCPClientConfig;
  prefix?: string;
  /** 连接失败时的降级工具 */
  fallbackTools?: DynamicStructuredTool[];
}

export class MCPManager {
  private servers = new Map<string, MCPClientService>();
  private registrations: ServerRegistration[] = [];
  private tools: DynamicStructuredTool[] = [];

  register(registration: ServerRegistration): void {
    this.registrations.push(registration);
  }

  async connectAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.registrations.map((reg) => this.connectOne(reg)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const reg = this.registrations[i];
      if (result.status === 'rejected') {
        console.error(`[MCPManager] Failed to connect to "${reg.id}": ${result.reason}`);
        if (reg.fallbackTools) {
          this.tools.push(...reg.fallbackTools);
          console.error(`[MCPManager] Using ${reg.fallbackTools.length} fallback tools for "${reg.id}"`);
        }
      }
    }
  }

  private async connectOne(reg: ServerRegistration): Promise<void> {
    const client = new MCPClientService(reg.config);
    await client.connect();
    this.servers.set(reg.id, client);

    const prefix = reg.prefix || `${reg.id}_`;
    const bridgedTools = bridgeMCPToLangChain(client, prefix);
    this.tools.push(...bridgedTools);
  }

  getTools(): DynamicStructuredTool[] {
    return this.tools;
  }

  getClient(serverId: string): MCPClientService | undefined {
    return this.servers.get(serverId);
  }

  async disconnectAll(): Promise<void> {
    const clients = Array.from(this.servers.values());
    await Promise.allSettled(clients.map((c) => c.close()));
    this.servers.clear();
    this.tools = [];
  }

  getConnectedServerIds(): string[] {
    return Array.from(this.servers.keys());
  }
}
