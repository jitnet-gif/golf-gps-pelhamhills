/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** 티 시트 예약 서버. **버전 접두사까지** 포함한다 (예: https://api.example.com/api/v1).
   *  Worker 를 가리키는 VITE_API_URL 과는 다른 백엔드다. 비워 두면 예약 화면은
   *  폼 대신 프로 샵 전화번호를 보여준다. */
  readonly VITE_TEE_SHEET_API_URL?: string;
  readonly VITE_TILE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** 서버의 VAPID 공개키를 빌드에 박아 두고 싶을 때만. 보통은 비워 두고
   *  GET /api/push/vapid-public-key로 받아 옵니다. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
