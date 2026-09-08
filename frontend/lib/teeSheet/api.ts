// The one tee sheet API client. Do not add a second fetch wrapper elsewhere.
// Base URL comes from NEXT_PUBLIC_API_BASE_URL (Next.js convention) and must
// include the version prefix, e.g. "http://localhost:8000/api/v1".
// 주소 해석 자체는 `lib/apiHost.ts` 가 맡는다 — 배포된 사이트에 localhost 가
// 굳어 나가는 사고를 한 군데서 막기 위해서다.

import type {
  AddPlayerInput,
  CreateBookingInput,
  DailyReport,
  OrchestrationStatus,
  PatchBookingInput,
  PatchPlayerInput,
  SlotsResponse,
  TaskAck,
  TeeBooking,
  WeekReport,
} from "./types";

// `NEXT_PUBLIC_API_BASE_URL` wins; otherwise the versioned path is derived from the
// host-only `NEXT_PUBLIC_API_URL` that the rest of the app already sets. 값을 모듈
// 상수로 굳히지 않는다 — 정적 export 는 서버에서 한 번, 브라우저에서 다시
// 평가되는데 "쓸 수 있는 주소인가" 는 브라우저에서만 판단할 수 있다.
import { apiBaseUrl } from "../apiHost";

export { apiBaseUrl };

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBaseUrl();
  // 주소가 없으면 요청을 흉내내지 않는다. status 0 은 `useTeeSheet` 가 이미
  // "offline" 으로 읽는 값이라, 티 시트는 그대로 로컬 모드로 넘어간다.
  if (!base) {
    throw new ApiError(0, "no booking server is configured for this site");
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (cause) {
    throw new ApiError(0, cause instanceof Error ? cause.message : "Network error");
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body && typeof body === "object" && "detail" in body) {
        const value = (body as { detail: unknown }).detail;
        detail = typeof value === "string" ? value : JSON.stringify(value);
      }
    } catch {
      // non-JSON error body; keep the status line
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

export const teeSheetApi = {
  // ===== Slots =====
  getSlots: (date: string) => request<SlotsResponse>(`/tee-sheet/slots${query({ date })}`),

  // ===== Bookings =====
  listBookings: (range?: { from?: string; to?: string; date?: string }) =>
    request<TeeBooking[]>(`/tee-sheet/bookings${query({ ...range })}`),

  getBooking: (id: string) => request<TeeBooking>(`/tee-sheet/bookings/${id}`),

  createBooking: (input: CreateBookingInput) =>
    request<TeeBooking>("/tee-sheet/bookings", { method: "POST", body: JSON.stringify(input) }),

  patchBooking: (id: string, patch: PatchBookingInput) =>
    request<TeeBooking>(`/tee-sheet/bookings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteBooking: (id: string) =>
    request<void>(`/tee-sheet/bookings/${id}`, { method: "DELETE" }),

  // ===== Players =====
  addPlayer: (bookingId: string, input: AddPlayerInput) =>
    request<TeeBooking>(`/tee-sheet/bookings/${bookingId}/players`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  patchPlayer: (bookingId: string, playerId: string, patch: PatchPlayerInput) =>
    request<TeeBooking>(`/tee-sheet/bookings/${bookingId}/players/${playerId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  removePlayer: (bookingId: string, playerId: string) =>
    request<TeeBooking>(`/tee-sheet/bookings/${bookingId}/players/${playerId}`, {
      method: "DELETE",
    }),

  // ===== Reports =====
  getDailyReport: (date: string) =>
    request<DailyReport>(`/tee-sheet/reports/daily${query({ date })}`),

  getWeekReport: (from: string, to: string) =>
    request<WeekReport>(`/tee-sheet/reports/week${query({ from, to })}`),

  // ===== Orchestration =====
  getOrchestrationStatus: () =>
    request<OrchestrationStatus>("/tee-sheet/orchestration/status"),

  runDailyBatch: (date: string) =>
    request<TaskAck>(`/tee-sheet/orchestration/daily-batch${query({ date })}`, { method: "POST" }),

  sendReminders: (date: string) =>
    request<TaskAck>(`/tee-sheet/orchestration/send-reminders${query({ date })}`, { method: "POST" }),

  runCleanup: (before?: string) =>
    request<TaskAck>(`/tee-sheet/orchestration/cleanup${query({ before })}`, { method: "POST" }),

  runWorker: (date?: string) =>
    request<TaskAck>(`/tee-sheet/worker/run${query({ date })}`, { method: "POST" }),
};

export default teeSheetApi;
