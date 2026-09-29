"use client";

import { useState } from "react";
import { ADMIN_DIVISIONS, divisionForLabel } from "@/constants/adminNav";

// 어드민 공통 사이드바 — 상단 드롭다운으로 Golf / Snack Bar & Retail / Indoor Golf Simulator 전환
export default function AdminSidebar({ active }: { active: string }) {
  const [divisionKey, setDivisionKey] = useState(() => divisionForLabel(active).key);
  const [open, setOpen] = useState(false);
  const division = ADMIN_DIVISIONS.find((d) => d.key === divisionKey) ?? ADMIN_DIVISIONS[0];

  return (
    <aside className="hidden bg-[#111315] text-white lg:block">
      <div className="border-b border-white/10 px-4 py-4 text-sm font-bold">lightspeed</div>

      <div className="relative border-b border-white/10 px-2 py-2">
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex w-full items-center justify-between gap-1 rounded px-3 py-2 text-left text-xs font-bold hover:bg-white/10"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="truncate">{division.label}</span>
          <span className="text-[10px]">{open ? "▴" : "▾"}</span>
        </button>
        {open && (
          <ul className="absolute left-2 right-2 z-30 mt-1 grid gap-0.5 rounded bg-[#1f2328] p-1 text-xs shadow-lg" role="listbox">
            {ADMIN_DIVISIONS.map((d) => (
              <li key={d.key}>
                <button
                  aria-selected={d.key === divisionKey}
                  className={`w-full rounded px-3 py-2 text-left font-semibold ${d.key === divisionKey ? "bg-[#4533ff]" : "hover:bg-white/10"}`}
                  onClick={() => {
                    setDivisionKey(d.key);
                    setOpen(false);
                  }}
                  role="option"
                >
                  {d.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <nav className="grid gap-1 px-2 py-3 text-xs">
        {division.links.map(({ label, href }) => (
          <a
            className={`px-3 py-2 font-semibold ${label === active ? "bg-[#4533ff]" : "hover:bg-white/10"}`}
            href={href}
            key={`${label}-${href}`}
          >
            {label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
