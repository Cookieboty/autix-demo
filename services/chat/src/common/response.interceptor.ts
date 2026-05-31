import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '@autix/types';
import { getTraceId } from '../observability/trace-context';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // 16.2：与 TraceMiddleware 建立的请求级 traceId 复用同一 ID（不再各自 randomUUID）
        const traceId = getTraceId();
        if (data && typeof data === 'object' && 'success' in data) {
          return data;
        }
        return {
          success: true,
          code: '200',
          msg: '请求成功',
          traceId,
          data,
        } as ApiResponse;
      }),
    );
  }
}
