import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { RequirementService } from './llm/requirement.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly requirementService: RequirementService
  ) {}

  // 健康探针：为 Compose/监控提供稳定入口
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  // 验证「共享包 + API 返回 + 前端消费」的最小闭环
  @Get('hello')
  getHello() {
    return this.appService.getHello();
  }

  // 3.9 能力收束：把整条链路落到统一业务入口
  @Post('/requirement/extract')
  async extract(@Body() body: { input: string }) {
    return this.requirementService.extract(body.input);
  }
}
