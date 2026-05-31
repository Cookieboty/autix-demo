import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiResponse, ErrorCode } from '@autix/types';
import { getTraceId } from '../observability/trace-context';
import { createLogger } from '../observability/logger';

const errorLog = createLogger('exception');

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = '服务器内部错误';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse() as any;
      message = typeof exResponse === 'string'
        ? exResponse
        : (exResponse.message ?? exception.message);

      if (Array.isArray(message)) message = message.join(', ');

      switch (status) {
        case 400: code = 'BAD_REQUEST'; break;
        case 401: code = 'UNAUTHORIZED'; break;
        case 403: code = 'FORBIDDEN'; break;
        case 404: code = 'NOT_FOUND'; break;
        case 409: code = 'CONFLICT'; break;
        default: code = 'INTERNAL_ERROR';
      }
    }

    // 16.2：复用请求级 traceId，并补一条结构化 error 日志（不再静默吞掉异常，A12）
    const traceId = getTraceId();
    errorLog.error(
      { code, status, err: String(exception).slice(0, 300) },
      'unhandled_exception',
    );
    const body: ApiResponse<null> = {
      success: false,
      code,
      msg: message as string,
      traceId,
      data: null,
    };

    response.status(status).json(body);
  }
}
