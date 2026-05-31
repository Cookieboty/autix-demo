import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { ConversationController } from './conversation.controller';
import { MessageModule } from '../message/message.module';
import { LlmModule } from '../llm/llm.module';
import { DocumentModule } from '../document/document.module';
import { AdvancedAnalysisService } from '../llm/advanced-analysis.service';

@Module({
  imports: [MessageModule, LlmModule, DocumentModule],
  providers: [ConversationService, AdvancedAnalysisService],
  controllers: [ConversationController],
  exports: [ConversationService],
})
export class ConversationModule {}
