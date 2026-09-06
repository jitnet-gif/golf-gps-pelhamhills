import logging
import httpx
from typing import Any, Dict, List
from backend.core.config import settings

logger = logging.getLogger(__name__)

class DirectSupabaseClient:
    """
    supabase 파이썬 버전을 우회하여 REST API (PostgREST)로 직접 통신하는 비동기 클라이언트
    Service Role Key를 사용하여 백엔드 권한으로 동작합니다.
    """
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.key = key
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"  # INSERT 완료 후 생성된 데이터를 리턴받음
        }
        logger.info(f"Direct Supabase HTTP Client 초기화 (URL: {self.url})")

    async def insert(self, table_name: str, data: Dict[str, Any] | List[Dict[str, Any]]) -> Any:
        # 단일 Dict 인 경우 리스트로 변환
        insert_data = [data] if isinstance(data, dict) else data

        async with httpx.AsyncClient(timeout=5.0) as client:
            endpoint = f"{self.url}/rest/v1/{table_name}"
            
            try:
                logger.info(f"DB INSERT 시도: {endpoint}")
                response = await client.post(endpoint, headers=self.headers, json=insert_data)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                logger.error(f"[{table_name}] DB INSERT HTTP 에러(Status {e.response.status_code}): {e.response.text}")
                raise e
            except httpx.TimeoutException:
                logger.error(f"[{table_name}] DB INSERT 타임아웃 발생 (5.0s)")
                raise Exception("Database connection timeout")
            except Exception as e:
                logger.error(f"[{table_name}] DB INSERT 알 수 없는 에러: {e}")
                raise e

    async def select_eq(self, table_name: str, column: str, value: Any, order_by: str = "created_at", ascending: bool = True) -> List[Dict[str, Any]]:
        """
        특정 컬럼 값이 일치(eq)하는 레코드들을 조회합니다.
        기본적으로 created_at 오름차순으로 정렬합니다.
        """
        async with httpx.AsyncClient() as client:
            endpoint = f"{self.url}/rest/v1/{table_name}"
            params = {
                f"{column}": f"eq.{value}",
                "order": f"{order_by}.{'asc' if ascending else 'desc'}"
            }
            
            # Select용 헤더 (Prefer 생략 가능, 기본 GET 동작)
            get_headers = {
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json"
            }
            
            try:
                response = await client.get(endpoint, headers=get_headers, params=params)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                logger.error(f"[{table_name}] DB SELECT HTTP 에러: {e.response.text}")
                return []
            except Exception as e:
                logger.error(f"[{table_name}] DB SELECT 알 수 없는 에러: {e}")
                return []

# 전역 클라이언트 인스턴스
if settings.NEXT_PUBLIC_SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
    supabase_admin = DirectSupabaseClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
else:
    logger.warning("Supabase 자격 증명이 없어 DB 클라이언트가 None이 되었습니다.")
    supabase_admin = None

def get_supabase_admin() -> DirectSupabaseClient:
    if not supabase_admin:
        raise ValueError("Supabase 클라이언트가 설정되지 않았습니다.")
    return supabase_admin
