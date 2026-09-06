"use client";

import { useMemo, useState } from "react";

type CustomerStatus = "active" | "watch" | "vip" | "inactive";

type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: CustomerStatus;
  tags: string[];
  rounds: number;
  upcoming: string;
  lastBooking: string;
  noShows: number;
  spend: number;
};

const customers: Customer[] = [
  {
    id: "c-0910-01",
    name: "Marie Predote",
    phone: "",
    email: "",
    status: "active",
    tags: ["Sep 10", "Sep 11", "Member Cart"],
    rounds: 2,
    upcoming: "Sep 11 · 6:58 AM",
    lastBooking: "Sep 10 · 18 holes",
    noShows: 0,
    spend: 106.2,
  },
  {
    id: "c-0910-02",
    name: "Bryan Wheeland",
    phone: "",
    email: "",
    status: "vip",
    tags: ["Sep 10", "$47.79", "Foursome"],
    rounds: 1,
    upcoming: "Sep 10 · 7:07 AM",
    lastBooking: "Sep 10 · 18 holes",
    noShows: 0,
    spend: 47.79,
  },
  {
    id: "c-0910-03",
    name: "Dan Marshall",
    phone: "",
    email: "",
    status: "active",
    tags: ["Sep 10", "Sep 11", "Weekday Member"],
    rounds: 2,
    upcoming: "Sep 11 · 7:07 AM",
    lastBooking: "Sep 10 · 18 holes",
    noShows: 0,
    spend: 106.2,
  },
  {
    id: "c-0910-04",
    name: "Chris Nicalou",
    phone: "",
    email: "",
    status: "active",
    tags: ["Sep 10", "Sep 11", "Full Member Cart"],
    rounds: 2,
    upcoming: "Sep 11 · 7:16 AM",
    lastBooking: "Sep 10 · 18 holes",
    noShows: 0,
    spend: 106.2,
  },
  {
    id: "c-0910-05",
    name: "James Carlsson",
    phone: "",
    email: "",
    status: "active",
    tags: ["Sep 10", "$47.79", "Guests x2"],
    rounds: 1,
    upcoming: "Sep 10 · 8:01 AM",
    lastBooking: "Sep 10 · 18 holes",
    noShows: 0,
    spend: 47.79,
  },
  {
    id: "c-0910-06",
    name: "Rick Costea",
    phone: "",
    email: "",
    status: "active",
    tags: ["Sep 10", "Sep 11", "Cart x2"],
    rounds: 2,
    upcoming: "Sep 11 · 8:10 AM",
    lastBooking: "Sep 10 · 18 holes",
    noShows: 0,
    spend: 106.2,
  },
  {
    id: "c-0911-01",
    name: "Marty Kicul",
    phone: "",
    email: "",
    status: "active",
    tags: ["Sep 11", "$58.41", "Weekday Member"],
    rounds: 1,
    upcoming: "Sep 11 · 7:25 AM",
    lastBooking: "Sep 11 · 18 holes",
    noShows: 0,
    spend: 58.41,
  },
  {
    id: "c-0911-02",
    name: "Jami Buckley",
    phone: "",
    email: "",
    status: "watch",
    tags: ["Sep 11", "$58.41", "Public", "Guests x3"],
    rounds: 1,
    upcoming: "Sep 11 · 7:34 AM",
    lastBooking: "Sep 11 · 18 holes",
    noShows: 0,
    spend: 58.41,
  },
  {
    id: "c-0911-03",
    name: "Ruth Unrau",
    phone: "",
    email: "",
    status: "active",
    tags: ["Sep 11", "$58.41", "Public Senior"],
    rounds: 1,
    upcoming: "Sep 11 · 7:43 AM",
    lastBooking: "Sep 11 · 18 holes",
    noShows: 0,
    spend: 58.41,
  },
];

function statusClass(status: CustomerStatus) {
  if (status === "vip") return "bg-[#4533ff] text-white";
  if (status === "watch") return "bg-[#ffd400] text-[#1d232b]";
  if (status === "inactive") return "bg-[#ececf0] text-[#4e5560]";
  return "bg-[#dff7e8] text-[#087333]";
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default function CustomersPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CustomerStatus | "all">("all");
  const [selectedId, setSelectedId] = useState(customers[0].id);

  const filteredCustomers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesQuery =
        !needle ||
        customer.name.toLowerCase().includes(needle) ||
        customer.email.toLowerCase().includes(needle) ||
        customer.phone.includes(needle) ||
        customer.tags.some((tag) => tag.toLowerCase().includes(needle));
      const matchesStatus = status === "all" || customer.status === status;
      return matchesQuery && matchesStatus;
    });
  }, [query, status]);

  const selected = customers.find((customer) => customer.id === selectedId) ?? filteredCustomers[0] ?? customers[0];
  const totalNoShows = customers.reduce((sum, customer) => sum + customer.noShows, 0);
  const totalRounds = customers.reduce((sum, customer) => sum + customer.rounds, 0);

  return (
    <main className="min-h-screen bg-[#f2f2f4] text-[#1f2328]">
      <div className="grid min-h-screen lg:grid-cols-[148px_1fr]">
        <aside className="hidden bg-[#111315] text-white lg:block">
          <div className="border-b border-white/10 px-4 py-4 text-sm font-bold">lightspeed</div>
          <nav className="grid gap-1 px-2 py-3 text-xs">
            {[
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
            ].map(([item, href]) => (
              <a
                className={`px-3 py-2 font-semibold ${item === "Customers" ? "bg-[#4533ff]" : "hover:bg-white/10"}`}
                href={href}
                key={item}
              >
                {item}
              </a>
            ))}
          </nav>
          <div className="mx-3 mt-4 bg-[#fffbd5] p-3 text-[11px] leading-5 text-[#2f2f21]">
            <p className="font-bold">Note</p>
            <p>Search by name, phone, email, or tag.</p>
            <p>Review no-show risk before confirming peak tee times.</p>
          </div>
        </aside>

        <section className="grid min-w-0 grid-rows-[auto_auto_1fr]">
          <header className="flex items-center justify-between border-b border-[#d4d4d8] bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <button className="text-xl text-[#6b7280]">☰</button>
              <a className="text-sm font-bold" href="/customers">
                Customers
              </a>
            </div>
            <a className="bg-[#4533ff] px-4 py-1.5 text-xs font-bold text-white" href="/admin">
              Tee Sheet
            </a>
          </header>

          <section className="border-b border-[#d4d4d8] bg-white px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded bg-[#111315] px-2 py-1 text-white">{customers.length} Customers</span>
                <span>{totalRounds} Rounds</span>
                <span>{totalNoShows} No-shows</span>
                <span>{filteredCustomers.length} Visible</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  className="w-72 border border-[#cfd2d8] bg-white px-3 py-1.5 text-xs outline-none focus:border-[#4533ff]"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search customers"
                  value={query}
                />
                {(["all", "active", "vip", "watch", "inactive"] as const).map((item) => (
                  <button
                    className={`border px-3 py-1.5 text-xs font-bold capitalize ${
                      status === item ? "border-[#4533ff] bg-[#4533ff] text-white" : "border-[#cfd2d8] bg-white"
                    }`}
                    key={item}
                    onClick={() => setStatus(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="grid min-h-0 gap-4 p-4 xl:grid-cols-[1fr_360px]">
            <div className="overflow-hidden border border-[#d4d4d8] bg-white">
              <div className="grid grid-cols-[1.2fr_.7fr_.7fr_.7fr_.5fr] border-b border-[#d4d4d8] bg-[#f7f7f8] px-3 py-2 text-[11px] font-bold uppercase text-[#5d6673]">
                <span>Customer</span>
                <span>Tags / Status</span>
                <span>Reservation History</span>
                <span>Upcoming</span>
                <span className="text-right">No-show</span>
              </div>
              <div className="divide-y divide-[#e2e4e8]">
                {filteredCustomers.map((customer) => (
                  <button
                    className={`grid w-full grid-cols-[1.2fr_.7fr_.7fr_.7fr_.5fr] items-center px-3 py-3 text-left text-xs hover:bg-[#f4f5ff] ${
                      selected.id === customer.id ? "bg-[#f4f5ff]" : "bg-white"
                    }`}
                    key={customer.id}
                    onClick={() => setSelectedId(customer.id)}
                  >
                    <span>
                      <strong className="block text-sm">{customer.name}</strong>
                      <span className="block text-[#5d6673]">{customer.phone}</span>
                      <span className="block truncate text-[#5d6673]">{customer.email}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <span className={`px-2 py-1 text-[11px] font-bold capitalize ${statusClass(customer.status)}`}>
                        {customer.status}
                      </span>
                      {customer.tags.map((tag) => (
                        <span className="border border-[#d4d4d8] px-2 py-1 text-[11px]" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </span>
                    <span>
                      <strong>{customer.rounds} rounds</strong>
                      <span className="block text-[#5d6673]">{customer.lastBooking}</span>
                      <span className="block text-[#5d6673]">{money(customer.spend)}</span>
                    </span>
                    <span className="font-semibold">{customer.upcoming}</span>
                    <span className="text-right text-sm font-bold">{customer.noShows}</span>
                  </button>
                ))}
              </div>
            </div>

            <aside className="border border-[#d4d4d8] bg-white p-4">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase text-[#5d6673]">Customer File</p>
                  <h1 className="text-xl font-bold">{selected.name}</h1>
                </div>
                <span className={`px-2 py-1 text-[11px] font-bold capitalize ${statusClass(selected.status)}`}>
                  {selected.status}
                </span>
              </div>
              <dl className="grid gap-3 text-xs">
                <div>
                  <dt className="font-bold text-[#5d6673]">Contact</dt>
                  <dd>{selected.phone}</dd>
                  <dd>{selected.email}</dd>
                </div>
                <div>
                  <dt className="font-bold text-[#5d6673]">Tags</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {selected.tags.map((tag) => (
                      <span className="border border-[#d4d4d8] px-2 py-1" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[#f7f7f8] p-3">
                    <dt className="font-bold text-[#5d6673]">Rounds</dt>
                    <dd className="text-lg font-bold">{selected.rounds}</dd>
                  </div>
                  <div className="bg-[#f7f7f8] p-3">
                    <dt className="font-bold text-[#5d6673]">No-show</dt>
                    <dd className="text-lg font-bold">{selected.noShows}</dd>
                  </div>
                  <div className="bg-[#f7f7f8] p-3">
                    <dt className="font-bold text-[#5d6673]">Spend</dt>
                    <dd className="text-lg font-bold">{money(selected.spend)}</dd>
                  </div>
                </div>
                <div>
                  <dt className="font-bold text-[#5d6673]">Booking Summary</dt>
                  <dd className="mt-1 border-l-4 border-[#4533ff] bg-[#f4f5ff] p-3">
                    Upcoming: {selected.upcoming}
                    <br />
                    Last booking: {selected.lastBooking}
                  </dd>
                </div>
              </dl>
            </aside>
          </section>
        </section>
      </div>
    </main>
  );
}
