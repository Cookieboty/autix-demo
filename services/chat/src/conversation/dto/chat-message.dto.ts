/**
 * chat-message.dto.ts —— 对话入口的输入校验（第十八章 18.3.1）。
 *
 * 注意：chat 入口的 message 是**多态**的——纯文本时是 string，
 * UI 动作时是 object（见 conversation.controller 的 isUIAction 分支）。
 * 所以只在「message 是字符串」时校验长度（ValidateIf），
 * UI 动作对象直接放行，避免误伤既有交互流。
 */
import { IsString, IsOptional, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ChatMessageDto {
  @ValidateIf((o: ChatMessageDto) => typeof o.message === 'string')
  @IsString()
  @MinLength(1, { message: '消息不能为空' })
  @MaxLength(4000, { message: '消息过长（上限 4000 字符）' })
  message!: string | Record<string, unknown>;

  @IsOptional()
  @IsString()
  modelId?: string;
}
