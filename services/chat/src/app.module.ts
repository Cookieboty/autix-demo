import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { LlmModule } from './llm/llm.module';
import { MessageModule } from './message/message.module';
import { ConversationModule } from './conversation/conversation.module';
import { DocumentModule } from './document/document.module';
import { SseModule } from './sse/sse.module';
import { ModelConfigModule } from './model-config/model-config.module';
import { ArtifactModule } from './artifact/artifact.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TraceMiddleware } from './observability/trace.middleware';
import { initMcp } from './mcp/mcp-bootstrap';

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
    ModelConfigModule,
    ArtifactModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule, OnApplicationBootstrap {
  // 16.2.4：在请求入口建立 traceId 上下文，让全链路日志可被同一 traceId 串联
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }

  // 20.4：启动期连接 MCP servers，让专家子图用真实 MCP 工具（失败自动降级 Mock，永不阻塞启动）
  async onApplicationBootstrap() {
    await initMcp();
  }
}
