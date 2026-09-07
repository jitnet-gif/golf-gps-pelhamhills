from pydantic import BaseModel, EmailStr
from datetime import datetime, date, time
from typing import Optional, List


class GolfCourseCreate(BaseModel):
    name: str
    holes: int = 18
    par: Optional[int] = None
    rating: Optional[float] = None
    slope: Optional[float] = None


class GolfCourseResponse(GolfCourseCreate):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class TeeTimeCreate(BaseModel):
    course_id: int
    date: datetime
    start_time: time
    slots_available: int = 4
    rate: float
    category: str = "Weekday"


class TeeTimeUpdate(BaseModel):
    slots_available: Optional[int] = None
    rate: Optional[float] = None
    category: Optional[str] = None
    is_locked: Optional[bool] = None


class TeeTimeResponse(TeeTimeCreate):
    id: int
    slots_booked: int
    is_locked: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReservationCreate(BaseModel):
    tee_time_id: int
    customer_name: str
    customer_email: EmailStr
    phone: Optional[str] = None
    golfer_count: int = 1
    notes: Optional[str] = None


class ReservationUpdate(BaseModel):
    status: Optional[str] = None
    golfer_count: Optional[int] = None


class ReservationResponse(ReservationCreate):
    id: int
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PricingTemplateCreate(BaseModel):
    name: str
    course_id: int
    start_date: datetime
    end_date: datetime
    weekday_rate: float
    weekend_rate: float
    holiday_rate: Optional[float] = None


class PricingTemplateResponse(PricingTemplateCreate):
    id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class WeekViewResponse(BaseModel):
    date: date
    category: str
    tee_times: List[TeeTimeResponse]


class DailyReportResponse(BaseModel):
    date: date
    total_reservations: int
    total_revenue: float
    available_slots: int
    occupancy_rate: float
