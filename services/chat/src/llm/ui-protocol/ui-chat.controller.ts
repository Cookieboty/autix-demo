import { Body, Controller, Post } from '@nestjs/common';
import { UIFlowService } from './ui-flow.service';
import { UIResponseService } from './ui-response.service';
import type { UIAction } from './ui-types';

@Controller('api/ui-chat')
export class UIChatController {
  constructor(
    private readonly uiFlow: UIFlowService,
    private readonly uiResponse: UIResponseService,
  ) {}

  /** 确定性状态机：处理自然语言输入，进入对应流程阶段 */
  @Post('chat')
  chat(@Body() body: { sessionId: string; input: string }) {
    return this.uiFlow.handleInput(body.sessionId, body.input);
  }

  /** 确定性状态机：处理用户的 UI 操作，推进到下一阶段 */
  @Post('action')
  action(@Body() body: { sessionId: string; action: UIAction }) {
    return this.uiFlow.handleAction(body.sessionId, body.action);
  }

  /** LLM 驱动：用 withStructuredOutput 让模型直接产出 UI 协议（6.2 能力） */
  @Post('generate')
  async generate(@Body() body: { input: string; context?: Record<string, unknown> }) {
    try {
      return await this.uiResponse.generateUIResponse(body.input, [], body.context);
    } catch (err) {
      // LLM structured output is an external dependency; keep the endpoint usable with
      // the deterministic UI flow rather than leaking parser/provider failures as 500s.
      console.error(
        '[UIChatController] structured generation failed:',
        err instanceof Error ? err.name : 'UnknownError',
      );
      return this.uiFlow.handleInput('ui-generate-fallback', body.input);
    }
  }
}
