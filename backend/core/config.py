import os
import sys
from typing import Optional

# 프로젝트 최상단 디렉토리(AI-SERVIO)를 Python 경로에 추가
# 이 파일이 backend/core/config.py 에 위치함을 전제
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env 파일 위치 찾기 (현재 파일에서 위로 올라가며 .env를 찾음)
def find_env_file():
    current = os.path.abspath(__file__)
    for _ in range(5): # 최대 5단계 위까지 검색
        current = os.path.dirname(current)
        potential = os.path.join(current, ".env")
        if os.path.exists(potential):
            return potential
    return None

env_path = find_env_file()
sys.stderr.write(f"🔍 [DEBUG] Resolved .env path: {env_path}\n")

if env_path:
    load_dotenv(env_path, override=True)
    sys.stderr.write(f"✅ [DEBUG] load_dotenv called with override=True\n")
else:
    sys.stderr.write(f"❌ [DEBUG] .env file NOT FOUND in ancestors!\n")

class Settings(BaseSettings):
    # (나머지 코드는 동일하게 유지)
    PROJECT_NAME: str = "BEPU API"
    API_V1_STR: str = "/api/v1"
    
    # Supabase (DB & Auth)
    NEXT_PUBLIC_SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""
    
    # AI (Claude API)
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_SONNET_MODEL: str = "claude-3-7-sonnet-20250219"
    CLAUDE_HAIKU_MODEL: str = "claude-3-5-haiku-20241022"
    
    # 임베딩 & 폴백 (OpenAI)
    OPENAI_API_KEY: str = ""
    OPENAI_API_KEYS: Optional[str] = None # 키가 여러개일 경우 (key1,key2,...)
    OPENAI_MODEL_MAIN: str = "gpt-4o"
    OPENAI_MODEL_FAST: str = "gpt-4o-mini"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # Google Gemini 모델 설정 (쉼표로 구분된 다중 키 지원)
    GOOGLE_API_KEY: str = ""  
    GEMINI_API_KEYS: Optional[str] = None # 키가 여러개일 경우 (key1,key2,...)
    GEMINI_MODEL_MAIN: str = "gemini-1.5-flash"
    GEMINI_MODEL_FAST: str = "gemini-1.5-flash"

    # Groq & Mistral (신규)
    GROQ_API_KEY: str = ""
    MISTRAL_API_KEY: str = ""
    GROQ_MODEL_MAIN: str = "llama-3.3-70b-versatile"
    GROQ_MODEL_FAST: str = "llama-3.1-8b-instant"
    
    # Perplexity & Copilot (신규)
    PERPLEXITY_API_KEY: str = ""
    COPILOT_API_KEY: str = "" # GitHub 또는 Azure Copilot 용

    ALLOWED_ORIGINS: str = "http://localhost:3000,https://bepu.app"

    @property
    def OPENAI_API_KEY_LIST(self) -> list[str]:
        if self.OPENAI_API_KEYS:
            return [k.strip() for k in self.OPENAI_API_KEYS.split(",") if k.strip()]
        return [self.OPENAI_API_KEY] if self.OPENAI_API_KEY else []

    @property
    def GOOGLE_API_KEY_LIST(self) -> list[str]:
        if self.GEMINI_API_KEYS:
            return [k.strip() for k in self.GEMINI_API_KEYS.split(",") if k.strip()]
        return [self.GOOGLE_API_KEY] if self.GOOGLE_API_KEY else []

    @property
    def ANTHROPIC_API_KEY_LIST(self) -> list[str]:
        # 향후 ANTHROPIC_API_KEYS 도 지원 가능하도록 확장성 확보
        return [self.ANTHROPIC_API_KEY] if self.ANTHROPIC_API_KEY else []

    @property
    def BACKEND_CORS_ORIGINS(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"),
        env_ignore_empty=True,
        extra="ignore"
    )

settings = Settings()

# 🔍 디버그용 출력 (서버 터미널에서 확인 가능)
sys.stderr.write(f"--- [DEBUG] Final Settings Check ---\n")
if not settings.NEXT_PUBLIC_SUPABASE_URL:
    sys.stderr.write("⚠️ [WARNING] NEXT_PUBLIC_SUPABASE_URL is EMPTY!\n")
else:
    sys.stderr.write(f"✅ [SUCCESS] Supabase URL: {settings.NEXT_PUBLIC_SUPABASE_URL[:20]}...\n")

if not settings.ANTHROPIC_API_KEY:
    sys.stderr.write("⚠️ [WARNING] ANTHROPIC_API_KEY is EMPTY!\n")
else:
    sys.stderr.write(f"✅ [SUCCESS] Anthropic Key: {settings.ANTHROPIC_API_KEY[:10]}...\n")

if not settings.OPENAI_API_KEY:
    sys.stderr.write("⚠️ [WARNING] OPENAI_API_KEY is EMPTY!\n")
else:
    sys.stderr.write(f"✅ [SUCCESS] OpenAI Key: {settings.OPENAI_API_KEY[:15]}...\n")

if not settings.GOOGLE_API_KEY:
    sys.stderr.write("⚠️ [WARNING] GOOGLE_API_KEY is EMPTY!\n")
else:
    sys.stderr.write(f"✅ [SUCCESS] Gemini Key: {settings.GOOGLE_API_KEY[:10]}...\n")

if not settings.GROQ_API_KEY:
    sys.stderr.write("⚠️ [WARNING] GROQ_API_KEY is EMPTY!\n")
else:
    sys.stderr.write(f"✅ [SUCCESS] Groq Key: {settings.GROQ_API_KEY[:10]}...\n")



