/**
 * MCP Client Service
 *
 * 封装对单个 MCP Server 的连接、生命周期管理和工具调用。
 * 生命周期：connect → initialize → listTools → callTool → close
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface MCPClientConfig {
  /** Server 可执行文件的命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 连接超时（ms） */
  timeout?: number;
}

export class MCPClientService {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private connected = false;
  private tools: Tool[] = [];
  private readonly config: MCPClientConfig;

  constructor(config: MCPClientConfig) {
    this.config = config;
    this.client = new Client(
      { name: 'autix-chat-client', version: '1.0.0' },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: { ...process.env, ...this.config.env } as Record<string, string>,
    });

    await this.client.connect(this.transport);
    this.connected = true;

    const { tools } = await this.client.listTools();
    this.tools = tools;
  }

  getTools(): Tool[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.connected) {
      throw new Error(`MCPClient not connected. Call connect() first.`);
    }
    // MCP SDK 的 callTool 返回类型是个并集（含已废弃的 { toolResult } 分支），
    // 运行时实际返回 CallToolResult；这里做结构化断言收窄到我们的契约类型。
    return this.client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
    this.transport = null;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
