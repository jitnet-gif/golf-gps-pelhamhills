"use client";

import type { ReactNode } from "react";

import { useOverlayDismiss } from "@/components/retail/ui";

/** 오른쪽에서 나오는 계산서 서랍. Esc·바깥 누르기로 닫힌다(계산서는 열린 채 DB 에 남는다). */
export default function BillDrawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useOverlayDismiss(onClose);
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close bill" className="absolute inset-0 bg-black/40" onClick={onClose} type="button" />
      <div className="relative flex h-full w-full max-w-[420px] flex-col bg-white">
        <header className="flex items-center justify-between border-b border-[#d4d4d8] px-3 py-2.5">
          <h2 className="text-sm font-bold">Bill</h2>
          <button
            aria-label="Close bill"
            className="tap-target -mr-2 flex items-center justify-center text-xl leading-none"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden>×</span>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto pb-safe">{children}</div>
      </div>
    </div>
  );
}
