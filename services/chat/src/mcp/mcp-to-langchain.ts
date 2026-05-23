/**
 * MCP Tool → LangChain Tool 桥接器
 *
 * 将 MCP Server 暴露的 Tools 动态转换为 LangChain 的 DynamicStructuredTool，
 * 使其可被 LangGraph Agent 直接使用。
 *
 * 核心转换：JSON Schema → Zod Schema，MCP content[] → string
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z, ZodObject, ZodRawShape, ZodTypeAny } from 'zod';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPClientService } from './mcp-client.service.js';

/**
 * 将 MCP Server 的所有工具转换为 LangChain Tools
 * @param client - 已连接的 MCPClientService 实例
 * @param prefix - 工具名前缀（用于多 Server 去重），如 "req_"
 */
export function bridgeMCPToLangChain(
  client: MCPClientService,
  prefix = '',
): DynamicStructuredTool[] {
  const mcpTools = client.getTools();
  return mcpTools.map((tool) => mcpToolToLangChain(tool, client, prefix));
}

function mcpToolToLangChain(
  tool: MCPTool,
  client: MCPClientService,
  prefix: string,
): DynamicStructuredTool {
  const zodSchema = jsonSchemaToZod(tool.inputSchema as JsonSchemaObject);

  return new DynamicStructuredTool({
    name: `${prefix}${tool.name}`,
    description: tool.description || tool.name,
    schema: zodSchema,
    func: async (args) => {
      const result = await client.callTool(tool.name, args);
      return serializeMCPContent(result.content as MCPContent[]);
    },
  });
}

// ============================================================================
// JSON Schema → Zod 转换
// ============================================================================

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  enum?: string[];
}

interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export function jsonSchemaToZod(schema: JsonSchemaObject): ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {};
  const required = new Set(schema.required || []);

  for (const [key, prop] of Object.entries(schema.properties || {})) {
    let zodType = propertyToZod(prop);
    if (!required.has(key)) {
      zodType = zodType.optional();
    }
    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }
    shape[key] = zodType;
  }

  return z.object(shape);
}

function propertyToZod(prop: JsonSchemaProperty): ZodTypeAny {
  if (prop.enum) {
    return z.enum(prop.enum as [string, ...string[]]);
  }

  switch (prop.type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      if (prop.items) {
        return z.array(propertyToZod(prop.items));
      }
      return z.array(z.unknown());
    case 'object':
      if (prop.properties) {
        return jsonSchemaToZod(prop as JsonSchemaObject);
      }
      return z.record(z.unknown());
    default:
      return z.unknown();
  }
}

// ============================================================================
// MCP Content → string 序列化
// ============================================================================

interface MCPContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

function serializeMCPContent(content: MCPContent[]): string {
  return content
    .map((c) => {
      if (c.type === 'text') return c.text || '';
      if (c.type === 'image') return `[image: ${c.mimeType}]`;
      if (c.type === 'resource') return c.text || `[resource]`;
      return JSON.stringify(c);
    })
    .join('\n');
}
