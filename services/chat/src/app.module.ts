import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { AdvancedModule } from './llm/advanced.module';

@Module({
  imports: [LlmModule, AdvancedModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
