"""
병렬 오케스트레이션을 위한 비동기 작업 처리

주요 기능:
- 예약 생성 시 이메일 발송
- 일일 리포트 생성
- 가격 책정 자동 업데이트
- 남은 시간 슬롯 정리
"""

import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
import logging

from .database import TeeTime, Reservation, PricingTemplate, async_session

logger = logging.getLogger(__name__)


class TeeSheetOrchestrator:
    """병렬 작업 오케스트레이션"""

    @staticmethod
    async def send_confirmation_email(
        email: str,
        customer_name: str,
        tee_time_info: Dict[str, Any]
    ) -> bool:
        """예약 확인 이메일 발송 (시뮬레이션)"""
        try:
            await asyncio.sleep(0.1)  # 실제 이메일 API 호출 시뮬레이션
            logger.info(f"Email sent to {email} for {customer_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to send email: {e}")
            return False

    @staticmethod
    async def send_reminder_email(
        reservations: List[Reservation]
    ) -> Dict[str, int]:
        """24시간 전 리마인더 이메일 발송"""
        results = {"sent": 0, "failed": 0}

        tasks = [
            TeeSheetOrchestrator.send_confirmation_email(
                r.customer_email,
                r.customer_name,
                {"time": r.tee_time_id}
            )
            for r in reservations
        ]

        responses = await asyncio.gather(*tasks, return_exceptions=True)

        for response in responses:
            if response is True:
                results["sent"] += 1
            else:
                results["failed"] += 1

        return results

    @staticmethod
    async def update_pricing_for_tee_times(
        course_id: int,
        date: datetime
    ) -> Dict[str, Any]:
        """특정 날짜의 가격 책정 업데이트"""
        async with async_session() as db:
            try:
                # 요일 확인
                day_of_week = date.weekday()
                is_weekend = day_of_week >= 5

                # 해당 날짜의 모든 티타임 조회
                result = await db.execute(
                    select(TeeTime).where(
                        and_(
                            TeeTime.course_id == course_id,
                            TeeTime.date >= date,
                            TeeTime.date < date + timedelta(days=1)
                        )
                    )
                )
                tee_times = result.scalars().all()

                # 가격 책정 템플릿 조회
                template_result = await db.execute(
                    select(PricingTemplate).where(
                        and_(
                            PricingTemplate.course_id == course_id,
                            PricingTemplate.start_date <= date,
                            PricingTemplate.end_date >= date,
                            PricingTemplate.is_active == True
                        )
                    )
                )
                template = template_result.scalar_one_or_none()

                if not template:
                    return {"status": "no_template"}

                # 가격 업데이트
                updated_count = 0
                for tee_time in tee_times:
                    if is_weekend:
                        tee_time.rate = template.weekend_rate
                        tee_time.category = "Weekend"
                    else:
                        tee_time.rate = template.weekday_rate
                        tee_time.category = "Weekday"

                    updated_count += 1

                await db.commit()

                return {
                    "status": "success",
                    "updated": updated_count,
                    "date": date.isoformat()
                }

            except Exception as e:
                logger.error(f"Pricing update failed: {e}")
                return {"status": "failed", "error": str(e)}

    @staticmethod
    async def generate_daily_report(
        course_id: int,
        date: datetime
    ) -> Dict[str, Any]:
        """일일 리포트 생성"""
        async with async_session() as db:
            try:
                result = await db.execute(
                    select(TeeTime).where(
                        and_(
                            TeeTime.course_id == course_id,
                            TeeTime.date >= date,
                            TeeTime.date < date + timedelta(days=1)
                        )
                    )
                )
                tee_times = result.scalars().all()

                total_slots = sum(tt.slots_available for tt in tee_times)
                booked_slots = sum(tt.slots_booked for tt in tee_times)
                available_slots = total_slots - booked_slots
                total_revenue = sum(tt.rate * tt.slots_booked for tt in tee_times)

                return {
                    "date": date.isoformat(),
                    "tee_times_count": len(tee_times),
                    "total_slots": total_slots,
                    "booked_slots": booked_slots,
                    "available_slots": available_slots,
                    "occupancy_rate": (booked_slots / total_slots * 100) if total_slots > 0 else 0,
                    "total_revenue": total_revenue
                }

            except Exception as e:
                logger.error(f"Report generation failed: {e}")
                return {"status": "failed", "error": str(e)}

    @staticmethod
    async def cleanup_expired_tee_times(course_id: int) -> Dict[str, int]:
        """지난 티타임 정리"""
        async with async_session() as db:
            try:
                now = datetime.utcnow()

                result = await db.execute(
                    select(TeeTime).where(
                        and_(
                            TeeTime.course_id == course_id,
                            TeeTime.date < now
                        )
                    )
                )
                expired_tee_times = result.scalars().all()

                deleted_count = 0
                for tt in expired_tee_times:
                    await db.delete(tt)
                    deleted_count += 1

                await db.commit()

                return {
                    "deleted": deleted_count,
                    "timestamp": now.isoformat()
                }

            except Exception as e:
                logger.error(f"Cleanup failed: {e}")
                return {"status": "failed", "error": str(e)}

    @staticmethod
    async def process_reservation_workflow(
        reservation_id: int,
        customer_email: str,
        customer_name: str,
        tee_time_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """예약 워크플로우 병렬 처리"""
        results = {}

        # 병렬로 실행할 작업들
        tasks = [
            TeeSheetOrchestrator.send_confirmation_email(
                customer_email,
                customer_name,
                tee_time_info
            ),
            asyncio.create_task(asyncio.sleep(0.05)),  # 다른 작업들 시뮬레이션
        ]

        responses = await asyncio.gather(*tasks, return_exceptions=True)

        results["email_sent"] = responses[0] if isinstance(responses[0], bool) else False

        return {
            "reservation_id": reservation_id,
            "status": "processed",
            "results": results,
            "timestamp": datetime.utcnow().isoformat()
        }

    @staticmethod
    async def batch_process_tee_times(
        course_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Any]:
        """배치 처리: 여러 날짜의 티타임 일괄 처리"""
        current_date = start_date
        results = {
            "processed_dates": 0,
            "total_updated": 0,
            "total_revenue": 0.0
        }

        tasks = []
        while current_date < end_date:
            tasks.append(
                TeeSheetOrchestrator.update_pricing_for_tee_times(
                    course_id,
                    current_date
                )
            )
            tasks.append(
                TeeSheetOrchestrator.generate_daily_report(
                    course_id,
                    current_date
                )
            )
            current_date += timedelta(days=1)

        # 모든 작업을 병렬로 실행
        responses = await asyncio.gather(*tasks, return_exceptions=True)

        for response in responses:
            if isinstance(response, dict) and response.get("status") == "success":
                results["total_updated"] += response.get("updated", 0)
                results["processed_dates"] += 1

        return results
