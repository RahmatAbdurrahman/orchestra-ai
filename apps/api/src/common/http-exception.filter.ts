import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@orchestra/database';
import { isDomainError, type DomainErrorCode } from '@orchestra/domain';
import type { Request, Response } from 'express';
import { RequestContext } from './request-context';

const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  INVALID_TRANSITION: HttpStatus.CONFLICT,
  CONFLICT: HttpStatus.CONFLICT,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  VALIDATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  BUSINESS_RULE_VIOLATION: HttpStatus.UNPROCESSABLE_ENTITY,
  RETRY_LIMIT_REACHED: HttpStatus.CONFLICT,
  PRECONDITION_FAILED: HttpStatus.CONFLICT,
};

const HTTP_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; correlationId: string | null };
}

/**
 * Consistent error responses: { error: { code, message, details?, correlationId } }.
 * Unexpected errors are logged with the correlation id and returned without internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const correlationId = RequestContext.correlationId();
    const { status, body } = this.toResponse(exception, correlationId);
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed [${correlationId}]: ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    }
    response.status(status).json(body);
  }

  private toResponse(exception: unknown, correlationId: string | null): { status: number; body: ErrorBody } {
    if (isDomainError(exception)) {
      return {
        status: DOMAIN_STATUS[exception.code] ?? HttpStatus.BAD_REQUEST,
        body: { error: { code: exception.code, message: exception.message, details: exception.details, correlationId } },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      let message = exception.message;
      let details: unknown;
      if (typeof payload === 'object' && payload !== null) {
        const raw = (payload as { message?: unknown }).message;
        if (Array.isArray(raw)) {
          message = 'Validation failed';
          details = raw;
        } else if (typeof raw === 'string') {
          message = raw;
        }
        if ((payload as { details?: unknown }).details !== undefined) details = (payload as { details?: unknown }).details;
      }
      const code =
        Array.isArray((payload as { message?: unknown })?.message) && status === 400
          ? 'VALIDATION_FAILED'
          : ((payload as { code?: string })?.code ?? HTTP_CODES[status] ?? 'ERROR');
      return { status, body: { error: { code, message, ...(details !== undefined ? { details } : {}), correlationId } } };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: { error: { code: 'CONFLICT', message: 'A record with the same unique value already exists', correlationId } },
        };
      }
      if (exception.code === 'P2025') {
        return { status: HttpStatus.NOT_FOUND, body: { error: { code: 'NOT_FOUND', message: 'Record not found', correlationId } } };
      }
    }
    const multerCode = (exception as { code?: string } | null)?.code;
    if (multerCode === 'LIMIT_FILE_SIZE') {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded file is too large', correlationId } },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', correlationId } },
    };
  }
}
