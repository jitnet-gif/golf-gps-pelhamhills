"""Import a manually verified Chronogolf DOM snapshot; dry-run unless --apply.

Stop the local API before applying: its current store cache does not watch disk.
Source IDs/timestamps are unavailable. Stable IDs and seat chronology are synthetic.
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
from backend.services import tee_sheet_store as store


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
        if not 400 <= minutes <= 1080 or (minutes - 400) % 9:
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


def run(source, apply=False):
    snapshot = json.loads(Path(source).read_text(encoding="utf-8-sig"))
    incoming = convert(snapshot)
    target = store.data_file()
    existing = json.loads(target.read_text(encoding="utf-8-sig")) if target.exists() else []
    merged, replaced = merge(existing, incoming)
    report = dict(mode="apply" if apply else "dry-run", date=snapshot["date"],
        importedBookings=len(incoming), importedPlayers=sum(len(b["players"]) for b in incoming),
        sourceSlots=len(snapshot["rows"]), slotCarts=sum(r[2] for r in snapshot["rows"]),
        replacedBookings=replaced, preservedBookings=len(merged)-len(incoming),
        target=str(target), changed=merged != existing,
        sourceSha256=hashlib.sha256(Path(source).read_bytes()).hexdigest())
    if apply and merged != existing:
        if target.exists():
            backup = target.with_name(target.name + "." + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".bak")
            shutil.copy2(target, backup)
            report["backup"] = str(backup)
        store.save_bookings(merged)
        if json.loads(target.read_text(encoding="utf-8")) != merged:
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
