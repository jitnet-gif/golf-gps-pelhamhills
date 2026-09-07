from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from datetime import datetime, timedelta
from typing import List

from .database import get_db
from .models import (
    TeeTimeCreate, TeeTimeResponse, TeeTimeUpdate,
    ReservationCreate, ReservationResponse, ReservationUpdate,
    GolfCourseCreate, GolfCourseResponse,
    PricingTemplateCreate, PricingTemplateResponse,
    WeekViewResponse, DailyReportResponse
)
from .database import TeeTime, Reservation, GolfCourse, PricingTemplate

router = APIRouter()


# ===== Golf Courses =====
@router.post("/courses", response_model=GolfCourseResponse)
async def create_course(course: GolfCourseCreate, db: AsyncSession = Depends(get_db)):
    db_course = GolfCourse(**course.dict())
    db.add(db_course)
    await db.commit()
    await db.refresh(db_course)
    return db_course


@router.get("/courses", response_model=List[GolfCourseResponse])
async def list_courses(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GolfCourse))
    return result.scalars().all()


@router.get("/courses/{course_id}", response_model=GolfCourseResponse)
async def get_course(course_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GolfCourse).where(GolfCourse.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


# ===== Tee Times =====
@router.post("/tee-times", response_model=TeeTimeResponse)
async def create_tee_time(tee_time: TeeTimeCreate, db: AsyncSession = Depends(get_db)):
    db_tee_time = TeeTime(**tee_time.dict())
    db.add(db_tee_time)
    await db.commit()
    await db.refresh(db_tee_time)
    return db_tee_time


@router.get("/tee-times", response_model=List[TeeTimeResponse])
async def list_tee_times(
    course_id: int = Query(None),
    date_from: datetime = Query(None),
    date_to: datetime = Query(None),
    db: AsyncSession = Depends(get_db)
):
    query = select(TeeTime)

    if course_id:
        query = query.where(TeeTime.course_id == course_id)

    if date_from:
        query = query.where(TeeTime.date >= date_from)

    if date_to:
        query = query.where(TeeTime.date <= date_to)

    result = await db.execute(query.order_by(TeeTime.date, TeeTime.start_time))
    return result.scalars().all()


@router.get("/tee-times/{tee_time_id}", response_model=TeeTimeResponse)
async def get_tee_time(tee_time_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TeeTime).where(TeeTime.id == tee_time_id))
    tee_time = result.scalar_one_or_none()
    if not tee_time:
        raise HTTPException(status_code=404, detail="Tee time not found")
    return tee_time


@router.put("/tee-times/{tee_time_id}", response_model=TeeTimeResponse)
async def update_tee_time(
    tee_time_id: int,
    updates: TeeTimeUpdate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(TeeTime).where(TeeTime.id == tee_time_id))
    tee_time = result.scalar_one_or_none()
    if not tee_time:
        raise HTTPException(status_code=404, detail="Tee time not found")

    for key, value in updates.dict(exclude_unset=True).items():
        setattr(tee_time, key, value)

    tee_time.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(tee_time)
    return tee_time


@router.delete("/tee-times/{tee_time_id}")
async def delete_tee_time(tee_time_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TeeTime).where(TeeTime.id == tee_time_id))
    tee_time = result.scalar_one_or_none()
    if not tee_time:
        raise HTTPException(status_code=404, detail="Tee time not found")

    await db.delete(tee_time)
    await db.commit()
    return {"message": "Tee time deleted"}


# ===== Reservations =====
@router.post("/reservations", response_model=ReservationResponse)
async def create_reservation(
    reservation: ReservationCreate,
    db: AsyncSession = Depends(get_db)
):
    # Check tee time availability
    result = await db.execute(select(TeeTime).where(TeeTime.id == reservation.tee_time_id))
    tee_time = result.scalar_one_or_none()

    if not tee_time:
        raise HTTPException(status_code=404, detail="Tee time not found")

    available = tee_time.slots_available - tee_time.slots_booked
    if available < reservation.golfer_count:
        raise HTTPException(status_code=400, detail="Not enough slots available")

    db_reservation = Reservation(**reservation.dict())
    db.add(db_reservation)

    # Update tee time slots
    tee_time.slots_booked += reservation.golfer_count

    await db.commit()
    await db.refresh(db_reservation)
    return db_reservation


@router.get("/reservations", response_model=List[ReservationResponse])
async def list_reservations(
    tee_time_id: int = Query(None),
    status: str = Query(None),
    db: AsyncSession = Depends(get_db)
):
    query = select(Reservation)

    if tee_time_id:
        query = query.where(Reservation.tee_time_id == tee_time_id)

    if status:
        query = query.where(Reservation.status == status)

    result = await db.execute(query.order_by(Reservation.created_at.desc()))
    return result.scalars().all()


@router.get("/reservations/{reservation_id}", response_model=ReservationResponse)
async def get_reservation(reservation_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Reservation).where(Reservation.id == reservation_id))
    reservation = result.scalar_one_or_none()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    return reservation


@router.put("/reservations/{reservation_id}", response_model=ReservationResponse)
async def update_reservation(
    reservation_id: int,
    updates: ReservationUpdate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Reservation).where(Reservation.id == reservation_id))
    reservation = result.scalar_one_or_none()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    for key, value in updates.dict(exclude_unset=True).items():
        setattr(reservation, key, value)

    reservation.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(reservation)
    return reservation


@router.delete("/reservations/{reservation_id}")
async def delete_reservation(reservation_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Reservation).where(Reservation.id == reservation_id))
    reservation = result.scalar_one_or_none()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    # Refund slots
    tee_time = await db.get(TeeTime, reservation.tee_time_id)
    if tee_time:
        tee_time.slots_booked -= reservation.golfer_count

    await db.delete(reservation)
    await db.commit()
    return {"message": "Reservation cancelled"}


# ===== Reports & Analytics =====
@router.get("/reports/daily/{date}")
async def get_daily_report(date: str, course_id: int = Query(None), db: AsyncSession = Depends(get_db)):
    date_obj = datetime.strptime(date, "%Y-%m-%d")

    query = select(TeeTime).where(
        and_(
            TeeTime.date >= date_obj,
            TeeTime.date < date_obj + timedelta(days=1)
        )
    )

    if course_id:
        query = query.where(TeeTime.course_id == course_id)

    result = await db.execute(query)
    tee_times = result.scalars().all()

    total_reservations = sum(tt.slots_booked for tt in tee_times)
    total_revenue = sum(tt.rate * tt.slots_booked for tt in tee_times)
    available_slots = sum(tt.slots_available - tt.slots_booked for tt in tee_times)
    total_slots = sum(tt.slots_available for tt in tee_times)
    occupancy_rate = (total_reservations / total_slots * 100) if total_slots > 0 else 0

    return DailyReportResponse(
        date=date_obj.date(),
        total_reservations=total_reservations,
        total_revenue=total_revenue,
        available_slots=available_slots,
        occupancy_rate=occupancy_rate
    )


@router.get("/reports/week")
async def get_week_report(course_id: int, start_date: str = Query(None), db: AsyncSession = Depends(get_db)):
    if not start_date:
        start_date = datetime.now()
    else:
        start_date = datetime.strptime(start_date, "%Y-%m-%d")

    end_date = start_date + timedelta(days=7)

    result = await db.execute(
        select(TeeTime)
        .where(
            and_(
                TeeTime.course_id == course_id,
                TeeTime.date >= start_date,
                TeeTime.date < end_date
            )
        )
        .order_by(TeeTime.date, TeeTime.start_time)
    )

    tee_times = result.scalars().all()

    return {
        "week": f"{start_date.date()} to {end_date.date()}",
        "tee_times": tee_times
    }
