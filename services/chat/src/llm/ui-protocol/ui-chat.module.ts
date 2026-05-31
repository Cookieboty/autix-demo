import { Module } from '@nestjs/common';
import { UIChatController } from './ui-chat.controller';
import { UIFlowService } from './ui-flow.service';
import { UIResponseService } from './ui-response.service';

@Module({
  controllers: [UIChatController],
  providers: [UIFlowService, UIResponseService],
})
export class UiChatModule {}
