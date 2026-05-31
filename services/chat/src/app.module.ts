import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
