/**
 * 손님 예약 화면(/book/tee-time, /book/indoor, /book/lookup)이 부르는 **유일한** 통로.
 *
 * ## 왜 FastAPI 가 아니라 Supabase 함수인가
 * 예약 API(`pelhamhills-api.fly.dev`)는 2026-09-16 Fly.io 체험 종료로 꺼졌다. 이 사이트는
 * 정적 export 라 비밀 키를 들 곳이 없어서, 브라우저가 공개(publishable) 키로
 * `supabase/migrations/0003_public_booking.sql` 의 `pelham_*` 함수만 직접 부른다.
 * 테이블은 공개 키로 읽히지 않는다 — 손님이 받는 것은 함수가 돌려주는 것뿐이다.
 *
 * ## 공개 키를 코드에 두는 이유
 * publishable 키는 브라우저에 실리라고 만든 값이다(GPS 앱 번들에도 들어 있다). 환경변수로만
 * 두면 로컬 `.env.local` 없이 `vercel --prod` 를 돌린 날 예약이 조용히 꺼진다 —
 * `lib/apiHost.ts` 가 막으려던 것과 같은 사고다. 그래서 환경변수가 있으면 그걸, 없으면
 * 이 값을 쓴다.
 *
 * 오류는 티 시트 래퍼와 같은 `ApiError` 로 올린다. `describeFailure` 가 status 0(연결 실패)
 * 과 409(자리가 나갔다)를 이미 구분해 읽는다. SQL 쪽은 `PT409` 같은 SQLSTATE 로 올리고,
 * PostgREST 가 그 숫자를 HTTP 상태로 쓴다.
 */

import { ApiError } from "@/lib/teeSheet/api";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yxpiwwgquyaxjubovzmi.supabase.co"
).replace(/\/+$/, "");

const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_oMJG_-xpWr6AI5o3KnrU_A_kJENaKSY";

/** 이 사이트에서 온라인 예약을 열 수 있는가. */
export function bookingConfigured(): boolean {
  return Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
}

export async function bookingRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch {
    // fetch 의 원문 메시지에는 요청 주소가 섞일 수 있다. 화면에 내보내지 않는다.
    throw new ApiError(0, "Network error");
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim();
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body?.message === "string" && body.message) message = body.message;
    } catch {
      // JSON 이 아닌 오류 본문(게이트웨이 HTML 등). 상태 줄을 그대로 쓴다.
    }
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}
