/**
 * 통일된 에러 핸들링 미들웨어
 * src/middleware/errorHandler.ts
 */

import { Context } from 'hono'
import type { Env } from '../types/env'

export interface ErrorResponse {
  error: string
  code: string
  message: string
  status: number
  details?: Record<string, unknown>
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public status: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found') {
    super('NOT_FOUND', message, 404)
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, details)
    this.name = 'ConflictError'
  }
}

export function errorHandler(env: Env) {
  return async (err: Error, c: Context<{ Bindings: Env }>) => {
    const isDev = env.ENVIRONMENT === 'development'

    let errorResponse: ErrorResponse

    if (err instanceof ApiError) {
      errorResponse = {
        error: err.name,
        code: err.code,
        message: err.message,
        status: err.status,
        ...(isDev && err.details && { details: err.details }),
      }
    } else if (err instanceof SyntaxError && err.message.includes('JSON')) {
      errorResponse = {
        error: 'ValidationError',
        code: 'INVALID_JSON',
        message: 'Invalid JSON in request body',
        status: 400,
      }
    } else {
      // 예상 밖의 에러
      errorResponse = {
        error: 'InternalServerError',
        code: 'INTERNAL_ERROR',
        message: isDev ? err.message : 'Internal server error',
        status: 500,
      }

      // 프로덕션에서는 에러를 로깅 (실제로는 Workers Analytics Engine 등 사용)
      if (!isDev) {
        console.error('[ERROR]', err)
      }
    }

    return c.json(errorResponse, { status: errorResponse.status as const })
  }
}
