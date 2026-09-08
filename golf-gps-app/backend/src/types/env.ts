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

  // 웹 푸시 VAPID 키 (Secrets에서 관리)
  // 셋 다 있어야 푸시가 켜집니다. 하나라도 없으면 /api/push/*가 503을 돌려줍니다.
  // VAPID_PUBLIC_KEY: P-256 공개키(비압축 65바이트)의 base64url
  // VAPID_PRIVATE_KEY: 같은 키쌍의 JWK d 값
  // VAPID_SUBJECT: 푸시 서비스가 문제 시 연락할 곳 (mailto: 또는 https:)
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string

  // 관리자 발송 키. POST /api/push/send의 X-Admin-Key 헤더와 비교합니다.
  ADMIN_API_KEY?: string

  // R2 Object Storage (선택사항)
  PHOTOS?: R2Bucket
  TILES?: R2Bucket

  // KV Namespace (캐싱)
  CACHE?: KVNamespace

  // D1 Database (선택사항, Supabase 대신)
  DB?: D1Database
}
