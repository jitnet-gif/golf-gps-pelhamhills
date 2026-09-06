/**
 * Supabase 클라이언트 설정
 * 파일: frontend/lib/supabase.ts
 * 작성일: 2026-03-14 23:55
 *
 * Supabase는 두 가지 클라이언트가 필요합니다:
 * 1. 브라우저(클라이언트) 용 - 사용자가 직접 사용
 * 2. 서버 용 - API Route에서 사용 (더 높은 권한)
 */

import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// ============================================================
// 1. 브라우저 클라이언트 (컴포넌트에서 사용)
//    React 컴포넌트 안에서 Supabase에 접근할 때 사용
// ============================================================
export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,   // ! = "이 값은 반드시 있다"고 TypeScript에 알림
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
}

// ============================================================
// 2. 서버 클라이언트 (API Route, Server Component에서 사용)
//    쿠키를 직접 다루기 때문에 서버에서만 실행 가능
// ============================================================
export async function createServerSupabaseClient() {
    const cookieStore = await cookies()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                // 쿠키 읽기
                getAll() {
                    return cookieStore.getAll()
                },
                // 쿠키 쓰기 (Server Component에서는 불가, Route Handler에서 가능)
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // Server Component에서 setAll 호출 시 무시 (정상 동작)
                    }
                },
            },
        }
    )
}
