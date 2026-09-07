/**
 * Cloudflare Workers 환경 바인딩 타입
 * src/types/env.ts
 */

export interface Env {
  // Supabase 환경변수
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY?: string

  // API 설정
  API_VERSION: string
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
  ENVIRONMENT: 'development' | 'staging' | 'production'

  // JWT 검증 (선택사항 - Supabase가 제공하는 JWKS URL 사용 가능)
  JWT_SECRET?: string

  // R2 Object Storage (선택사항)
  PHOTOS?: R2Bucket
  TILES?: R2Bucket

  // KV Namespace (캐싱)
  CACHE?: KVNamespace

  // D1 Database (선택사항, Supabase 대신)
  DB?: D1Database
}
