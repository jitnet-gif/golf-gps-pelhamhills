"""전화번호로 고객 한 명을 찾는다. 음성 에이전트의 인사말에만 쓴다.

⚠️ **이것은 인증이 아니다.** 발신번호는 위조할 수 있다. 여기서 찾은 결과로
예약을 보여주거나 취소 권한(`_Session.revealed`)을 주면 안 된다 — 번호를 흉내 낸
사람이 남의 라운드를 지울 수 있다. 조회와 취소는 지금처럼 **번호 + 성** 두 열쇠를
계속 요구한다. 이 모듈이 하는 일은 "대니얼님, 안녕하세요" 라고 부를 수 있게 해 주는
것뿐이다.

읽는 곳은 `pelham_customers` — `scripts/import_customers_export.py` 가 채운 표다.
설정(프로젝트 주소와 service_role 키)은 `tee_sheet_supabase` 의 것을 **그대로**
빌려 쓴다. 여기서 환경변수를 다시 읽으면 두 표가 서로 다른 프로젝트를 가리키는
사고가 날 수 있다 — 한 벌만 둔다.
"""

from __future__ import annotations

import logging
import re
from typing import Any

# 같은 패키지 안에서 설정과 클라이언트를 공유하기 위한 의도적인 비공개 이름 사용.
# 위 docstring 참고 — 설정을 두 벌로 만들지 않기 위해서다.
from backend.services.tee_sheet_supabase import _client, configured

logger = logging.getLogger(__name__)

TABLE = "pelham_customers"

__all__ = ["Caller", "find_by_phone", "normalize_phone"]


class Caller:
    """인사말에 쓸 만큼만 담는다. 주소·생년월일 같은 건 일부러 들고 오지 않는다."""

    __slots__ = ("first_name", "last_name", "is_member", "player_type", "rounds", "ambiguous")

    def __init__(
        self,
        first_name: str = "",
        last_name: str = "",
        is_member: bool = False,
        player_type: str = "",
        rounds: int = 0,
        ambiguous: bool = False,
    ) -> None:
        self.first_name = first_name
        self.last_name = last_name
        self.is_member = is_member
        self.player_type = player_type
        self.rounds = rounds
        #: 같은 번호에 사람이 둘 이상이면 True. 이름을 부르면 안 된다.
        self.ambiguous = ambiguous

    @property
    def display(self) -> str:
        return " ".join(p for p in (self.first_name, self.last_name) if p)


def normalize_phone(value: str) -> str:
    """숫자만 남기고 뒤에서 10자리. `voice.normalize_phone` 과 같은 규칙이다."""
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else digits


def find_by_phone(value: str) -> Caller | None:
    """번호로 고객을 찾는다. 못 찾거나 Supabase 가 없으면 None.

    **한 번호에 여러 명이면 `ambiguous=True` 로 돌려준다.** 소스에 부부가 유선
    하나를 같이 쓰는 행이 여럿 있다 (Hagar, Allison, Lyu). 아무나 골라서 이름을
    부르면 남의 이름으로 인사하게 된다. 그럴 바엔 이름 없이 인사하는 편이 낫다.
    """
    phone = normalize_phone(value)
    if not phone or not configured():
        return None

    try:
        with _client() as client:
            res = client.get(
                f"/rest/v1/{TABLE}",
                params={
                    "select": "first_name,last_name,is_member,player_type,rounds_booked_played",
                    "phone": f"eq.{phone}",
                    "limit": "3",
                },
            )
            res.raise_for_status()
            rows: list[dict[str, Any]] = res.json()
    except Exception as exc:
        # 고객을 못 찾는 것은 통화를 멈출 이유가 아니다. 이름 없이 인사하면 된다.
        # 응답 본문에는 개인정보가 들어 있으므로 예외 종류만 남긴다.
        logger.warning("고객 조회 실패 (%s). 이름 없이 진행한다.", type(exc).__name__)
        return None

    if not rows:
        return None

    row = rows[0]
    return Caller(
        first_name=(row.get("first_name") or "").strip(),
        last_name=(row.get("last_name") or "").strip(),
        is_member=bool(row.get("is_member")),
        player_type=(row.get("player_type") or "").strip(),
        rounds=int(row.get("rounds_booked_played") or 0),
        ambiguous=len(rows) > 1,
    )
