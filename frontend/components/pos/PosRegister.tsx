"use client";

import { useEffect } from "react";

import RetailWorkspace from "@/components/retail/RetailWorkspace";

/** 이 기기가 마지막으로 연 계산대. `/pos` 를 열면 여기로 바로 간다. */
export const POS_LAST_STATION = "pelham.pos.station";

export type PosStation = "snack-bar" | "pro-shop";

/** 설치형 계산대 앱의 한 계산대. 계산 로직은 어드민 계산대와 같은 `RetailWorkspace` 다. */
export default function PosRegister({ station }: { station: PosStation }) {
  useEffect(() => {
    try {
      window.localStorage.setItem(POS_LAST_STATION, station);
    } catch {
      // 사생활 보호 모드 등. 다음에 고르는 화면이 한 번 더 뜰 뿐이다.
    }
  }, [station]);

  return station === "snack-bar" ? (
    <RetailWorkspace category="Food & Beverage" posApp title="Snack Bar / Bev Cart" />
  ) : (
    <RetailWorkspace posApp title="Pro Shop" />
  );
}
