"use client";

import { useMemo, useState } from "react";

import AdminShell from "@/components/admin/AdminShell";

type PaymentRow = {
  id: string;
  time: string;
  customer: string;
  players: number;
  type: "Payment" | "Cancellation";
  amount: number;
  status: "Paid" | "Refund Due" | "Voided";
};

const hourlyOccupancy = [
  { label: "7 AM", booked: 18, capacity: 24 },
  { label: "8 AM", booked: 22, capacity: 24 },
  { label: "9 AM", booked: 24, capacity: 24 },
  { label: "10 AM", booked: 19, capacity: 24 },
  { label: "11 AM", booked: 15, capacity: 24 },
  { label: "12 PM", booked: 13, capacity: 24 },
  { label: "1 PM", booked: 17, capacity: 24 },
  { label: "2 PM", booked: 11, capacity: 24 },
];

const transactions: PaymentRow[] = [
  { id: "PAY-1048", time: "10:52 AM", customer: "Virani, Yasmin", players: 1, type: "Payment", amount: 58.41, status: "Paid" },
  { id: "PAY-1047", time: "10:34 AM", customer: "Demers, Danielle", players: 3, type: "Payment", amount: 175.23, status: "Paid" },
  { id: "CAN-221", time: "10:25 AM", customer: "Bailey, Justin", players: 2, type: "Cancellation", amount: 116.82, status: "Refund Due" },
  { id: "PAY-1046", time: "10:16 AM", customer: "Elliott, Alex", players: 2, type: "Payment", amount: 116.82, status: "Paid" },
  { id: "CAN-220", time: "9:44 AM", customer: "Stone, Marla", players: 4, type: "Cancellation", amount: 0, status: "Voided" },
];

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default function ReportsPage() {
  const [range, setRange] = useState<"today" | "week" | "month">("today");

  const kpis = useMemo(() => {
    const multiplier = range === "today" ? 1 : range === "week" ? 6.4 : 24.5;
    return [
      { label: "Revenue", value: money(8421.37 * multiplier), delta: "+12.4%", tone: "text-[#126c31]" },
      { label: "Rounds", value: Math.round(146 * multiplier).toString(), delta: "+18", tone: "text-[#126c31]" },
      { label: "Booking Rate", value: "82%", delta: "+6.1%", tone: "text-[#126c31]" },
      { label: "Cancel Rate", value: "7.5%", delta: "-1.8%", tone: "text-[#8a3f26]" },
      { label: "No-show", value: "3.1%", delta: "-0.6%", tone: "text-[#8a3f26]" },
    ];
  }, [range]);

  return (
    <AdminShell
      actions={(["today", "week", "month"] as const).map((item) => (
        <button
          className={`tap-target border px-3 py-1.5 text-xs font-bold ${range === item ? "bg-[#4533ff] text-white" : "bg-white"}`}
          key={item}
          onClick={() => setRange(item)}
          type="button"
        >
          {item.toUpperCase()}
        </button>
      ))}
      title="Reports"
    >
      <div className="min-w-0">
        <section className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {kpis.map((kpi) => (
              <article className="border border-[#d6d6dc] bg-white p-3" key={kpi.label}>
                <p className="text-xs font-bold text-[#6b7280]">{kpi.label}</p>
                <p className="mt-2 text-2xl font-semibold">{kpi.value}</p>
                <p className={`mt-1 text-xs font-bold ${kpi.tone}`}>{kpi.delta}</p>
              </article>
            ))}
          </div>

          <section className="border border-[#d6d6dc] bg-white">
            <div className="border-b border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">Hourly Occupancy</div>
            <div className="grid gap-3 p-4">
              {hourlyOccupancy.map((hour) => {
                const percent = Math.round((hour.booked / hour.capacity) * 100);
                return (
                  <div className="grid grid-cols-[54px_1fr_54px] items-center gap-3 text-xs" key={hour.label}>
                    <span className="font-bold">{hour.label}</span>
                    <div className="h-5 border border-[#d6d6dc] bg-[#f2f2f4]">
                      <div className={`h-full ${percent >= 90 ? "bg-[#0034c9]" : percent >= 70 ? "bg-[#ffd400]" : "bg-[#9da3ad]"}`} style={{ width: `${percent}%` }} />
                    </div>
                    <span className="text-right font-bold">{percent}%</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="min-w-0 border border-[#d6d6dc] bg-white">
            <div className="border-b border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">Recent Payments & Cancellations</div>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-xs">
                <thead className="bg-[#f7f7f8] text-left">
                  <tr>
                    {["ID", "Time", "Customer", "Players", "Type", "Amount", "Status"].map((heading) => (
                      <th className="border-b border-[#d6d6dc] px-3 py-2" key={heading}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((row) => (
                    <tr className="hover:bg-[#f7f7f8]" key={row.id}>
                      <td className="border-b border-[#ececf0] px-3 py-2 font-bold">{row.id}</td>
                      <td className="border-b border-[#ececf0] px-3 py-2">{row.time}</td>
                      <td className="border-b border-[#ececf0] px-3 py-2">{row.customer}</td>
                      <td className="border-b border-[#ececf0] px-3 py-2">{row.players}</td>
                      <td className="border-b border-[#ececf0] px-3 py-2">{row.type}</td>
                      <td className="border-b border-[#ececf0] px-3 py-2">{money(row.amount)}</td>
                      <td className="border-b border-[#ececf0] px-3 py-2">
                        <span className={`px-2 py-1 font-bold ${row.status === "Paid" ? "bg-[#ecfff1] text-[#168a3c]" : "bg-[#ffe5e2] text-[#9e2f20]"}`}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </AdminShell>
  );
}
