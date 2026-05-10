/**
 * message-trimmer.ts
 *
 * 第十章 10.5：LangGraph 消息裁剪。
 * 保留 system message，保留最近 N 条消息，清理孤立 ToolMessage，
 * 保持 AIMessage(tool_calls) 与 ToolMessage 成对。
 */
import { BaseMessage, SystemMessage } from '@langchain/core/messages';

export interface TrimOptions {
  maxMessages?: number;
  preserveSystemMessages?: boolean;
}

export function trimMessagesForContext(
  messages: BaseMessage[],
  options: TrimOptions = {},
): BaseMessage[] {
  const { maxMessages = 20, preserveSystemMessages = true } = options;

  const systemMsgs = preserveSystemMessages
    ? messages.filter((m) => m instanceof SystemMessage)
    : [];
  const nonSystemMsgs = messages.filter((m) => !(m instanceof SystemMessage));

  const trimmed = nonSystemMsgs.slice(-maxMessages);
  const cleaned = removeOrphanToolMessages(trimmed);

  return [...systemMsgs, ...cleaned];
}

/**
 * 清理孤立 ToolMessage：按 tool_call_id 精确配对。
 *
 * - AIMessage(tool_calls) 必须满足"它声明的每一个 tool_call.id 都能在窗口内找到
 *   对应 tool_call_id 的 ToolMessage"，否则整条 AIMessage 被移除（避免 OpenAI 报
 *   "tool_calls 不完整"）。
 * - ToolMessage 仅当其 tool_call_id 出现在某条幸存 AIMessage 的 tool_calls 中时
 *   才保留。
 *
 * 注意：这里要求 AIMessage 的所有 tool_call.id 都被响应，是"全有或全无"策略，
 * 比"至少一个匹配"更安全——OpenAI/Anthropic 在 tool_call 部分缺失时都会拒绝请求。
 */
function removeOrphanToolMessages(messages: BaseMessage[]): BaseMessage[] {
  const respondedToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg._getType() === 'tool') {
      const tcId = (msg as any).tool_call_id as string | undefined;
      if (tcId) respondedToolCallIds.add(tcId);
    }
  }

  const survivingAiIndices = new Set<number>();
  const survivingToolCallIds = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg._getType() !== 'ai') continue;
    const toolCalls = (msg as any).tool_calls as
      | Array<{ id?: string }>
      | undefined;
    if (!toolCalls || toolCalls.length === 0) continue;

    const allResponded = toolCalls.every(
      (tc) => tc.id && respondedToolCallIds.has(tc.id),
    );
    if (allResponded) {
      survivingAiIndices.add(i);
      for (const tc of toolCalls) {
        if (tc.id) survivingToolCallIds.add(tc.id);
      }
    }
  }

  const result: BaseMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgType = msg._getType();

    if (msgType === 'ai') {
      const toolCalls = (msg as any).tool_calls as
        | Array<{ id?: string }>
        | undefined;
      if (toolCalls && toolCalls.length > 0) {
        if (survivingAiIndices.has(i)) result.push(msg);
        continue;
      }
    }

    if (msgType === 'tool') {
      const tcId = (msg as any).tool_call_id as string | undefined;
      if (tcId && survivingToolCallIds.has(tcId)) result.push(msg);
      continue;
    }

    result.push(msg);
  }

  return result;
}
