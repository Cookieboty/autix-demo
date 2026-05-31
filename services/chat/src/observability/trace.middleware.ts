/**
 * trace.middleware.ts
 *
 * NestJS 中间件：在每个请求入口
 * 1. 复用上游传来的 x-trace-id（便于跨服务串联），没有则新建一个
 * 2. 用 runWithTrace 建立 ALS 上下文，包住整个请求处理链
 * 3. 把 traceId 回写到响应头 x-trace-id（前端/网关可见）
 * 4. 请求结束时打一条 access 日志（含状态码、耗时）并记录 http 耗时直方图
 */
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithTrace, newTraceId, getElapsedMs } from './trace-context';
import { createLogger } from './logger';
import { httpDuration } from './metrics';

const accessLog = createLogger('http');

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-trace-id'];
    const traceId = (typeof incoming === 'string' && incoming) || newTraceId();

    runWithTrace(traceId, () => {
      res.setHeader('x-trace-id', traceId);
      res.on('finish', () => {
        const elapsedMs = getElapsedMs();
        const route = (req as any).route?.path ?? req.path;
        accessLog.info(
          { method: req.method, path: req.path, status: res.statusCode, elapsedMs },
          'http_request',
        );
        httpDuration.observe(
          { method: req.method, route, status: String(res.statusCode) },
          elapsedMs / 1000,
        );
      });
      next();
    });
  }
}
