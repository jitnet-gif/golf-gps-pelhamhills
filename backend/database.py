from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, Integer, String, DateTime, Float, Boolean, ForeignKey, Text, Time
from datetime import datetime
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://user:password@localhost/teesheet")

engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()


class GolfCourse(Base):
    __tablename__ = "golf_courses"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    holes = Column(Integer, default=18)
    par = Column(Integer)
    rating = Column(Float)
    slope = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)


class TeeTime(Base):
    __tablename__ = "tee_times"

    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey("golf_courses.id"), nullable=False)
    date = Column(DateTime, nullable=False, index=True)
    start_time = Column(Time, nullable=False)
    slots_available = Column(Integer, default=4)
    slots_booked = Column(Integer, default=0)
    rate = Column(Float, nullable=False)
    category = Column(String(50), default="Weekday")  # Weekday, Weekend, Holiday
    is_locked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Reservation(Base):
    __tablename__ = "reservations"

    id = Column(Integer, primary_key=True)
    tee_time_id = Column(Integer, ForeignKey("tee_times.id"), nullable=False)
    customer_name = Column(String(255), nullable=False)
    customer_email = Column(String(255), nullable=False)
    phone = Column(String(20))
    golfer_count = Column(Integer, default=1)
    notes = Column(Text)
    status = Column(String(20), default="confirmed")  # confirmed, cancelled, no-show
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PricingTemplate(Base):
    __tablename__ = "pricing_templates"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    course_id = Column(Integer, ForeignKey("golf_courses.id"), nullable=False)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    weekday_rate = Column(Float, nullable=False)
    weekend_rate = Column(Float, nullable=False)
    holiday_rate = Column(Float)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SimulatorBay(Base):
    __tablename__ = "simulator_bays"

    id = Column(Integer, primary_key=True)
    bay_number = Column(Integer, nullable=False, unique=True)
    bay_type = Column(String(50), nullable=False)  # right_handed, left_right, vip
    hourly_rate = Column(Float, default=20.0, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SimulatorReservation(Base):
    __tablename__ = "simulator_reservations"

    id = Column(Integer, primary_key=True)
    bay_id = Column(Integer, ForeignKey("simulator_bays.id"), nullable=False)
    date = Column(DateTime, nullable=False, index=True)
    start_time = Column(String(5), nullable=False)  # HH:MM format
    duration_hours = Column(Integer, nullable=False)
    player_count = Column(Integer, default=1)
    customer_name = Column(String(255), nullable=False)
    customer_email = Column(String(255), nullable=False)
    phone = Column(String(20))
    notes = Column(Text)
    confirmation_code = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(String(20), default="confirmed")  # confirmed, cancelled
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


async def get_db():
    async with async_session() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
