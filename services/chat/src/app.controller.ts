import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';
import { registry } from './observability/metrics';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // liveness 探针保留（进程没崩）
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  // readiness 探针：真探 DB，未就绪返回 503（16.5.2）
  @Get('ready')
  async ready(@Res() res: Response) {
    const r = await this.appService.getReadiness();
    res.status(r.ready ? 200 : 503).json(r);
  }

  // Prometheus 抓取端点（进程内累加的指标，16.5.1）
  @Get('metrics')
  @Header('Content-Type', 'text/plain')
  async metrics() {
    return registry.metrics();
  }

  @Get('hello')
  getHello() {
    return this.appService.getHello();
  }
}
