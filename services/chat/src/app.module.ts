import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { LlmModule } from './llm/llm.module';
import { MessageModule } from './message/message.module';
import { ConversationModule } from './conversation/conversation.module';
import { DocumentModule } from './document/document.module';
import { SseModule } from './sse/sse.module';
import { UiChatModule } from './llm/ui-protocol/ui-chat.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    LlmModule,
    MessageModule,
    ConversationModule,
    DocumentModule,
    SseModule,
    UiChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
