"use client";

import { useMemo, useState } from "react";

type DayRate = {
  day: string;
  enabled: boolean;
  nineHole: number;
  eighteenHole: number;
  cart: number;
};

const menuItems = [
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

const initialRates: DayRate[] = [
  { day: "Monday", enabled: true, nineHole: 34, eighteenHole: 58.41, cart: 18 },
  { day: "Tuesday", enabled: true, nineHole: 34, eighteenHole: 47.79, cart: 18 },
  { day: "Wednesday", enabled: true, nineHole: 34, eighteenHole: 47.79, cart: 18 },
  { day: "Thursday", enabled: true, nineHole: 34, eighteenHole: 47.79, cart: 18 },
  { day: "Friday", enabled: true, nineHole: 39, eighteenHole: 64, cart: 20 },
  { day: "Saturday", enabled: true, nineHole: 42, eighteenHole: 72, cart: 22 },
  { day: "Sunday", enabled: true, nineHole: 42, eighteenHole: 72, cart: 22 },
];

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function minutesFromTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinutes(total: number) {
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export default function PricingPage() {
  const [openTime, setOpenTime] = useState("06:40");
  const [closeTime, setCloseTime] = useState("18:58");
  const [interval, setInterval] = useState(9);
  const [defaultNineHole, setDefaultNineHole] = useState(34);
  const [defaultEighteenHole, setDefaultEighteenHole] = useState(47.79);
  const [defaultCart, setDefaultCart] = useState(18);
  const [rates, setRates] = useState<DayRate[]>(initialRates);
  const [previewDay, setPreviewDay] = useState("Thursday");
  const [holes, setHoles] = useState<9 | 18>(18);

  const selectedRate = rates.find((rate) => rate.day === previewDay) ?? rates[0];
  const previewTimes = useMemo(() => {
    const start = minutesFromTime(openTime);
    const end = minutesFromTime(closeTime);
    if (end <= start || interval <= 0) return [];

    const slots: string[] = [];
    for (let time = start; time <= end && slots.length < 64; time += interval) {
      slots.push(formatMinutes(time));
    }
    return slots;
  }, [closeTime, interval, openTime]);

  function updateRate(day: string, patch: Partial<DayRate>) {
    setRates((current) => current.map((rate) => (rate.day === day ? { ...rate, ...patch } : rate)));
  }

  function applyDefaults() {
    setRates((current) =>
      current.map((rate) => ({
        ...rate,
        nineHole: defaultNineHole,
        eighteenHole: defaultEighteenHole,
        cart: defaultCart,
      })),
    );
  }

  const previewPrice = holes === 18 ? selectedRate.eighteenHole : selectedRate.nineHole;
  const dailyCapacity = previewTimes.length * 4;
  const potentialGreenFee = previewTimes.length * 4 * previewPrice;

  return (
    <main className="min-h-screen bg-[#f2f2f4] text-[#1f2328]">
      <div className="grid min-h-screen lg:grid-cols-[148px_1fr]">
        <aside className="hidden bg-[#111315] text-white lg:block">
          <div className="border-b border-white/10 px-4 py-4 text-sm font-bold">lightspeed</div>
          <nav className="grid gap-1 px-2 py-3 text-xs">
            {menuItems.map(([item, href]) => (
              <a
                className={`px-3 py-2 font-semibold ${
                  item === "Tee Times & Pricing" ? "bg-[#4533ff]" : "hover:bg-white/10"
                }`}
                href={href}
                key={item}
              >
                {item}
              </a>
            ))}
          </nav>
          <div className="mx-3 mt-4 bg-[#fffbd5] p-3 text-[11px] leading-5 text-[#2f2f21]">
            <p className="font-bold">Note</p>
            <p>John&apos;s Mobile #: 905-512-8755</p>
            <p>Login: Chronogolf</p>
            <p>Course: Pelham Hills</p>
          </div>
        </aside>

        <section className="grid min-w-0 grid-rows-[auto_auto_1fr]">
          <header className="flex items-center justify-between border-b border-[#d4d4d8] bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <button className="text-xl text-[#6b7280]">☰</button>
              <a className="text-sm font-bold" href="/admin">
                Tee Times & Pricing
              </a>
            </div>
            <div className="flex items-center gap-2">
              <a className="border border-[#d7d7dc] px-3 py-1.5 text-xs font-bold" href="/admin">
                Tee Sheet
              </a>
              <button className="bg-[#4533ff] px-4 py-1.5 text-xs font-bold text-white">Save</button>
            </div>
          </header>

          <section className="border-b border-[#d4d4d8] bg-white px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded bg-[#111315] px-2 py-1 text-white">Pricing Setup</span>
                <span>{previewTimes.length} Tee Times</span>
                <span>{dailyCapacity} Player Capacity</span>
                <span>{money(potentialGreenFee)} Green Fee Potential</span>
              </div>
              <div className="text-center">
                <p className="text-3xl font-semibold leading-none">{interval}</p>
                <p className="text-xs font-semibold">Minute Tee Interval</p>
              </div>
              <div className="flex gap-2">
                <button className="border bg-white px-3 py-1.5 text-xs font-bold" onClick={applyDefaults}>
                  Apply Defaults
                </button>
                <button className="bg-[#4533ff] px-3 py-1.5 text-xs font-bold text-white">Publish Rates</button>
              </div>
            </div>
          </section>

          <section className="min-w-0 overflow-auto p-4">
            <div className="grid gap-4 xl:grid-cols-[330px_1fr_320px]">
              <section className="border border-[#d6d6dc] bg-white">
                <div className="border-b border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">
                  Operating Hours
                </div>
                <div className="grid gap-3 p-3 text-xs">
                  <label className="grid gap-1 font-semibold">
                    Opening Time
                    <input
                      className="border border-[#cfd2d8] px-2 py-2 font-normal"
                      onChange={(event) => setOpenTime(event.target.value)}
                      type="time"
                      value={openTime}
                    />
                  </label>
                  <label className="grid gap-1 font-semibold">
                    Closing Time
                    <input
                      className="border border-[#cfd2d8] px-2 py-2 font-normal"
                      onChange={(event) => setCloseTime(event.target.value)}
                      type="time"
                      value={closeTime}
                    />
                  </label>
                  <label className="grid gap-1 font-semibold">
                    Tee Interval
                    <select
                      className="border border-[#cfd2d8] px-2 py-2 font-normal"
                      onChange={(event) => setInterval(Number(event.target.value))}
                      value={interval}
                    >
                      {[7, 8, 9, 10, 12, 15].map((value) => (
                        <option key={value} value={value}>
                          {value} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="border-y border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">
                  Default Rates
                </div>
                <div className="grid gap-3 p-3 text-xs">
                  <label className="grid gap-1 font-semibold">
                    9 Holes
                    <input
                      className="border border-[#cfd2d8] px-2 py-2 font-normal"
                      min="0"
                      onChange={(event) => setDefaultNineHole(Number(event.target.value))}
                      step="0.01"
                      type="number"
                      value={defaultNineHole}
                    />
                  </label>
                  <label className="grid gap-1 font-semibold">
                    18 Holes
                    <input
                      className="border border-[#cfd2d8] px-2 py-2 font-normal"
                      min="0"
                      onChange={(event) => setDefaultEighteenHole(Number(event.target.value))}
                      step="0.01"
                      type="number"
                      value={defaultEighteenHole}
                    />
                  </label>
                  <label className="grid gap-1 font-semibold">
                    Cart Fee
                    <input
                      className="border border-[#cfd2d8] px-2 py-2 font-normal"
                      min="0"
                      onChange={(event) => setDefaultCart(Number(event.target.value))}
                      step="0.01"
                      type="number"
                      value={defaultCart}
                    />
                  </label>
                </div>
              </section>

              <section className="min-w-[620px] border border-[#d6d6dc] bg-white">
                <div className="grid grid-cols-[120px_90px_repeat(3,1fr)] border-b border-[#d6d6dc] bg-[#d7d5da] text-xs font-bold">
                  <div className="p-2">Day</div>
                  <div className="p-2 text-center">Open</div>
                  <div className="p-2 text-right">9 Holes</div>
                  <div className="p-2 text-right">18 Holes</div>
                  <div className="p-2 text-right">Cart</div>
                </div>
                {rates.map((rate) => (
                  <div
                    className="grid grid-cols-[120px_90px_repeat(3,1fr)] items-center border-b border-[#ececf0] text-xs last:border-b-0"
                    key={rate.day}
                  >
                    <button
                      className={`p-2 text-left font-bold ${previewDay === rate.day ? "bg-[#4533ff] text-white" : ""}`}
                      onClick={() => setPreviewDay(rate.day)}
                    >
                      {rate.day}
                    </button>
                    <label className="flex justify-center p-2">
                      <input
                        checked={rate.enabled}
                        onChange={(event) => updateRate(rate.day, { enabled: event.target.checked })}
                        type="checkbox"
                      />
                    </label>
                    <div className="p-2">
                      <input
                        className="w-full border border-[#cfd2d8] px-2 py-1 text-right"
                        min="0"
                        onChange={(event) => updateRate(rate.day, { nineHole: Number(event.target.value) })}
                        step="0.01"
                        type="number"
                        value={rate.nineHole}
                      />
                    </div>
                    <div className="p-2">
                      <input
                        className="w-full border border-[#cfd2d8] px-2 py-1 text-right"
                        min="0"
                        onChange={(event) => updateRate(rate.day, { eighteenHole: Number(event.target.value) })}
                        step="0.01"
                        type="number"
                        value={rate.eighteenHole}
                      />
                    </div>
                    <div className="p-2">
                      <input
                        className="w-full border border-[#cfd2d8] px-2 py-1 text-right"
                        min="0"
                        onChange={(event) => updateRate(rate.day, { cart: Number(event.target.value) })}
                        step="0.01"
                        type="number"
                        value={rate.cart}
                      />
                    </div>
                  </div>
                ))}
              </section>

              <section className="border border-[#d6d6dc] bg-white">
                <div className="border-b border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">
                  Generated Tee Time Preview
                </div>
                <div className="grid gap-3 p-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 font-semibold">
                      Day
                      <select
                        className="border border-[#cfd2d8] px-2 py-2 font-normal"
                        onChange={(event) => setPreviewDay(event.target.value)}
                        value={previewDay}
                      >
                        {rates.map((rate) => (
                          <option key={rate.day} value={rate.day}>
                            {rate.day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 font-semibold">
                      Holes
                      <select
                        className="border border-[#cfd2d8] px-2 py-2 font-normal"
                        onChange={(event) => setHoles(Number(event.target.value) as 9 | 18)}
                        value={holes}
                      >
                        <option value={9}>9 holes</option>
                        <option value={18}>18 holes</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-3 border border-[#ececf0] text-center">
                    <div className="border-r border-[#ececf0] p-2">
                      <p className="font-bold">{money(previewPrice)}</p>
                      <p className="text-[#6b7280]">Green Fee</p>
                    </div>
                    <div className="border-r border-[#ececf0] p-2">
                      <p className="font-bold">{money(selectedRate.cart)}</p>
                      <p className="text-[#6b7280]">Cart</p>
                    </div>
                    <div className="p-2">
                      <p className="font-bold">{selectedRate.enabled ? "Open" : "Closed"}</p>
                      <p className="text-[#6b7280]">Status</p>
                    </div>
                  </div>

                  <div className="max-h-[480px] overflow-auto border border-[#d6d6dc]">
                    <div className="grid grid-cols-[74px_1fr_64px] bg-[#d7d5da] text-xs font-bold">
                      <div className="p-2">Time</div>
                      <div className="p-2">Rate</div>
                      <div className="p-2 text-center">Cart</div>
                    </div>
                    {selectedRate.enabled && previewTimes.length > 0 ? (
                      previewTimes.map((time, index) => (
                        <div className="grid grid-cols-[74px_1fr_64px] border-t border-[#ececf0]" key={time}>
                          <div className="p-2 font-semibold">{time}</div>
                          <div className="p-2">
                            <span className={index < 8 ? "text-[#0034c9]" : index > previewTimes.length - 8 ? "text-[#9e2f20]" : ""}>
                              {money(previewPrice)}
                            </span>
                          </div>
                          <div className="p-2 text-center">{money(selectedRate.cart)}</div>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-[#6b7280]">No tee times generated for this day.</div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
