import sys
import os
import logging
from importlib import import_module
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

# 로깅 설정 (INFO 레벨 이상의 로그를 터미널로 출력)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# 프로젝트 내 모듈 임포트
from backend.core.config import settings

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="BEPU AI Assistant Backend API",
    version="1.0.0",
)

# CORS Middleware 설정 (프론트엔드 URL 접근 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def include_route_module(module_name: str, prefix: str, tags: list[str]) -> None:
    try:
        module = import_module(module_name)
        app.include_router(module.router, prefix=prefix, tags=tags)
    except Exception as exc:
        logger.error("라우터 등록 실패: %s (%s)", module_name, exc)


# 라우터 연결
include_route_module("backend.api.routes.tee_sheet", f"{settings.API_V1_STR}", ["Tee Sheet"])
include_route_module("backend.api.routes.chat", f"{settings.API_V1_STR}/chat", ["Chat"])
include_route_module("backend.api.routes.agents", f"{settings.API_V1_STR}/agents", ["Agents"])
include_route_module("backend.api.routes.onboarding", f"{settings.API_V1_STR}/onboarding", ["Onboarding"])

@app.get("/")
def read_root():
    """서버 헬스 체크 엔드포인트"""
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "message": "BEPU Backend is running smoothly 🐰"
    }

if __name__ == "__main__":
    import uvicorn
    # 로컬 테스트용 직접 실행 설정
    # 실행 예시: python backend/main.py
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
