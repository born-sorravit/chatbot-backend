import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { MaybeAuthenticatedRequest } from '@/shared/interfaces/request-context';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

const STATUS_CODE_FALLBACK: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'INSUFFICIENT_PERMISSIONS',
  [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'FILE_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
};

/**
 * Single error envelope for the whole API (docs/API.md §0).
 *
 * Unhandled errors are logged with their stack and returned as a generic
 * INTERNAL_ERROR carrying only the requestId. Leaking a stack trace or a
 * driver message to a client is an information disclosure, so the detail
 * stays in the logs where the requestId can find it.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<MaybeAuthenticatedRequest>();
    const requestId = request.requestId ?? 'unknown';

    const { status, body } = this.normalize(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          requestId,
          organizationId: request.user?.organizationId,
          method: request.method,
          path: request.url,
          status,
        },
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn({
        requestId,
        organizationId: request.user?.organizationId,
        method: request.method,
        path: request.url,
        status,
        code: body.code,
      });
    }

    response.status(status).json({ error: { ...body, requestId } });
  }

  private normalize(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return {
          status,
          body: { code: STATUS_CODE_FALLBACK[status] ?? 'ERROR', message: payload },
        };
      }

      const record = payload as Record<string, unknown>;

      // class-validator produces { message: string[] } — turn that into the
      // documented details[] shape instead of passing an array through as
      // a message field the client has to special-case.
      const rawMessage = record.message;
      const isValidationArray = Array.isArray(rawMessage);

      return {
        status,
        body: {
          code:
            typeof record.code === 'string'
              ? record.code
              : (STATUS_CODE_FALLBACK[status] ?? 'ERROR'),
          message: isValidationArray
            ? 'Request validation failed'
            : typeof rawMessage === 'string'
              ? rawMessage
              : exception.message,
          ...(isValidationArray ? { details: rawMessage } : {}),
          ...(record.details !== undefined ? { details: record.details } : {}),
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    };
  }
}
