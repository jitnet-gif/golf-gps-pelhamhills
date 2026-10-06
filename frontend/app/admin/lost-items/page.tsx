"use client";

/**
 * 분실물 — 전화 비서가 받아 적은 접수(0013)를 프로 샵이 보고 처리하는 화면.
 *
 * 흐름: Searching(접수됨) → Found(보관 중, 손님에게 문자) → Returned(돌려줌).
 * 못 찾고 끝내면 Closed. "Found" 를 누르면 백엔드가 1분 안에 손님에게 문자를 보낸다
 * (`lib/lostItems.ts` 머리 주석). 카운터에서 직접 받은 분실 신고는 "Log item" 으로 넣는다 —
 * 전화 접수와 같은 티켓 번호 줄을 탄다.
 *
 * 데모 데이터로 내려가지 않는다. 손님 이름·번호가 들어 있는 표라, 가짜 줄을 진짜로 읽고
 * 엉뚱한 사람에게 연락하는 것이 가장 나쁜 결과다.
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";

import AdminShell from "@/components/admin/AdminShell";
import {
  Button,
  Chip,
  EmptyNote,
  ErrorNote,
  Field,
  Modal,
  SkeletonRows,
  TextArea,
  TextInput,
} from "@/components/retail/ui";
import {
  LOST_STATUS_LABEL,
  clubDateTime,
  describeLostError,
  lostItemsApi,
  noticeLine,
  type LostItem,
  type LostItemInput,
  type LostItemPatch,
  type LostStatus,
} from "@/lib/lostItems";

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "searching", label: "Searching" },
  { key: "found", label: "Found" },
  { key: "returned", label: "Returned" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function matches(filter: FilterKey, row: LostItem): boolean {
  if (filter === "all") return true;
  if (filter === "open") return row.status === "searching" || row.status === "found";
  return row.status === filter;
}

/** 아직 문자가 안 나간 "찾음" 줄이 있으면 상태를 따라가려고 그동안만 다시 읽는다. */
const POLL_MS = 20_000;

export default function LostItemsPage() {
  const [rows, setRows] = useState<LostItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LostItem | null>(null);

  // 다시 읽기는 이 숫자를 올려서 한다. effect 안에서 바로 setState 를 부르지 않기 위해서다.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    lostItemsApi
      .list()
      .then((value) => {
        if (cancelled) return;
        setRows(value);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(describeLostError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const waitingOnText = rows?.some((row) => row.status === "found" && row.caller_phone && !row.notify_status);
  useEffect(() => {
    if (!waitingOnText) return;
    const timer = window.setInterval(() => setReloadKey((key) => key + 1), POLL_MS);
    return () => window.clearInterval(timer);
  }, [waitingOnText]);

  const replace = (next: LostItem) =>
    setRows((current) => (current ?? []).map((row) => (row.id === next.id ? next : row)));

  const patch = async (row: LostItem, change: LostItemPatch) => {
    setBusyId(row.id);
    try {
      replace(await lostItemsApi.update(row.id, change));
      setError(null);
    } catch (err) {
      setError(describeLostError(err));
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const out = Object.fromEntries(FILTERS.map((f) => [f.key, 0])) as Record<FilterKey, number>;
    for (const row of rows ?? []) for (const f of FILTERS) if (matches(f.key, row)) out[f.key] += 1;
    return out;
  }, [rows]);

  const visible = (rows ?? []).filter((row) => matches(filter, row));

  return (
    <AdminShell
      actions={
        <Button onClick={() => setCreating(true)} tone="primary">
          Log item
        </Button>
      }
      title="Lost & Found"
    >
      <div className="grid min-w-0 gap-3 p-4">
        <div className="flex gap-2 overflow-x-auto">
          {FILTERS.map((item) => (
            <Chip active={filter === item.key} key={item.key} onClick={() => setFilter(item.key)}>
              {item.label}
              {rows ? <span className="ml-1.5 tabular-nums opacity-70">{counts[item.key]}</span> : null}
            </Chip>
          ))}
        </div>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {rows === null ? (
          error ? null : <SkeletonRows />
        ) : visible.length === 0 ? (
          <EmptyNote>No {filter === "all" || filter === "open" ? "" : `${LOST_STATUS_LABEL[filter]} `}lost items.</EmptyNote>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {visible.map((row) => (
              <LostCard
                busy={busyId === row.id}
                key={row.id}
                onEditNote={() => setEditing(row)}
                onPatch={(change) => void patch(row, change)}
                row={row}
              />
            ))}
          </div>
        )}
      </div>

      {creating ? (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={(row) => {
            setRows((current) => [row, ...(current ?? [])]);
            setCreating(false);
          }}
        />
      ) : null}

      {editing ? (
        <NoteModal
          onClose={() => setEditing(null)}
          onSave={async (notes) => {
            await patch(editing, { notes });
            setEditing(null);
          }}
          row={editing}
        />
      ) : null}
    </AdminShell>
  );
}

const BADGE: Record<LostStatus, string> = {
  searching: "bg-[#fff8e1] text-[#5b4708]",
  found: "bg-[#e8f5ec] text-[#1f6b3a]",
  returned: "bg-[#f0f0f3] text-[#3f434a]",
  closed: "bg-[#f0f0f3] text-[#6b7280]",
};

const NOTICE_TONE = {
  ok: "text-[#1f6b3a]",
  wait: "text-[#5b4708]",
  bad: "text-[#8a1f1f]",
} as const;

function LostCard({
  row,
  busy,
  onPatch,
  onEditNote,
}: {
  row: LostItem;
  busy: boolean;
  onPatch: (change: LostItemPatch) => void;
  onEditNote: () => void;
}) {
  const notice = noticeLine(row);
  const canResend =
    row.status === "found" && !!row.caller_phone && !!row.notify_status;

  return (
    <section className="grid min-w-0 gap-2 border border-[#d4d4d8] bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-bold">
          <span className="tabular-nums text-[#6b7280]">{row.ticket}</span> · {row.item}
        </h3>
        <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase ${BADGE[row.status]}`}>
          {LOST_STATUS_LABEL[row.status]}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        {row.description ? (
          <>
            <dt className="text-[#6b7280]">Details</dt>
            <dd className="break-words">{row.description}</dd>
          </>
        ) : null}
        <dt className="text-[#6b7280]">Lost</dt>
        <dd>
          {[row.lost_on, row.where_lost].filter(Boolean).join(" · ") || "Not sure"}
        </dd>
        <dt className="text-[#6b7280]">Guest</dt>
        <dd className="break-words">
          {row.caller_name || "No name"}
          {row.caller_phone ? (
            <>
              {" · "}
              <a className="underline" href={`tel:${row.caller_phone}`}>
                {row.caller_phone}
              </a>
            </>
          ) : null}
        </dd>
        <dt className="text-[#6b7280]">Reported</dt>
        <dd>{clubDateTime(row.created_at)}</dd>
        {row.notes ? (
          <>
            <dt className="text-[#6b7280]">Note</dt>
            <dd className="break-words">{row.notes}</dd>
          </>
        ) : null}
      </dl>

      {notice ? <p className={`text-xs font-bold ${NOTICE_TONE[notice.tone]}`}>{notice.text}</p> : null}

      <div className="flex flex-wrap gap-2">
        {row.status === "searching" ? (
          <>
            <Button disabled={busy} onClick={() => onPatch({ status: "found" })} tone="primary">
              Found
            </Button>
            <Button disabled={busy} onClick={() => onPatch({ status: "closed" })}>
              Close
            </Button>
          </>
        ) : null}
        {row.status === "found" ? (
          <>
            <Button disabled={busy} onClick={() => onPatch({ status: "returned" })} tone="primary">
              Returned
            </Button>
            {canResend ? (
              <Button disabled={busy} onClick={() => onPatch({ resend: true })}>
                Resend text
              </Button>
            ) : null}
            <Button disabled={busy} onClick={() => onPatch({ status: "searching" })}>
              Not theirs
            </Button>
          </>
        ) : null}
        {row.status === "returned" || row.status === "closed" ? (
          <Button disabled={busy} onClick={() => onPatch({ status: "searching" })}>
            Reopen
          </Button>
        ) : null}
        <Button disabled={busy} onClick={onEditNote}>
          {row.notes ? "Edit note" : "Add note"}
        </Button>
      </div>
    </section>
  );
}

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (row: LostItem) => void;
}) {
  const [form, setForm] = useState<LostItemInput>({ item: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof LostItemInput) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.item.trim()) {
      setError("Say what was lost.");
      return;
    }
    setSaving(true);
    try {
      onCreated(await lostItemsApi.create(form));
    } catch (err) {
      setError(describeLostError(err));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Log a lost item">
      <form className="grid gap-3" onSubmit={submit}>
        <Field label="Item">
          <TextInput autoFocus onChange={set("item")} placeholder="Rangefinder" value={form.item} />
        </Field>
        <Field label="Details">
          <TextInput onChange={set("description")} placeholder="Black Bushnell, grey case" value={form.description ?? ""} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Lost on">
            <TextInput onChange={set("lost_on")} type="date" value={form.lost_on ?? ""} />
          </Field>
          <Field label="Where">
            <TextInput onChange={set("where_lost")} placeholder="Cart 34, hole 12" value={form.where_lost ?? ""} />
          </Field>
        </div>
        <Field label="Guest name">
          <TextInput autoComplete="off" onChange={set("caller_name")} value={form.caller_name ?? ""} />
        </Field>
        <Field hint="We text this number when the item turns up." label="Guest phone">
          <TextInput autoComplete="off" inputMode="tel" onChange={set("caller_phone")} type="tel" value={form.caller_phone ?? ""} />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button disabled={saving} full tone="primary" type="submit">
          {saving ? "Saving…" : "Log item"}
        </Button>
      </form>
    </Modal>
  );
}

function NoteModal({
  row,
  onClose,
  onSave,
}: {
  row: LostItem;
  onClose: () => void;
  onSave: (notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(row.notes ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <Modal onClose={onClose} title={`${row.ticket} · note`}>
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          await onSave(notes);
        }}
      >
        <Field hint="Where it is kept, who picked it up, etc. Staff only — never texted." label="Note">
          <TextArea autoFocus onChange={(event) => setNotes(event.target.value)} value={notes} />
        </Field>
        <Button disabled={saving} full tone="primary" type="submit">
          {saving ? "Saving…" : "Save note"}
        </Button>
      </form>
    </Modal>
  );
}
