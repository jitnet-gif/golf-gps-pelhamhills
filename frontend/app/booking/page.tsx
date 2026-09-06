"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type WantedKind = "one_shot" | "recurring";
type WantedStatus = "pending" | "booked" | "expired" | "disabled";
type Outcome = "booked" | "no_slots" | "auth_failed" | "upstream_error" | "booking_failed";

type Attempt = {
  ts: string;
  target_date: string;
  outcome: Outcome;
  booking_id?: string | null;
  error?: string | null;
};

type WantedSlot = {
  id: string;
  kind: WantedKind;
  target_date: string | null;
  day_of_week: number | null;
  end_date: string | null;
  start_time: string;
  end_time: string;
  num_slots: number;
  partners: string[];
  notify: string | null;
  status: WantedStatus;
  attempts: Attempt[];
  created_at: string;
  updated_at: string;
};

type FormState = {
  kind: WantedKind;
  target_date: string;
  day_of_week: string;
  end_date: string;
  start_time: string;
  end_time: string;
  num_slots: string;
  partners: string;
  notify: string;
};

const storageKey = "pelham-hills-tee-sniper-slots";
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const initialForm: FormState = {
  kind: "one_shot",
  target_date: new Date().toISOString().slice(0, 10),
  day_of_week: "5",
  end_date: "",
  start_time: "07:00",
  end_time: "10:30",
  num_slots: "4",
  partners: "",
  notify: "",
};

const demoSlots: WantedSlot[] = [
  {
    id: "ph-demo-early-saturday",
    kind: "recurring",
    target_date: null,
    day_of_week: 5,
    end_date: null,
    start_time: "07:00",
    end_time: "09:30",
    num_slots: 4,
    partners: ["Member guest"],
    notify: "+19057356768",
    status: "pending",
    attempts: [
      {
        ts: new Date().toISOString(),
        target_date: new Date().toISOString().slice(0, 10),
        outcome: "no_slots",
        error: "No matching Pelham Hills tee times found in the requested window.",
      },
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slot-${Date.now()}`;
}

function statusClasses(status: WantedStatus) {
  if (status === "booked") return "bg-[#dff1d7] text-[#214d2f]";
  if (status === "disabled") return "bg-[#ece5d8] text-[#6e6254]";
  if (status === "expired") return "bg-[#f2dccf] text-[#8a3f26]";
  return "bg-[#e8eddc] text-[#52602e]";
}

function describeSlot(slot: WantedSlot) {
  if (slot.kind === "one_shot") return slot.target_date ?? "One-shot";
  const day = weekdays[slot.day_of_week ?? 0] ?? "Recurring";
  return slot.end_date ? `${day} until ${slot.end_date}` : `Every ${day}`;
}

function readSlots(): WantedSlot[] {
  if (typeof window === "undefined") return demoSlots;
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return demoSlots;
  try {
    return JSON.parse(saved) as WantedSlot[];
  } catch {
    return demoSlots;
  }
}

export default function BookingPage() {
  const [slots, setSlots] = useState<WantedSlot[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [filter, setFilter] = useState<"all" | WantedStatus>("all");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSlots(readSlots());
  }, []);

  useEffect(() => {
    if (slots.length) {
      window.localStorage.setItem(storageKey, JSON.stringify(slots));
    }
  }, [slots]);

  const filteredSlots = useMemo(
    () => slots.filter((slot) => (filter === "all" ? true : slot.status === filter)),
    [filter, slots],
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submitWantedSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (form.end_time <= form.start_time) {
      setMessage("End time must be after start time.");
      return;
    }

    const now = new Date().toISOString();
    const slot: WantedSlot = {
      id: makeId(),
      kind: form.kind,
      target_date: form.kind === "one_shot" ? form.target_date : null,
      day_of_week: form.kind === "recurring" ? Number(form.day_of_week) : null,
      end_date: form.kind === "recurring" && form.end_date ? form.end_date : null,
      start_time: form.start_time,
      end_time: form.end_time,
      num_slots: Number(form.num_slots),
      partners: form.partners
        .split(",")
        .map((partner) => partner.trim())
        .filter(Boolean)
        .slice(0, 3),
      notify: form.notify.trim() || null,
      status: "pending",
      attempts: [],
      created_at: now,
      updated_at: now,
    };

    setSlots((current) => [slot, ...current]);
    setForm(initialForm);
    setMessage("Wanted tee-time request created.");
  }

  function markBooked(slotId: string) {
    const now = new Date().toISOString();
    setSlots((current) =>
      current.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              status: "booked",
              updated_at: now,
              attempts: [
                {
                  ts: now,
                  target_date: slot.target_date ?? new Date().toISOString().slice(0, 10),
                  outcome: "booked",
                  booking_id: `PH-${Math.floor(100000 + Math.random() * 900000)}`,
                },
                ...slot.attempts,
              ],
            }
          : slot,
      ),
    );
  }

  function toggleDisabled(slotId: string) {
    const now = new Date().toISOString();
    setSlots((current) =>
      current.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              status: slot.status === "disabled" ? "pending" : "disabled",
              updated_at: now,
            }
          : slot,
      ),
    );
  }

  function removeSlot(slotId: string) {
    setSlots((current) => current.filter((slot) => slot.id !== slotId));
  }

  return (
    <main className="min-h-screen bg-[#f7f4ed] text-[#182118]">
      <header className="border-b border-[#d8d1c3] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
          <a className="font-serif text-xl font-semibold tracking-[0.08em]" href="/">
            Pelham Hills
          </a>
          <div className="flex gap-5 text-sm font-bold uppercase tracking-[0.14em] text-[#214d2f]">
            <a href="/admin">Admin</a>
            <a href="/">Home</a>
          </div>
        </div>
      </header>

      <section className="bg-[#214d2f] px-5 py-14 text-white lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#d6c28f]">
            Tee-Sniper Booking
          </p>
          <h1 className="mt-4 max-w-4xl font-serif text-5xl font-semibold leading-tight">
            Create and monitor wanted tee-time requests.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-[#edf4ec]">
            This Pelham Hills booking workspace ports the Tee-Sniper wanted-slot workflow into the
            site: one-shot dates, recurring days, time windows, players, partners, notifications,
            status control, and attempt history.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-10 lg:grid-cols-[420px_1fr] lg:px-8">
        <form className="rounded-sm border border-[#d8d1c3] bg-white p-5" onSubmit={submitWantedSlot}>
          <h2 className="font-serif text-3xl font-semibold">New Wanted Slot</h2>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-[#465444]">
              Request Type
              <select
                className="border border-[#cfc6b5] bg-white px-3 py-3 text-[#182118]"
                value={form.kind}
                onChange={(event) => updateField("kind", event.target.value as WantedKind)}
              >
                <option value="one_shot">One-shot date</option>
                <option value="recurring">Recurring weekday</option>
              </select>
            </label>

            {form.kind === "one_shot" ? (
              <label className="grid gap-2 text-sm font-bold text-[#465444]">
                Target Date
                <input
                  className="border border-[#cfc6b5] px-3 py-3 text-[#182118]"
                  type="date"
                  value={form.target_date}
                  onChange={(event) => updateField("target_date", event.target.value)}
                  required
                />
              </label>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-bold text-[#465444]">
                  Weekday
                  <select
                    className="border border-[#cfc6b5] bg-white px-3 py-3 text-[#182118]"
                    value={form.day_of_week}
                    onChange={(event) => updateField("day_of_week", event.target.value)}
                  >
                    {weekdays.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-bold text-[#465444]">
                  End Date
                  <input
                    className="border border-[#cfc6b5] px-3 py-3 text-[#182118]"
                    type="date"
                    value={form.end_date}
                    onChange={(event) => updateField("end_date", event.target.value)}
                  />
                </label>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-[#465444]">
                Start Time
                <input
                  className="border border-[#cfc6b5] px-3 py-3 text-[#182118]"
                  type="time"
                  value={form.start_time}
                  onChange={(event) => updateField("start_time", event.target.value)}
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-[#465444]">
                End Time
                <input
                  className="border border-[#cfc6b5] px-3 py-3 text-[#182118]"
                  type="time"
                  value={form.end_time}
                  onChange={(event) => updateField("end_time", event.target.value)}
                  required
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm font-bold text-[#465444]">
              Players
              <input
                className="border border-[#cfc6b5] px-3 py-3 text-[#182118]"
                max={4}
                min={1}
                type="number"
                value={form.num_slots}
                onChange={(event) => updateField("num_slots", event.target.value)}
                required
              />
            </label>

            <label className="grid gap-2 text-sm font-bold text-[#465444]">
              Partners
              <input
                className="border border-[#cfc6b5] px-3 py-3 text-[#182118]"
                placeholder="Name, Name, Name"
                value={form.partners}
                onChange={(event) => updateField("partners", event.target.value)}
              />
            </label>

            <label className="grid gap-2 text-sm font-bold text-[#465444]">
              SMS Notification
              <input
                className="border border-[#cfc6b5] px-3 py-3 text-[#182118]"
                placeholder="+19057356768"
                value={form.notify}
                onChange={(event) => updateField("notify", event.target.value)}
              />
            </label>

            {message && <p className="bg-[#eef1e8] px-3 py-2 text-sm font-semibold text-[#214d2f]">{message}</p>}

            <button className="bg-[#214d2f] px-5 py-3 text-sm font-extrabold uppercase tracking-[0.12em] text-white">
              Create Wanted Slot
            </button>
          </div>
        </form>

        <div>
          <div className="flex flex-col gap-4 border-b border-[#d8d1c3] pb-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8a6f30]">Requests</p>
              <h2 className="mt-2 font-serif text-3xl font-semibold">Wanted Tee-Times</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["all", "pending", "booked", "disabled", "expired"] as const).map((item) => (
                <button
                  className={`border px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] ${
                    filter === item
                      ? "border-[#214d2f] bg-[#214d2f] text-white"
                      : "border-[#cfc6b5] bg-white text-[#214d2f]"
                  }`}
                  key={item}
                  onClick={() => setFilter(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            {filteredSlots.length === 0 && (
              <p className="rounded-sm border border-[#d8d1c3] bg-white p-5 text-[#516050]">
                No wanted tee-times match this filter.
              </p>
            )}

            {filteredSlots.map((slot) => (
              <article className="rounded-sm border border-[#d8d1c3] bg-white p-5" key={slot.id}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-1 text-xs font-extrabold uppercase tracking-[0.12em] ${statusClasses(slot.status)}`}>
                        {slot.status}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a6f30]">
                        {slot.kind.replace("_", " ")}
                      </span>
                    </div>
                    <h3 className="mt-3 font-serif text-2xl font-semibold">{describeSlot(slot)}</h3>
                    <p className="mt-2 text-[#516050]">
                      {slot.start_time} - {slot.end_time} · {slot.num_slots} players
                    </p>
                    <p className="mt-1 text-sm text-[#6f7a6e]">
                      Partners: {slot.partners.length ? slot.partners.join(", ") : "None"} · SMS:{" "}
                      {slot.notify ?? "Off"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="border border-[#214d2f] px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[#214d2f]"
                      onClick={() => markBooked(slot.id)}
                    >
                      Mark Booked
                    </button>
                    <button
                      className="border border-[#cfc6b5] px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[#516050]"
                      onClick={() => toggleDisabled(slot.id)}
                    >
                      {slot.status === "disabled" ? "Enable" : "Disable"}
                    </button>
                    <button
                      className="border border-[#c47a63] px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[#8a3f26]"
                      onClick={() => removeSlot(slot.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-5 border-t border-[#d8d1c3] pt-4">
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#465444]">
                    Attempts
                  </p>
                  {slot.attempts.length === 0 ? (
                    <p className="mt-2 text-sm text-[#6f7a6e]">No worker attempts yet.</p>
                  ) : (
                    <div className="mt-3 grid gap-2">
                      {slot.attempts.map((attempt) => (
                        <div className="bg-[#fbfaf6] p-3 text-sm text-[#516050]" key={`${slot.id}-${attempt.ts}`}>
                          <strong className="text-[#182118]">{attempt.outcome}</strong> on{" "}
                          {attempt.target_date} at {new Date(attempt.ts).toLocaleString()}
                          {attempt.booking_id ? ` · booking ${attempt.booking_id}` : ""}
                          {attempt.error ? ` · ${attempt.error}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
