"use client";

import { useState } from "react";

type StaffRole = "Owner" | "Manager" | "Pro Shop" | "Read Only";

const staffRoles: StaffRole[] = ["Owner", "Manager", "Pro Shop", "Read Only"];

export default function SettingsPage() {
  const [courseName, setCourseName] = useState("Pelham Hills Golf Club");
  const [coursePhone, setCoursePhone] = useState("905-892-2196");
  const [interval, setInterval] = useState(9);
  const [taxRate, setTaxRate] = useState(13);
  const [cartFee, setCartFee] = useState(19.5);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [smsAlerts, setSmsAlerts] = useState(true);
  const [cancelAlerts, setCancelAlerts] = useState(true);
  const [roles, setRoles] = useState([
    { name: "John Navjev", email: "john@pelhamhills.com", role: "Owner" as StaffRole, active: true },
    { name: "Front Desk", email: "shop@pelhamhills.com", role: "Pro Shop" as StaffRole, active: true },
    { name: "Reports User", email: "reports@pelhamhills.com", role: "Read Only" as StaffRole, active: false },
  ]);
  const [saved, setSaved] = useState("Unsaved local settings");

  function updateRole(index: number, patch: Partial<(typeof roles)[number]>) {
    setRoles((current) => current.map((role, roleIndex) => (roleIndex === index ? { ...role, ...patch } : role)));
    setSaved("Unsaved local settings");
  }

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
              <a className={`px-3 py-2 font-semibold ${item === "Settings" ? "bg-[#4533ff]" : "hover:bg-white/10"}`} href={href} key={item}>
                {item}
              </a>
            ))}
          </nav>
          <div className="mx-3 mt-4 bg-[#fffbd5] p-3 text-[11px] leading-5 text-[#2f2f21]">
            <p className="font-bold">Note</p>
            <p>Settings are local state</p>
            <p>No production sync</p>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="flex items-center justify-between border-b border-[#d4d4d8] bg-white px-4 py-3">
            <div>
              <p className="text-xs font-bold text-[#6b7280]">Pelham Hills Golf Club</p>
              <h1 className="text-sm font-bold">Settings</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#6b7280]">{saved}</span>
              <button className="bg-[#4533ff] px-5 py-2 text-xs font-bold text-white" onClick={() => setSaved("Saved locally")}>Save</button>
            </div>
          </header>

          <section className="grid gap-4 p-4 xl:grid-cols-[1fr_1fr]">
            <section className="border border-[#d6d6dc] bg-white">
              <div className="border-b border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">Course Information</div>
              <div className="grid gap-3 p-4 text-xs">
                <label className="font-bold">
                  Course Name
                  <input className="mt-1 w-full border border-[#d6d6dc] px-3 py-2 font-normal" value={courseName} onChange={(event) => { setCourseName(event.target.value); setSaved("Unsaved local settings"); }} />
                </label>
                <label className="font-bold">
                  Phone
                  <input className="mt-1 w-full border border-[#d6d6dc] px-3 py-2 font-normal" value={coursePhone} onChange={(event) => { setCoursePhone(event.target.value); setSaved("Unsaved local settings"); }} />
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="font-bold">
                    Tee Interval
                    <input className="mt-1 w-full border border-[#d6d6dc] px-3 py-2 font-normal" min={6} max={15} type="number" value={interval} onChange={(event) => { setInterval(Number(event.target.value)); setSaved("Unsaved local settings"); }} />
                  </label>
                  <label className="font-bold">
                    Tax %
                    <input className="mt-1 w-full border border-[#d6d6dc] px-3 py-2 font-normal" min={0} step="0.1" type="number" value={taxRate} onChange={(event) => { setTaxRate(Number(event.target.value)); setSaved("Unsaved local settings"); }} />
                  </label>
                  <label className="font-bold">
                    Cart Fee
                    <input className="mt-1 w-full border border-[#d6d6dc] px-3 py-2 font-normal" min={0} step="0.5" type="number" value={cartFee} onChange={(event) => { setCartFee(Number(event.target.value)); setSaved("Unsaved local settings"); }} />
                  </label>
                </div>
              </div>
            </section>

            <section className="border border-[#d6d6dc] bg-white">
              <div className="border-b border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">Notification Settings</div>
              <div className="grid gap-3 p-4 text-xs">
                {[
                  { label: "Email staff when a tee time is booked", checked: emailAlerts, set: setEmailAlerts },
                  { label: "SMS pro shop for same-day changes", checked: smsAlerts, set: setSmsAlerts },
                  { label: "Flag cancellation and refund tasks", checked: cancelAlerts, set: setCancelAlerts },
                ].map((item) => (
                  <label className="flex items-center justify-between border border-[#ececf0] px-3 py-2 font-bold" key={item.label}>
                    <span>{item.label}</span>
                    <input checked={item.checked} onChange={(event) => { item.set(event.target.checked); setSaved("Unsaved local settings"); }} type="checkbox" />
                  </label>
                ))}
                <div className="bg-[#fffbd5] p-3 leading-5 text-[#2f2f21]">
                  <p className="font-bold">Preview</p>
                  <p>{courseName} uses {interval}-minute tee intervals with {taxRate}% tax and ${cartFee.toFixed(2)} cart fee.</p>
                </div>
              </div>
            </section>

            <section className="border border-[#d6d6dc] bg-white xl:col-span-2">
              <div className="border-b border-[#d6d6dc] bg-[#d7d5da] px-3 py-2 text-xs font-bold">Staff Permissions</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-xs">
                  <thead className="bg-[#f7f7f8] text-left">
                    <tr>
                      {["Staff", "Email", "Role", "Status", "Controls"].map((heading) => (
                        <th className="border-b border-[#d6d6dc] px-3 py-2" key={heading}>{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((staff, index) => (
                      <tr key={staff.email}>
                        <td className="border-b border-[#ececf0] px-3 py-2 font-bold">{staff.name}</td>
                        <td className="border-b border-[#ececf0] px-3 py-2">{staff.email}</td>
                        <td className="border-b border-[#ececf0] px-3 py-2">
                          <select className="border border-[#d6d6dc] bg-white px-2 py-1" value={staff.role} onChange={(event) => updateRole(index, { role: event.target.value as StaffRole })}>
                            {staffRoles.map((role) => (
                              <option key={role}>{role}</option>
                            ))}
                          </select>
                        </td>
                        <td className="border-b border-[#ececf0] px-3 py-2">
                          <span className={`px-2 py-1 font-bold ${staff.active ? "bg-[#ecfff1] text-[#168a3c]" : "bg-[#ececf0] text-[#4e5560]"}`}>{staff.active ? "Active" : "Disabled"}</span>
                        </td>
                        <td className="border-b border-[#ececf0] px-3 py-2">
                          <button className="border border-[#d6d6dc] px-3 py-1 font-bold" onClick={() => updateRole(index, { active: !staff.active })}>
                            {staff.active ? "Disable" : "Enable"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        </section>
      </div>
    </main>
  );
}
