import { Injectable } from '@nestjs/common';
import { HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { createChatModel } from '../model.factory';
import {
  queryRequirementTool,
  readFileTool,
  writeFileTool,
  safePath,
} from '../tools/business.tools';
import fs from 'node:fs';
import path from 'node:path';

@Injectable()
export class FilesystemService {
  private tools: StructuredToolInterface[] = [
    queryRequirementTool,
    readFileTool,
    writeFileTool,
  ];
  private toolMap = new Map(this.tools.map((t) => [t.name, t]));
  private model = createChatModel().bindTools(this.tools);

  // 工具循环：模型决定调用工具 → 执行 → 回灌结果 → 直到模型给出最终回答
  async chat(input: string) {
    const messages: BaseMessage[] = [new HumanMessage(input)];
    const usedTools: string[] = [];

    for (let i = 0; i < 5; i++) {
      const ai = await this.model.invoke(messages);
      messages.push(ai);

      const calls = ai.tool_calls ?? [];
      if (calls.length === 0) {
        return { response: ai.content, usedTools };
      }

      for (const call of calls) {
        usedTools.push(call.name);
        const selected = this.toolMap.get(call.name);
        const result = selected
          ? await selected.invoke(call.args)
          : { error: `未知工具 ${call.name}` };
        messages.push(
          new ToolMessage({
            content: JSON.stringify(result),
            tool_call_id: call.id ?? call.name,
          })
        );
      }
    }

    return { response: '工具调用超出上限', usedTools };
  }

  // 供 analyze() 直接落盘报告，无需经过工具循环
  writeReport(filePath: string, content: string) {
    const full = safePath(filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    return filePath;
  }
}
