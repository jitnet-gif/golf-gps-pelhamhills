"""문자 예약 비서 테스트: 키워드 라우팅, 도구 연결, 발신번호 고정, 실패 시 고정 답장.

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_sms_booking.py -q`

Claude 는 부르지 않는다. 대본대로 도구 호출을 내놓는 가짜 클라이언트를 끼운다 —
여기서 확인하는 것은 모델의 판단이 아니라, 모델이 무엇을 부르든 **우리 쪽이 지키는 선**
(번호는 발신번호, 잡기와 확정은 한 번에, 실패하면 손님에게 알린다)이다.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from backend.api.routes import sms
from backend.api.routes import tee_sheet as ts
from backend.services import sms_agent, twilio_sms
from backend.services.tee_sheet_store import Scope
from backend.tests.test_voice_booking import API, TOMORROW, book, client, find  # noqa: F401

SENDER = "+19058921234"


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    twilio_sms.sms_messages.clear()
    twilio_sms.opted_out.clear()
    sms_agent.reset()
    yield
    twilio_sms.sms_messages.clear()
    twilio_sms.opted_out.clear()
    sms_agent.reset()
    monkeypatch.setattr(sms_agent, "_client", None)


# ===== 가짜 Claude =====================================================

def tool_call(name: str, **args):
    return SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(type="tool_use", id=f"tu_{name}", name=name, input=args)],
    )


def says(text: str):
    return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)])


class Scripted:
    """`client.beta.messages.create` 자리에 앉아 정해 둔 응답을 차례로 내놓는다."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests: list[dict] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    async def create(self, **kwargs):
        # 기록은 덧붙이기만 하므로 이 시점의 사본을 남겨야 나중에 비교할 수 있다.
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        return self.responses.pop(0)


def install(monkeypatch, *responses) -> Scripted:
    fake = Scripted(*responses)
    monkeypatch.setattr(sms_agent, "_client", fake)
    return fake


def run(text: str, sender: str = SENDER) -> None:
    asyncio.run(sms_agent.handle_text(sender, text))


def replies() -> list[str]:
    return [m.body for m in twilio_sms.sms_messages if m.template == "assistant"]


def tool_results(fake: Scripted, index: int) -> list[dict]:
    return fake.requests[index]["messages"][-1]["content"]


# ===== 예약 ========================================================

def test_text_books_a_tee_time_to_the_sender_number(client, monkeypatch):
    time = find(client).json()["options"][0]["time"]
    fake = install(
        monkeypatch,
        tool_call("book_tee_time", date=TOMORROW, time=time, party_size=2, first_name="Dana", last_name="Lee"),
        says("You're booked for 2 tomorrow at " + time + "."),
    )

    run(f"Book {time} tomorrow for 2, Dana Lee")

    result = tool_results(fake, 1)[0]
    assert result["is_error"] is False
    assert "booking_id" not in result["content"]  # 내부 id 는 모델에게 보이지 않는다
    booked = [
        b for b in ts.read_bookings(Scope(dates={TOMORROW}))
        if b.source == ts.BookingSource.VOICE and b.time == time
    ]
    assert len(booked) == 1
    assert booked[0].players[0].phone == SENDER
    assert "text message" in booked[0].notes
    assert len(booked[0].players) == 2
    # 확인 문자(코드)가 먼저, 그다음 비서 답장
    templates = [m.template for m in reversed(twilio_sms.sms_messages)]
    assert templates == ["confirm", "assistant"]
    assert replies() == [f"You're booked for 2 tomorrow at {time}."]


def test_model_cannot_book_to_another_number(client, monkeypatch):
    """스키마에 번호 칸이 없다. 모델이 끼워 넣어도 무시되고 발신번호로 예약된다."""
    time = find(client).json()["options"][0]["time"]
    fake = install(
        monkeypatch,
        tool_call(
            "book_tee_time", date=TOMORROW, time=time, party_size=1,
            first_name="Dana", last_name="Lee", phone="2895550000",
        ),
        says("Sorry, something went wrong."),
    )

    run("book it")

    assert tool_results(fake, 1)[0]["is_error"] is False
    booked = [b for b in ts.read_bookings(Scope(dates={TOMORROW})) if b.time == time]
    assert [b.players[0].phone for b in booked] == [SENDER]


def test_taken_time_releases_nothing_and_reports_back(client, monkeypatch):
    time = find(client).json()["options"][0]["time"]
    for _ in range(2):
        book(client, time=time, party=2)  # 4명 정원이 찼다
    fake = install(
        monkeypatch,
        tool_call("book_tee_time", date=TOMORROW, time=time, party_size=2, first_name="Dana", last_name="Lee"),
        says("That one just went. 9:00 AM is open."),
    )

    run(f"{time} please")

    result = tool_results(fake, 1)[0]
    assert result["is_error"] is True
    holds = [b for b in ts.read_bookings(Scope(dates={TOMORROW}, holds=True)) if b.source == ts.BookingSource.VOICE_HOLD]
    assert holds == []


def test_find_tool_is_wired_through(client, monkeypatch):
    fake = install(
        monkeypatch,
        tool_call("find_tee_times", date="tomorrow", party_size=2, day_part="morning"),
        says("I have a few morning times."),
    )

    run("Anything tomorrow morning for 2?")

    result = tool_results(fake, 1)[0]
    assert result["is_error"] is False
    assert TOMORROW in result["content"]
    # 날짜 메모가 손님 문자 앞에 붙는다 (모델은 오늘 날짜를 모른다)
    first = fake.requests[0]["messages"][0]["content"]
    assert first.startswith("[Today at the club is Tuesday 2026-09-08")


def test_conversation_continues_across_texts(client, monkeypatch):
    fake = install(monkeypatch, says("How many players?"), says("Morning or afternoon?"))

    run("Can I get a tee time tomorrow?")
    run("2 of us")

    second = fake.requests[1]["messages"]
    assert [m["role"] for m in second] == ["user", "assistant", "user"]


# ===== 실패하면 손님에게 알린다 =====================================

def test_api_error_sends_the_fixed_reply(client, monkeypatch):
    class Broken:
        beta = SimpleNamespace(messages=SimpleNamespace(create=None))

        async def _fail(**_):
            raise RuntimeError("boom")

        beta.messages.create = _fail

    monkeypatch.setattr(sms_agent, "_client", Broken())

    run("tee time saturday?")

    assert replies() == [sms_agent.fallback_reply()]
    assert SENDER not in sms_agent._conversations  # 다음 문자는 새로 시작


def test_refusal_sends_the_fixed_reply(client, monkeypatch):
    install(monkeypatch, SimpleNamespace(stop_reason="refusal", content=[], stop_details=None))

    run("hello")

    assert replies() == [sms_agent.fallback_reply()]


def test_daily_cap_per_sender(client, monkeypatch):
    monkeypatch.setattr(sms_agent, "MAX_TEXTS_PER_SENDER_PER_DAY", 1)
    fake = install(monkeypatch, says("Hi!"))

    run("hi")
    run("hi again")

    assert len(fake.requests) == 1
    assert replies()[0] == sms_agent.fallback_reply()  # 기록은 최신이 앞


def test_runaway_tool_loop_is_cut_off(client, monkeypatch):
    monkeypatch.setattr(sms_agent, "MAX_ROUNDS_PER_TEXT", 2)
    install(monkeypatch, *[tool_call("find_tee_times", date="tomorrow", party_size=1)] * 2)

    run("loop")

    assert replies() == [sms_agent.fallback_reply()]


# ===== 키워드 라우팅 ===============================================

def _inbound(client, monkeypatch, body: str):
    monkeypatch.setattr(sms, "_twilio_params", _fake_params(body))
    client.app.include_router(sms.router, prefix=API)
    return client.post(f"{API}/sms/inbound", data={})


def _fake_params(body: str):
    async def params(_request):
        return {"From": SENDER, "To": "+12495550000", "Body": body, "MessageSid": "SM1"}

    return params


def test_free_text_goes_to_the_assistant_when_enabled(client, monkeypatch):
    monkeypatch.setenv("SMS_BOOKING_ENABLED", "1")
    monkeypatch.setattr(sms_agent.settings, "ANTHROPIC_API_KEY", "test-key")
    install(monkeypatch, says("Sure, which day?"))

    res = _inbound(client, monkeypatch, "Yes")  # 비서 질문에 대한 대답. 수신 재개가 아니다.

    assert res.status_code == 200
    assert "<Message>" not in res.text  # 답장은 REST 로 따로 간다
    assert replies() == ["Sure, which day?"]


def test_sentence_starting_with_cancel_does_not_opt_out(client, monkeypatch):
    monkeypatch.setenv("SMS_BOOKING_ENABLED", "1")
    monkeypatch.setattr(sms_agent.settings, "ANTHROPIC_API_KEY", "test-key")
    install(monkeypatch, says("Reply C and your code to cancel."))

    _inbound(client, monkeypatch, "Cancel my 9am please")

    assert SENDER not in twilio_sms.opted_out
    assert replies() == ["Reply C and your code to cancel."]


def test_bare_stop_still_opts_out(client, monkeypatch):
    _inbound(client, monkeypatch, "Stop.")

    assert SENDER in twilio_sms.opted_out


def test_yes_restarts_texts_only_for_someone_who_opted_out(client, monkeypatch):
    twilio_sms.opted_out.add(SENDER)

    _inbound(client, monkeypatch, "YES")

    assert SENDER not in twilio_sms.opted_out


def test_cancel_code_reply_still_cancels(client, monkeypatch):
    monkeypatch.setenv("SMS_BOOKING_ENABLED", "1")
    monkeypatch.setattr(sms_agent.settings, "ANTHROPIC_API_KEY", "test-key")
    fake = install(monkeypatch)
    booking = book(client)

    res = _inbound(client, monkeypatch, f"C {booking['confirmation_code']}")

    assert "cancelled" in res.text
    assert fake.requests == []  # 취소는 비서를 거치지 않는다


def test_assistant_off_keeps_the_old_reply(client, monkeypatch):
    fake = install(monkeypatch)

    res = _inbound(client, monkeypatch, "Can I book Saturday?")

    assert "reply C and your code to cancel" in res.text
    assert fake.requests == []


def test_key_alone_does_not_turn_it_on(monkeypatch):
    monkeypatch.setattr(sms_agent.settings, "ANTHROPIC_API_KEY", "test-key")

    assert sms_agent.enabled() is False


# ===== 검토에서 나온 선 =============================================

def test_identify_never_reveals_the_last_name(client, monkeypatch):
    """성은 전화 조회·취소의 두 번째 열쇠다. 문자 한 통으로 내주면 안 된다."""
    from backend.services import customer_lookup

    monkeypatch.setattr(
        customer_lookup, "find_by_phone",
        lambda _phone: customer_lookup.Caller(first_name="Daniel", last_name="Okafor"),
    )
    fake = install(monkeypatch, tool_call("identify_texter"), says("Hi Daniel!"))

    run("hi")

    result = tool_results(fake, 1)[0]
    assert "Daniel" in result["content"]
    assert "Okafor" not in result["content"]


def test_stop_at_the_start_of_a_sentence_opts_out(client, monkeypatch):
    _inbound(client, monkeypatch, "Stop texting me")

    assert SENDER in twilio_sms.opted_out


def test_opted_out_sender_does_not_reach_the_assistant(client, monkeypatch):
    """예약은 되는데 확인 문자도 답장도 못 받는 일이 없게 한다."""
    monkeypatch.setenv("SMS_BOOKING_ENABLED", "1")
    monkeypatch.setattr(sms_agent.settings, "ANTHROPIC_API_KEY", "test-key")
    fake = install(monkeypatch)
    twilio_sms.opted_out.add(SENDER)

    _inbound(client, monkeypatch, "book 9:10 saturday for 2")

    assert fake.requests == []


def test_one_number_cannot_fill_the_sheet(client, monkeypatch):
    monkeypatch.setattr(sms_agent, "MAX_BOOKINGS_PER_SENDER_PER_DAY", 1)
    first, second = find(client).json()["options"][:2]
    fake = install(
        monkeypatch,
        tool_call("book_tee_time", date=TOMORROW, time=first["time"], party_size=1, first_name="A", last_name="B"),
        tool_call("book_tee_time", date=TOMORROW, time=second["time"], party_size=1, first_name="A", last_name="B"),
        says("Done."),
    )

    run("book two")

    assert tool_results(fake, 1)[0]["is_error"] is False
    assert tool_results(fake, 2)[0]["is_error"] is True
    assert "pro shop" in tool_results(fake, 2)[0]["content"]


def test_reply_is_kept_to_plain_characters(client, monkeypatch):
    """둥근 따옴표 하나가 문자 전체를 70자 단위(UCS-2)로 바꾼다."""
    install(monkeypatch, says("You’re set — see you at 9:10 AM…"))

    run("thanks")

    assert replies() == ["You're set - see you at 9:10 AM..."]
