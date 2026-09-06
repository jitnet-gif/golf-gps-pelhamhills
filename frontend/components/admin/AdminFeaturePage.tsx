"use client";

import { useState } from "react";

type Metric = {
  label: string;
  value: string;
};

type Row = {
  name: string;
  detail: string;
  status: string;
};

const links = [
  ["Pelham Hills Golf Club", "/"],
  ["Tee Sheet", "/admin"],
  ["Tee Times & Pricing", "/pricing"],
  ["Dynamic Pricing", "/dynamic-pricing"],
  ["Events", "/events"],
  ["Customers", "/customers"],
  ["Tour Operators", "/tour-operators"],
  ["Promotions", "/promotions"],
  ["Reports", "/reports"],
  ["Business Intelligence", "/business-intelligence"],
  ["Radar", "/radar"],
  ["Integrations", "/integrations"],
  ["Settings", "/settings"],
];

export default function AdminFeaturePage({
  active,
  title,
  description,
  metrics,
  rows,
  actionLabel,
}: {
  active: string;
  title: string;
  description: string;
  metrics: Metric[];
  rows: Row[];
  actionLabel: string;
}) {
  const [items, setItems] = useState(rows);
  const [saved, setSaved] = useState("Ready");

  function addItem() {
    const next = {
      name: `${active} Item ${items.length + 1}`,
      detail: "Draft operational record",
      status: "Draft",
    };
    setItems((current) => [next, ...current]);
    setSaved("Draft added locally");
  }

  function toggleStatus(index: number) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, status: item.status === "Active" ? "Paused" : "Active" }
          : item,
      ),
    );
    setSaved("Status updated locally");
  }

  return (
    <main className="min-h-screen bg-[#f2f2f4] text-[#1f2328]">
      <div className="grid min-h-screen lg:grid-cols-[148px_1fr]">
        <aside className="hidden bg-[#111315] text-white lg:block">
          <div className="border-b border-white/10 px-4 py-4 text-sm font-bold">lightspeed</div>
          <nav className="grid gap-1 px-2 py-3 text-xs">
            {links.map(([label, href]) => (
              <a
                className={`px-3 py-2 font-semibold ${label === active ? "bg-[#4533ff]" : "hover:bg-white/10"}`}
                href={href}
                key={label}
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <section className="min-w-0">
          <header className="flex items-center justify-between border-b border-[#d4d4d8] bg-white px-4 py-3">
            <div>
              <p className="text-xs font-bold text-[#6b7280]">Pelham Hills Golf Club</p>
              <h1 className="text-sm font-bold">{title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#6b7280]">{saved}</span>
              <button className="bg-[#4533ff] px-4 py-1.5 text-xs font-bold text-white" onClick={addItem}>
                {actionLabel}
              </button>
            </div>
          </header>

          <section className="border-b border-[#d4d4d8] bg-white px-4 py-4">
            <p className="max-w-4xl text-sm leading-6 text-[#4e5560]">{description}</p>
          </section>

          <section className="grid gap-4 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              {metrics.map((metric) => (
                <article className="border border-[#d6d6dc] bg-white p-3" key={metric.label}>
                  <p className="text-xs font-bold uppercase text-[#6b7280]">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                </article>
              ))}
            </div>

            <section className="border border-[#d6d6dc] bg-white">
              <div className="grid grid-cols-[1fr_1.3fr_140px_120px] border-b border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">
                <span>Name</span>
                <span>Detail</span>
                <span>Status</span>
                <span className="text-right">Controls</span>
              </div>
              {items.map((item, index) => (
                <div
                  className="grid grid-cols-[1fr_1.3fr_140px_120px] items-center border-b border-[#ececf0] px-3 py-3 text-xs last:border-b-0"
                  key={`${item.name}-${index}`}
                >
                  <strong>{item.name}</strong>
                  <span className="text-[#5d6673]">{item.detail}</span>
                  <span>{item.status}</span>
                  <button
                    className="justify-self-end border border-[#cfd2d8] bg-white px-3 py-1.5 font-bold"
                    onClick={() => toggleStatus(index)}
                  >
                    Toggle
                  </button>
                </div>
              ))}
            </section>
          </section>
        </section>
      </div>
    </main>
  );
}
