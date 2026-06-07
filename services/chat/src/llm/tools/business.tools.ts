import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';

const WORKSPACE_ROOT = path.join(process.cwd(), 'workspace');

// 路径沙箱：所有文件操作必须落在 workspace/ 内，防止路径逃逸
export function safePath(filePath: string) {
  const resolved = path.resolve(WORKSPACE_ROOT, filePath);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error('路径不允许逃逸工作目录');
  }
  return resolved;
}

export const queryRequirementTool = tool(
  async ({ requirementId }: { requirementId: string }) => {
    const full = safePath(`requirements/${requirementId}.json`);
    if (!fs.existsSync(full)) return { error: `需求 ${requirementId} 不存在` };
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  },
  {
    name: 'query_requirement',
    description: '根据需求单号查询需求详情、提出方、目标与约束',
    schema: z.object({
      requirementId: z.string().describe('需求单号，例如 REQ-2026-001'),
    }),
  }
);

export const readFileTool = tool(
  async ({ filePath }: { filePath: string }) => {
    const full = safePath(filePath);
    if (!fs.existsSync(full)) return { error: '文件不存在' };
    return { content: fs.readFileSync(full, 'utf8') };
  },
  {
    name: 'read_file',
    description: '读取需求规范、标准或其他业务文件',
    schema: z.object({
      filePath: z.string().describe('相对于 workspace 的文件路径'),
    }),
  }
);

export const writeFileTool = tool(
  async ({ filePath, content }: { filePath: string; content: string }) => {
    const full = safePath(filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    return { success: true, path: filePath };
  },
  {
    name: 'write_file',
    description: '写入需求分析报告或制品',
    schema: z.object({
      filePath: z.string().describe('相对于 workspace 的文件路径'),
      content: z.string().describe('要写入的内容'),
    }),
  }
);
