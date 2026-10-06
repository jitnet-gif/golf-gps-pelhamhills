/**
 * 분실물 접수대장(0013) — 프로 샵 화면이 부르는 직원 함수(0015).
 * 함수 이름과 인자는 `supabase/migrations/0015_staff_lost_items.sql` 와 글자 그대로 같다.
 *
 * 접수는 대부분 전화 비서가 한다(`report_lost_item`). 직원은 상태를 바꾸고, "found" 로
 * 바꾸면 백엔드의 1분 루프(`backend/services/lost_item_notices.py`)가 손님에게 문자를 보낸다.
 * 이 화면은 Twilio 를 직접 부르지 않는다 — 정적 사이트에는 키를 둘 곳이 없다.
 */

import { CLUB_TIME_ZONE } from "@/lib/retail/receipt";
import { ApiError } from "@/lib/teeSheet/api";
import { staffRpc } from "@/lib/teeSheet/staffRpc";

export type LostStatus = "searching" | "found" | "returned" | "closed";

export type LostItem = {
  id: string;
  /** 손님에게 읽어 준 번호. `LF-0401` 꼴. */
  ticket: string;
  item: string;
  description: string | null;
  lost_on: string | null;
  where_lost: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  status: LostStatus;
  notes: string | null;
  /** "찾았습니다" 문자를 집어 간 시각. 비어 있고 found 면 1분 안에 나간다. */
  notified_at: string | null;
  notify_status: "sent" | "queued" | "failed" | "skipped" | null;
  notify_error: string | null;
  created_at: string;
  updated_at: string;
};

export type LostItemInput = {
  item: string;
  description?: string;
  lost_on?: string;
  where_lost?: string;
  caller_name?: string;
  caller_phone?: string;
  notes?: string;
};

export type LostItemPatch = {
  status?: LostStatus;
  notes?: string;
  resend?: boolean;
};

export const lostItemsApi = {
  list: (status?: LostStatus) =>
    staffRpc<LostItem[]>("pelham_staff_lost_items", { p_status: status ?? null }),
  create: (input: LostItemInput) => staffRpc<LostItem>("pelham_staff_lost_item_create", { p: input }),
  update: (id: string, patch: LostItemPatch) =>
    staffRpc<LostItem>("pelham_staff_lost_item_update", { p_id: id, p: patch }),
};

export const LOST_STATUS_LABEL: Record<LostStatus, string> = {
  searching: "Searching",
  found: "Found",
  returned: "Returned",
  closed: "Closed",
};

/** 문자 상태를 직원이 읽을 한 줄로. found 가 아니면 null. */
export function noticeLine(row: LostItem): { text: string; tone: "ok" | "wait" | "bad" } | null {
  if (row.status !== "found" && !row.notified_at) return null;
  if (!row.caller_phone) return { text: "No phone on file — call or email the guest.", tone: "bad" };
  if (!row.notified_at) return { text: "Text goes out within a minute (8 AM – 9 PM).", tone: "wait" };
  if (row.notify_status === "failed") return { text: `Text failed: ${row.notify_error ?? "unknown error"}`, tone: "bad" };
  if (row.notify_status === "skipped") return { text: `Text not sent: ${row.notify_error ?? "skipped"}`, tone: "bad" };
  if (!row.notify_status) return { text: "Sending text…", tone: "wait" };
  return { text: `Guest texted ${clubDateTime(row.notified_at)}`, tone: "ok" };
}

/** 클럽 현지 시각으로 짧게. */
export function clubDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: CLUB_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** 화면에 띄울 한 줄. 404 는 대개 0015 를 아직 SQL Editor 에서 돌리지 않았다는 뜻이다. */
export function describeLostError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Can't reach the server. Check the connection and try again.";
    if (error.status === 404 && /function|PGRST202|schema cache/i.test(error.message)) {
      return "Lost & found database functions are missing — run migration 0015 in the Supabase SQL Editor.";
    }
    return error.message;
  }
  return (error as Error)?.message ?? "Something went wrong.";
}
