/**
 * CORS 미들웨어
 * src/middleware/cors.ts
 */

import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from '../types/env'

export function createCorsMiddleware(env: Env): MiddlewareHandler<{ Bindings: Env }> {
  const isDev = env.ENVIRONMENT === 'development'

  // 개발 환경에서는 모든 오리진 허용, 프로덕션에서는 특정 도메인만
  const allowedOrigins = isDev ? '*' : [
    'https://golf-gps.example.com',
    'https://app.golf-gps.example.com',
    // 프로덕션 도메인 추가
  ]

  return cors({
    origin: allowedOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Total-Count', 'X-Page-Count'],
    credentials: true,
    maxAge: 600, // 10분
  })
}
