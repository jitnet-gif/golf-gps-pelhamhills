"""Import a manually verified Chronogolf DOM snapshot; dry-run unless --apply.

Stop the local API before applying (JSON mode): its store cache does not watch disk.
Source IDs/timestamps are unavailable. Stable IDs and seat chronology are synthetic.

Works on both store backends (json / supabase). It reads and writes only the
snapshot's date plus the incoming booking ids, never the rest of the tee sheet.
In supabase mode the rows about to be replaced are snapshotted to
backend/data/backups/ before anything is written.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.api.routes.tee_sheet import (FIRST_TEE_MINUTES, LAST_TEE_MINUTES,
                                          SLOT_INTERVAL_MINUTES)
from backend.services import tee_sheet_store as store

# Supabase-mode backups land under the gitignored backend/data. Tests point it at tmp.
BACKUP_DIR = Path(__file__).resolve().parents[1] / "backend" / "data" / "backups"


def surname(name):
    return re.sub(r"[^a-z]", "", name.split(",")[0].lower())


def convert(snapshot):
    date = snapshot["date"]
    datetime.strptime(date, "%Y-%m-%d")
    club = snapshot["clubId"]
    if club != 19671:
        raise ValueError("Unexpected clubId")
    output = []
    seen = set()
    for time_label, rate, carts, groups in snapshot["rows"]:
        stamp = datetime.strptime(time_label, "%I:%M %p")
        minutes = stamp.hour * 60 + stamp.minute
        if (not FIRST_TEE_MINUTES <= minutes <= LAST_TEE_MINUTES
                or (minutes - FIRST_TEE_MINUTES) % SLOT_INTERVAL_MINUTES):
            raise ValueError(f"Invalid slot: {time_label}")
        if time_label in seen:
            raise ValueError("Duplicate source slot")
        seen.add(time_label)
        if not isinstance(carts, int) or not 0 <= carts <= 4:
            raise ValueError("Invalid slot carts")
        if not isinstance(rate, (int, float)) or rate < 0:
            raise ValueError("Invalid rack rate")
        if not 1 <= sum(len(g[3]) for g in groups) <= 4:
            raise ValueError("Invalid slot player capacity")
        remaining_carts = carts
        for group_index, (online, holes, note, source_players) in enumerate(groups):
            if holes not in (9, 18) or not source_players:
                raise ValueError("Invalid group")
            key = f"chronogolf-{club}-{date}-{minutes}-{group_index}"
            players = []
            for index, (display, rate_index, guest, paid) in enumerate(source_players):
                if not isinstance(rate_index, int) or not 0 <= rate_index < len(snapshot["rates"]):
                    raise ValueError("Invalid rate index")
                if "," in display:
                    last, first = (s.strip() for s in display.split(",", 1))
                else:
                    first, last = store.split_name(display)
                players.append(dict(id=f"{key}-p{index}", name=f"{first} {last}".strip(),
                    firstName=first, lastName=last, email="", phone="",
                    type="Guest" if guest else "Existing Customer",
                    ratePlan=snapshot["rates"][rate_index], paid=bool(paid),
                    arrived=False, cancelled=False, no_show=False))
            allocated = min(remaining_carts, len(players))
            if group_index == len(groups) - 1:
                allocated = remaining_carts
            remaining_carts -= allocated
            synthetic = f"{date}T00:00:00+00:00"
            synthetic = (datetime.fromisoformat(synthetic) + timedelta(seconds=len(output))).isoformat()
            provenance = dict(source="Chronogolf DOM snapshot", clubId=club,
                url=f"https://www.chronogolf.com/admin#/clubs/{club}/teesheets",
                sourceDate=date, sourceTime=time_label, rackRate=rate,
                slotCartCount=carts, cartAllocation="inferred sequential allocation" if len(groups)>1 else "slot total",
                timestamps="synthetic seat-order chronology; source timestamps unavailable",
                identifiers="synthetic stable IDs; source reservation IDs unavailable",
                payment="player paid badges only; arrival not verified")
            output.append(dict(id=key, date=date, time=time_label, holes=holes, rate=rate,
                span=1, color="blue" if online else "gold", title=source_players[0][0],
                status="reserved", cartCount=allocated,
                notes=(note + "\n" if note else "") + "Import provenance: " + json.dumps(provenance, ensure_ascii=False),
                players=players, audit=[dict(id=f"{key}-import", ts=synthetic,
                    message="Imported verified Chronogolf snapshot; chronology is synthetic.")],
                cancelReason=None, createdAt=synthetic, updatedAt=synthetic))
    return output


def merge(existing, incoming):
    """Replace exact previous imports and recognized seed rows; reject collisions."""
    ids = {b["id"] for b in incoming}
    target_slots = {(b["date"], b["time"]) for b in incoming}
    kept = []
    replaced = 0
    for old in existing:
        if old["id"] in ids:
            replaced += 1
            continue
        slot = old["date"], old["time"]
        if slot not in target_slots:
            kept.append(old)
            continue
        # Only the pre-existing explicitly imported seed records can be superseded.
        seed = old["id"].startswith("b-") and any(
            "Imported from the Chronogolf tee sheet" in entry.get("message", "")
            for entry in old.get("audit", []))
        lead = surname(old["title"])
        candidates = [b for b in incoming if (b["date"], b["time"]) == slot
            and (surname(b["title"]) == lead or
                 SequenceMatcher(None, surname(b["title"]), lead).ratio() >= .85)]
        if not seed or len(candidates) != 1:
            raise ValueError(f"Unrelated or ambiguous existing booking conflicts at {slot[0]} {slot[1]}")
        replaced += 1
    return kept + incoming, replaced


def _keyed(bookings):
    # Scoped reads come back in backend-specific order (file order vs date/created).
    # Compare content, not order.
    return {b["id"]: b for b in bookings}


def _json_file_missing():
    # Keep the old "no file = empty store" meaning. Going through the store, JSON mode
    # seeds a missing file on first read: a write during dry-run, seed rows on apply.
    return store.backend() == "json" and not store.data_file().exists()


def _target():
    if store.backend() == "json":
        return str(store.data_file())
    from backend.services import tee_sheet_supabase
    return f"supabase:{tee_sheet_supabase.TABLE}"


def _backup(rows):
    """Leave something to roll back to, right before the write. Returns the path or None."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    if store.backend() == "json":
        # Whole-file copy as before; it also holds every row outside the scope.
        target = store.data_file()
        if not target.exists():
            return None
        backup = target.with_name(target.name + "." + stamp + ".bak")
        shutil.copy2(target, backup)
        return str(backup)
    # No file in supabase mode: keep the scoped rows exactly as read under the lock.
    # Rows outside the scope are never touched by this import, so they are not needed.
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f"import_chronogolf_snapshot-{stamp}.json"
    backup.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(backup)


def run(source, apply=False):
    snapshot = json.loads(Path(source).read_text(encoding="utf-8-sig"))
    incoming = convert(snapshot)
    # Scope = the snapshot date plus the incoming ids. merge() replaces exact previous
    # imports by id on ANY date (e.g. one staff later moved), so those rows must be
    # loaded for merge() to see them; otherwise the write would upsert over them blind.
    scope = store.Scope(dates={snapshot["date"]}, ids={b["id"] for b in incoming})
    store.drop_cache()  # JSON mode: work from what is on disk, as the old importer did
    fresh = _json_file_missing()
    existing = [] if fresh else store.load_bookings(scope)
    total = 0 if fresh else store.count_bookings()
    merged, replaced = merge(existing, incoming)
    report = dict(mode="apply" if apply else "dry-run", date=snapshot["date"],
        importedBookings=len(incoming), importedPlayers=sum(len(b["players"]) for b in incoming),
        sourceSlots=len(snapshot["rows"]), slotCarts=sum(r[2] for r in snapshot["rows"]),
        # Rows outside the scope are not read; every one of them is preserved.
        replacedBookings=replaced, preservedBookings=total - replaced,
        target=_target(), changed=_keyed(merged) != _keyed(existing),
        sourceSha256=hashlib.sha256(Path(source).read_bytes()).hexdigest())
    if apply and report["changed"]:
        if fresh:
            store.save_bookings([])  # start from an empty file, no seed rows
        with store.mutate(scope) as live:
            # Recompute against what was read under the lock, so merge()'s collision
            # guard also covers anything that changed since the dry-run read.
            merged, replaced = merge(live, incoming)
            backup = None if fresh else _backup(live)
            live[:] = merged
        report["replacedBookings"] = replaced
        report["preservedBookings"] = total - replaced
        if backup:
            report["backup"] = backup
        # Read the same scope back from the store (either backend) instead of the file.
        if _keyed(store.load_bookings(scope)) != _keyed(merged):
            raise RuntimeError("Readback verification failed")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.apply), indent=2))
