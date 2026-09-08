"""고객 저장소 + CSV 명부 임포터 테스트.

⚠️ 픽스처는 **전부 합성 데이터**다. 실제 고객 이름/전화/이메일을 여기에 넣지 말 것 —
이 디렉터리는 git 에 추적되므로 한 번 커밋되면 히스토리에서 지우기 어렵다.
아래 이름과 번호(555-01xx)는 지어낸 것이고, 소스에서 관찰된 *모양*만 재현한다:
Ws 태그, 괄호 별명, 두 단어 성, 한 집안 공유 전화, 자릿수 틀린 전화, 동명이인.
"""
import importlib.util
import json
from pathlib import Path

import pytest

from backend.services import customer_store as store

spec = importlib.util.spec_from_file_location(
    "teesheet_customers",
    Path(__file__).resolve().parents[2] / "scripts/import_teesheet_customers.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row(**overrides):
    base = {
        "Club Name": "Pelham Hills Golf Club", "Start Date": "2026-04-01",
        "Start Time": "08:01AM", "Round Player ID": "900001", "Round ID": "1",
        "Player Name": "Alba Testerly", "Player Phone": "5550100000",
        "Player Email": "alba@example.test", "Player ZIP Code": "L0S1C0",
        "Player Role": "Public", "Player Type": "Public", "Round State": "Arrived",
        "Paid State": "Paid", "Is Round Cancelled": "No", "Green Fees": "47.79",
        "Cart Fees": "0.00", "Club Currency Code": "CAD",
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setenv(store.ENV_VAR, str(tmp_path / "customers.json"))
    store.reset()
    yield


# ===== 정규화 ==========================================================


@pytest.mark.parametrize("raw,expected", [
    ("Doug Fixture (Ws5)", ("Doug Fixture", ["Ws5"], "")),
    ("Lake Sample(Ws6)", ("Lake Sample", ["Ws6"], "")),      # 공백 없는 형태
    ("Jack Sample - Ws6", ("Jack Sample", ["Ws6"], "")),
    ("Trevor Sample  Ws4", ("Trevor Sample", ["Ws4"], "")),  # 이중 공백
    ("Robert (Bob) Sample", ("Robert Sample", [], "Bob")),
    ("Plain Name", ("Plain Name", [], "")),
])
def test_clean_display_name_strips_tags_and_nicknames(raw, expected):
    assert store.clean_display_name(raw) == expected


def test_split_display_name_handles_multiword_surname():
    assert store.split_display_name("Kim St Louis") == ("Kim", "St Louis")
    assert store.split_display_name("Betty Lou Sample") == ("Betty Lou", "Sample")
    assert store.split_display_name("Solo") == ("Solo", "")


@pytest.mark.parametrize("raw,expected", [
    ("5550100000", "5550100000"), ("15550100000", "5550100000"),
    ("05550100000", "5550100000"), ("(555) 010-0000", "5550100000"),
    ("555010000", ""),   # 9자리 오타 — 추측하지 않는다
    ("", ""),
])
def test_normalize_phone_never_guesses(raw, expected):
    assert store.normalize_phone(raw) == expected


@pytest.mark.parametrize("plan,tier,category,cart,segment", [
    ("Full Member - Single with 7 Day Cart", "Full", "Single", "7 Day", None),
    ("Weekday Member - Single with Weekday Cart", "Weekday", "Single", "Weekday", None),
    ("Weekday Member - Spousal", "Weekday", "Spousal", None, None),
    ("Twilight Member - Single with 7 Day Cart", "Twilight", "Single", "7 Day", None),
    ("9 Hole Member - Single", "9 Hole", "Single", None, None),
    ("Intermediate Member II", "Intermediate", None, None, None),
    ("Junior Member", "Junior", None, None, None),
    ("Public", None, None, None, "Standard"),
    ("Public Senior", None, None, None, "Senior"),
    ("Public Junior", None, None, None, "Junior"),
    ("GolfNow", None, None, None, "GolfNow"),
])
def test_classify_rate_plan_covers_every_observed_plan(plan, tier, category, cart, segment):
    """4월 CSV 12개 + 9/8 스냅샷 10개, 두 소스에서 관찰된 값 전부."""
    result = store.classify_rate_plan(plan)
    assert (result["tier"], result["category"], result["cartPlan"], result["publicSegment"]) == \
        (tier, category, cart, segment)
    assert result["isMember"] is (tier is not None)


def test_unknown_member_plan_is_kept_as_other_not_silently_public():
    result = store.classify_rate_plan("Corporate Member - Platinum")
    assert result["tier"] == "Other" and result["isMember"] is True


def test_normalize_email_and_zip():
    assert store.normalize_email("  Alba@Example.TEST ") == "alba@example.test"
    assert store.normalize_email("not-an-email") == ""
    assert store.normalize_zip("l0s1c0") == store.normalize_zip("L0S 1C0") == "L0S 1C0"
    assert store.normalize_zip("90210") == ""


# ===== 신원 / 병합 =====================================================


def test_find_customer_prefers_email_over_phone_so_households_stay_separate():
    """한 집에서 유선 하나를 같이 쓴다. 전화로 먼저 맞추면 부부가 합쳐진다."""
    customers = [
        dict(id="chronogolf:1", name="Sue Household", email="sue@example.test",
             phone="5550100001"),
        dict(id="chronogolf:2", name="Jim Household", email="", phone="5550100001"),
    ]
    assert store.find_customer(customers, email="sue@example.test")["id"] == "chronogolf:1"
    # 전화만 주면 첫 일치를 돌려주지만, 이메일이 있으면 이메일이 이긴다.
    assert store.find_customer(customers, email="sue@example.test",
                               phone="5550100001")["id"] == "chronogolf:1"


def test_upsert_fills_blanks_keeps_membership_and_replaces_counters():
    customers = []
    store.upsert_customer(customers, dict(
        id="chronogolf:1", name="Alba Testerly", email="", phone="5550100000",
        rolesSeen=["Member"], ratePlansSeen=["Weekday Member - Single"], isMember=True,
        firstSeen="2026-04-01", lastSeen="2026-04-01", roundsBooked=1, totalSpendCents=0,
        reviewReasons=[], possibleDuplicateOf=[], sourceTags=[]))
    store.upsert_customer(customers, dict(
        id="chronogolf:1", name="Alba Testerly", email="alba@example.test", phone="",
        rolesSeen=["Public"], ratePlansSeen=["Public"], isMember=False,
        firstSeen="2026-03-01", lastSeen="2026-04-20", roundsBooked=3, totalSpendCents=4779,
        reviewReasons=[], possibleDuplicateOf=[], sourceTags=[]))

    assert len(customers) == 1
    merged = customers[0]
    assert merged["email"] == "alba@example.test"   # 빈 칸이 채워진다
    assert merged["phone"] == "5550100000"          # 채워진 값은 안 지워진다
    assert merged["isMember"] is True               # 한 번 회원이면 회원
    assert merged["ratePlansSeen"] == ["Public", "Weekday Member - Single"]
    assert (merged["firstSeen"], merged["lastSeen"]) == ("2026-03-01", "2026-04-20")
    assert merged["roundsBooked"] == 3              # 누적이 아니라 교체
    assert merged["totalSpendCents"] == 4779


# ===== 임포터 ==========================================================


def test_import_counts_spend_only_for_arrived_and_uncancelled():
    rows = [
        row(**{"Round ID": "1", "Green Fees": "47.79", "Cart Fees": "19.47"}),
        row(**{"Round ID": "2", "Start Date": "2026-04-02", "Round State": "Reserved",
               "Green Fees": "50.00"}),
        row(**{"Round ID": "3", "Start Date": "2026-04-03", "Is Round Cancelled": "Yes",
               "Green Fees": "99.00"}),
        row(**{"Round ID": "4", "Start Date": "2026-04-04", "Round State": "Noshow",
               "Green Fees": "99.00"}),
    ]
    built = module.build(rows, "test.csv")
    assert len(built) == 1
    person = built[0]
    assert person["id"] == "chronogolf:900001"
    assert person["totalSpendCents"] == 6726          # 47.79 + 19.47, 그 행만
    assert person["roundsBooked"] == 4
    assert person["roundsArrived"] == 1
    assert person["roundsCancelled"] == 1
    assert person["noShows"] == 1
    assert (person["firstSeen"], person["lastSeen"]) == ("2026-04-01", "2026-04-04")


def test_import_skips_anonymous_seats_and_staff_bookers():
    rows = [row(), row(**{"Round ID": "2", "Player Name": "", "Round Player ID": ""}),
            row(**{"Round ID": "3", "Round Player ID": "18500599",
                   "Player Name": "Staff Booker"})]
    assert [c["sourceId"] for c in module.build(rows, "t.csv")] == ["900001"]


def test_import_flags_household_and_duplicate_names_without_merging():
    rows = [
        row(**{"Round Player ID": "1", "Player Name": "Sue Household",
               "Player Phone": "5550100001", "Player Email": "sue@example.test"}),
        row(**{"Round ID": "2", "Round Player ID": "2", "Player Name": "Jim Household",
               "Player Phone": "5550100001", "Player Email": ""}),
        row(**{"Round ID": "3", "Round Player ID": "3", "Player Name": "Alba Testerly",
               "Player Phone": "5550100002", "Player Email": ""}),
        row(**{"Round ID": "4", "Round Player ID": "4", "Player Name": "Alba Testerly",
               "Player Phone": "5550100003", "Player Email": ""}),
    ]
    built = {c["sourceId"]: c for c in module.build(rows, "t.csv")}
    assert len(built) == 4, "한 집안이라고 사람을 합치면 안 된다"
    assert any("household" in r for r in built["1"]["reviewReasons"])
    assert built["3"]["possibleDuplicateOf"] == ["chronogolf:4"]
    assert any("same display name" in r for r in built["3"]["reviewReasons"])


def test_import_flags_unnormalizable_phone_but_keeps_it_verbatim():
    built = module.build([row(**{"Player Phone": "555010000"})], "t.csv")[0]
    assert built["phone"] == "" and built["phoneRaw"] == "555010000"
    assert built["needsReview"] is True


def test_membership_derived_from_role_since_member_number_is_absent():
    rows = [row(**{"Player Role": "Public", "Player Type": "Public"}),
            row(**{"Round ID": "2", "Player Role": "Member",
                   "Player Type": "Weekday Member - Single"})]
    built = module.build(rows, "t.csv")[0]
    assert built["isMember"] is True and built["memberNumber"] is None
    assert built["role"] == "Member"
    assert "Member Number empty" in built["provenance"]["membership"]


def test_member_tier_comes_from_the_latest_member_plan_not_a_public_round():
    """회원이 퍼블릭 요금으로 한 번 쳤다고 등급이 사라지면 안 된다."""
    rows = [
        row(**{"Start Date": "2026-04-01", "Player Role": "Member",
               "Player Type": "Weekday Member - Single"}),
        row(**{"Round ID": "2", "Start Date": "2026-04-10", "Player Role": "Member",
               "Player Type": "Weekday Member - Single with Weekday Cart"}),
        row(**{"Round ID": "3", "Start Date": "2026-04-20", "Player Role": "Public",
               "Player Type": "Public"}),
    ]
    built = module.build(rows, "t.csv")[0]
    assert built["memberTier"] == "Weekday"
    assert built["cartPlan"] == "Weekday", "가장 최근 *회원* 요금제의 카트 권한"
    assert built["memberCategory"] == "Single"
    assert built["memberTiersSeen"] == ["Weekday"]
    assert built["isMember"] is True
    assert "NOT ranked" in built["provenance"]["tier"]


def test_public_player_gets_a_segment_and_no_tier():
    built = module.build([row(**{"Player Type": "Public Senior"})], "t.csv")[0]
    assert built["memberTier"] is None and built["publicSegment"] == "Senior"
    assert built["isMember"] is False


def test_tier_survives_a_reimport_that_sees_only_a_public_round():
    customers = []
    store.upsert_customer(customers, dict(
        id="chronogolf:1", memberTier="Weekday", memberCategory="Single", cartPlan="Weekday",
        publicSegment=None, memberTiersSeen=["Weekday"], cartPlansSeen=["Weekday"],
        isMember=True, rolesSeen=["Member"], ratePlansSeen=["Weekday Member - Single"],
        reviewReasons=[], possibleDuplicateOf=[], sourceTags=[]))
    store.upsert_customer(customers, dict(
        id="chronogolf:1", memberTier=None, memberCategory=None, cartPlan=None,
        publicSegment="Standard", memberTiersSeen=[], cartPlansSeen=[],
        isMember=False, rolesSeen=["Public"], ratePlansSeen=["Public"],
        reviewReasons=[], possibleDuplicateOf=[], sourceTags=[]))
    assert customers[0]["memberTier"] == "Weekday"
    assert customers[0]["memberTiersSeen"] == ["Weekday"]
    assert customers[0]["isMember"] is True


def test_dry_run_leaves_file_untouched_then_apply_is_idempotent(tmp_path):
    source = tmp_path / "export.csv"
    header = list(row().keys())
    lines = [",".join(header), ",".join(row()[k] for k in header)]
    source.write_text("\n".join(lines), encoding="utf-8")
    target = Path(store.data_file())

    before = target.read_text(encoding="utf-8")
    assert module.run(source)["customersInSource"] == 1
    assert target.read_text(encoding="utf-8") == before, "dry-run 은 쓰면 안 된다"

    applied = module.run(source, apply=True)
    assert applied["newCustomers"] == 1 and applied["changed"] is True
    assert Path(applied["backup"]).read_text(encoding="utf-8") == before
    assert len(json.loads(target.read_text(encoding="utf-8"))) == 1

    assert module.run(source, apply=True)["changed"] is False, "재실행이 값을 바꾸면 안 된다"


def test_rejects_export_from_another_club(tmp_path):
    source = tmp_path / "other.csv"
    header = list(row().keys())
    other = row(**{"Club Name": "Some Other Club"})
    source.write_text(",".join(header) + "\n" + ",".join(other[k] for k in header),
                      encoding="utf-8")
    with pytest.raises(ValueError, match="Unexpected club"):
        module.run(source)


def test_store_never_seeds_fabricated_people():
    assert store.seed_customers() == []
    assert store.reset() == []
