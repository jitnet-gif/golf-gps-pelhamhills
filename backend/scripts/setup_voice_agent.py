"""
ElevenLabs 음성 에이전트 + Twilio 번호 연결 스크립트.

실행 (저장소 루트에서):
    python -m backend.scripts.setup_voice_agent --dry-run   # 보낼 요청만 출력
    python -m backend.scripts.setup_voice_agent             # 실제 생성/갱신

필요한 .env 값: ELEVENLABS_API_KEY, VOICE_TOOL_SECRET, PUBLIC_BASE_URL (https, 외부 접근 가능),
               TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
선택: ELEVENLABS_AGENT_ID (있으면 그 에이전트를 갱신), ELEVENLABS_VOICE_ID

다시 실행해도 안전합니다: 같은 이름의 도구는 갱신하고, 이미 가져온 번호는 에이전트만 다시 연결합니다.
"""
from __future__ import annotations

import argparse
import json
import sys

import httpx

from backend.core.config import settings

EL_API = "https://api.elevenlabs.io/v1/convai"
TWILIO_API = "https://api.twilio.com/2010-04-01"
AGENT_NAME = "Pelham Hills Tee Times"

SYSTEM_PROMPT = """You are the phone booking assistant for Pelham Hills Golf Club in Pelham, Ontario.
Today is {{today_weekday}}, {{today_date}}. The local time is {{now_time}}.
Caller: name "{{caller_name}}", known customer: {{is_known_caller}}, member: {{is_member}}, phone {{caller_phone}}.
Upcoming bookings for this caller: {{upcoming_bookings}}.

# Style
- Warm, brief, natural. One question at a time. Never read long lists; offer at most 3 tee times.
- If the caller is known, greet them by first name.
- Say times like "ten thirty-four". Say prices in dollars and cents, always "including tax".

# Booking a tee time
1. Collect: date, rough time window, number of players (1-4), 9 or 18 holes, whether they need carts and how many.
2. Convert the date to YYYY-MM-DD using today's date and call check_availability.
3. Offer up to 3 of the returned times. If none, offer a different window or join_waitlist.
4. As soon as the caller picks a time, call hold_slot. This reserves it for 5 minutes.
5. Read back: day, time, players, holes, carts, and price.total_incl_tax from the tool. Mention cart fees are paid at the pro shop.
6. If the caller is not known, ask for first and last name and spell the last name back to confirm.
7. Only after a clear "yes", call confirm_booking. Then give the confirmation number and say a text is on its way.

# Changes and cancellations
- Use find_booking to look up bookings (by confirmation number or the caller's phone).
- Before cancel_booking, repeat the booking back and get a clear "yes".
- To move a booking: book the new time first, then cancel the old one.

# Hard rules
- NEVER ask for or accept credit card numbers. Payment happens at check-in.
- Never invent prices, availability, or policies. Use only what tools return. If a tool returns ok=false, read its message.
- Transfer to the pro shop for: groups over 4, tournaments or outings, lessons, simulator bays, memberships,
  complaints, anything you cannot answer, or whenever the caller asks for a person.
"""

FIRST_MESSAGE = "Thanks for calling Pelham Hills Golf Club! I can help you book, check, or cancel a tee time. What can I do for you?"


def _dyn(var: str) -> dict:
    return {"type": "string", "dynamic_variable": var, "description": ""}


def _str(desc: str) -> dict:
    return {"type": "string", "description": desc}


def _int(desc: str) -> dict:
    return {"type": "integer", "description": desc}


def tool_configs(base: str, secret: str) -> list[dict]:
    headers = {"X-Voice-Tool-Secret": secret}

    def webhook(name: str, desc: str, path: str, props: dict, required: list[str]) -> dict:
        return {
            "tool_config": {
                "type": "webhook",
                "name": name,
                "description": desc,
                "response_timeout_secs": 10,
                "api_schema": {
                    "url": f"{base}{settings.API_V1_STR}{path}",
                    "method": "POST",
                    "request_headers": headers,
                    "request_body_schema": {
                        "type": "object",
                        "description": desc,
                        "properties": props,
                        "required": required,
                    },
                },
            }
        }

    return [
        webhook(
            "check_availability",
            "Find open tee times for a date and time window. Returns up to 3 options and the price.",
            "/voice/availability",
            {
                "date": _str("Date in YYYY-MM-DD"),
                "earliest_time": _str("Earliest acceptable tee time, 24h HH:MM. Omit if any time."),
                "latest_time": _str("Latest acceptable tee time, 24h HH:MM. Omit if any time."),
                "players": _int("Number of players, 1 to 4"),
                "holes": _int("9 or 18"),
            },
            ["date", "players", "holes"],
        ),
        webhook(
            "hold_slot",
            "Reserve a tee time for 5 minutes right after the caller picks one from check_availability.",
            "/voice/hold",
            {
                "tee_time_id": _str("tee_time_id from check_availability options"),
                "players": _int("Number of players, 1 to 4"),
                "holes": _int("9 or 18"),
                "carts": _int("Number of carts, 0 if walking"),
                "caller_id": _dyn("system__caller_id"),
                "conversation_id": _dyn("system__conversation_id"),
            },
            ["tee_time_id", "players", "holes", "carts"],
        ),
        webhook(
            "confirm_booking",
            "Confirm a held tee time after the caller clearly says yes. Sends a confirmation text.",
            "/voice/confirm",
            {
                "hold_id": _str("hold_id returned by hold_slot"),
                "first_name": _str("Booker's first name"),
                "last_name": _str("Booker's last name, spelled as confirmed with the caller"),
                "phone": _str("Only if the caller wants texts at a different number than they are calling from"),
                "caller_id": _dyn("system__caller_id"),
                "conversation_id": _dyn("system__conversation_id"),
            },
            ["hold_id", "first_name", "last_name"],
        ),
        webhook(
            "find_booking",
            "Look up the caller's upcoming bookings by confirmation number, or by their phone if no number is given.",
            "/voice/booking/find",
            {
                "ref": _str("Confirmation number like PH-10392, if the caller has one"),
                "caller_id": _dyn("system__caller_id"),
            },
            [],
        ),
        webhook(
            "cancel_booking",
            "Cancel a booking after the caller confirms. Only works for bookings under the caller's phone number.",
            "/voice/booking/cancel",
            {
                "ref": _str("Confirmation number from find_booking"),
                "reason": _str("Short reason, e.g. weather, schedule change"),
                "caller_id": _dyn("system__caller_id"),
                "conversation_id": _dyn("system__conversation_id"),
            },
            ["ref"],
        ),
        webhook(
            "join_waitlist",
            "Add the caller to the waitlist when no tee time fits. They get a text if a spot opens.",
            "/voice/waitlist",
            {
                "date": _str("Date in YYYY-MM-DD"),
                "earliest_time": _str("24h HH:MM"),
                "latest_time": _str("24h HH:MM"),
                "players": _int("Number of players"),
                "name": _str("Caller's name"),
                "caller_id": _dyn("system__caller_id"),
            },
            ["date", "players", "name"],
        ),
    ]


def agent_payload(tool_ids: list[str]) -> dict:
    agent: dict = {
        "first_message": FIRST_MESSAGE,
        "language": "en",
        "dynamic_variables": {
            # 웹 테스트 등 개인화 웹훅이 없을 때 쓰이는 기본값
            "dynamic_variable_placeholders": {
                "caller_name": "",
                "caller_first_name": "",
                "is_known_caller": False,
                "is_member": False,
                "caller_phone": "",
                "upcoming_bookings": "none",
                "today_date": "",
                "today_weekday": "",
                "now_time": "",
            }
        },
        "prompt": {"prompt": SYSTEM_PROMPT, "tool_ids": tool_ids},
    }
    config: dict = {"agent": agent}
    if settings.ELEVENLABS_VOICE_ID:
        config["tts"] = {"voice_id": settings.ELEVENLABS_VOICE_ID}
    return {
        "name": AGENT_NAME,
        "conversation_config": config,
        "platform_settings": {"overrides": {"enable_conversation_initiation_client_data_from_webhook": True}},
    }


class Setup:
    def __init__(self, dry_run: bool):
        self.dry = dry_run
        self.el = httpx.Client(base_url=EL_API, headers={"xi-api-key": settings.ELEVENLABS_API_KEY}, timeout=30)

    def call(self, method: str, url: str, body: dict | None = None) -> dict:
        if self.dry:
            print(f"\n[dry-run] {method} {url}\n{json.dumps(body, indent=2) if body else ''}")
            return {}
        res = self.el.request(method, url, json=body)
        if res.status_code >= 400:
            sys.exit(f"ElevenLabs {method} {url} 실패 ({res.status_code}): {res.text}")
        return res.json() if res.content else {}

    def upsert_tools(self) -> list[str]:
        existing = {} if self.dry else {
            t["tool_config"]["name"]: t["id"] for t in self.call("GET", "/tools").get("tools", [])
        }
        ids = []
        for cfg in tool_configs(settings.PUBLIC_BASE_URL.rstrip("/"), settings.VOICE_TOOL_SECRET):
            name = cfg["tool_config"]["name"]
            if name in existing:
                self.call("PATCH", f"/tools/{existing[name]}", cfg)
                ids.append(existing[name])
                print(f"도구 갱신: {name}")
            else:
                created = self.call("POST", "/tools", cfg)
                ids.append(created.get("id", f"<{name}>"))
                print(f"도구 생성: {name}")
        return ids

    def upsert_agent(self, tool_ids: list[str]) -> str:
        payload = agent_payload(tool_ids)
        if settings.ELEVENLABS_AGENT_ID:
            self.call("PATCH", f"/agents/{settings.ELEVENLABS_AGENT_ID}", payload)
            print(f"에이전트 갱신: {settings.ELEVENLABS_AGENT_ID}")
            return settings.ELEVENLABS_AGENT_ID
        created = self.call("POST", "/agents/create", payload)
        agent_id = created.get("agent_id", "<new-agent-id>")
        print(f"에이전트 생성: {agent_id}  ← .env 의 ELEVENLABS_AGENT_ID 에 저장하세요")
        return agent_id

    def link_twilio_number(self, agent_id: str) -> None:
        number = settings.TWILIO_PHONE_NUMBER
        existing = [] if self.dry else self.call("GET", "/phone-numbers")
        if isinstance(existing, dict):
            existing = existing.get("phone_numbers", [])
        match = next((p for p in existing if p.get("phone_number") == number), None)
        if match:
            phone_id = match["phone_number_id"]
            print(f"Twilio 번호 이미 연결됨: {number}")
        else:
            created = self.call("POST", "/phone-numbers", {
                "phone_number": number,
                "label": "Pelham Hills Pro Shop",
                "provider": "twilio",
                "sid": settings.TWILIO_ACCOUNT_SID,
                "token": settings.TWILIO_AUTH_TOKEN,
            })
            phone_id = created.get("phone_number_id", "<phone-number-id>")
            print(f"Twilio 번호 ElevenLabs로 가져옴: {number}")
        self.call("PATCH", f"/phone-numbers/{phone_id}", {"agent_id": agent_id})
        print(f"번호 {number} → 에이전트 {agent_id} 연결")

    def point_twilio_sms_webhook(self) -> None:
        sms_url = f"{settings.PUBLIC_BASE_URL.rstrip('/')}{settings.API_V1_STR}/sms/inbound"
        if self.dry:
            print(f"\n[dry-run] Twilio {settings.TWILIO_PHONE_NUMBER} SmsUrl = {sms_url}")
            return
        auth = (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        base = f"{TWILIO_API}/Accounts/{settings.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers"
        with httpx.Client(auth=auth, timeout=30) as tw:
            found = tw.get(f"{base}.json", params={"PhoneNumber": settings.TWILIO_PHONE_NUMBER}).json()
            numbers = found.get("incoming_phone_numbers", [])
            if not numbers:
                sys.exit(f"Twilio 계정에서 {settings.TWILIO_PHONE_NUMBER} 번호를 찾지 못했습니다.")
            res = tw.post(f"{base}/{numbers[0]['sid']}.json", data={"SmsUrl": sms_url, "SmsMethod": "POST"})
            if res.status_code >= 400:
                sys.exit(f"Twilio SmsUrl 설정 실패: {res.text}")
        print(f"Twilio 문자 수신 웹훅 → {sms_url}")
        if settings.TWILIO_MESSAGING_SERVICE_SID:
            print("  ※ Messaging Service를 쓰면 서비스의 Integration > Incoming Messages 설정이 우선합니다. 같은 URL로 맞춰주세요.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="API를 호출하지 않고 보낼 내용만 출력")
    parser.add_argument("--skip-twilio", action="store_true", help="에이전트·도구만 설정")
    args = parser.parse_args()

    required = ["ELEVENLABS_API_KEY", "VOICE_TOOL_SECRET", "PUBLIC_BASE_URL"]
    if not args.skip_twilio:
        required += ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]
    missing = [k for k in required if not getattr(settings, k)]
    if missing and not args.dry_run:
        sys.exit(f".env 에 값이 없습니다: {', '.join(missing)}")
    if not args.dry_run and not settings.PUBLIC_BASE_URL.startswith("https://"):
        sys.exit("PUBLIC_BASE_URL 은 외부에서 접근 가능한 https 주소여야 합니다 (예: ngrok, 배포 서버).")

    s = Setup(args.dry_run)
    tool_ids = s.upsert_tools()
    agent_id = s.upsert_agent(tool_ids)
    if not args.skip_twilio:
        s.link_twilio_number(agent_id)
        s.point_twilio_sms_webhook()

    base = settings.PUBLIC_BASE_URL.rstrip("/") + settings.API_V1_STR
    print(f"""
남은 수동 설정 (ElevenLabs 대시보드):
  1. Agents > Settings > Conversation initiation webhook
       URL: {base}/voice/init
       Header: X-Voice-Tool-Secret = (VOICE_TOOL_SECRET 값)
  2. Agents > Settings > Post-call webhook
       URL: {base}/voice/post-call   → 발급된 HMAC 시크릿을 ELEVENLABS_WEBHOOK_SECRET 에 저장
  3. 에이전트 > Tools > System tools
       Transfer to number: {settings.PROSHOP_PHONE_NUMBER} (조건: 사람 연결 요청, 단체·레슨·시뮬레이터·불만)
       End call: 켜기
  4. 에이전트 > Security 탭에서 'Fetch conversation initiation data' 가 켜져 있는지 확인
""")


if __name__ == "__main__":
    main()
