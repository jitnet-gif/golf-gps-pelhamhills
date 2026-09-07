from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from datetime import datetime, time, timedelta
from typing import List
import secrets
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from backend.database import get_db, SimulatorBay, SimulatorReservation

router = APIRouter()

# Constants
SIMULATOR_HOURS = {"start": 14, "end": 22}  # 2:00 PM - 10:00 PM
CLOSED_DAYS = [0, 1]  # Monday=0, Tuesday=1
TIME_SLOT_MINUTES = 15
HOURLY_RATE = 20.0


def generate_confirmation_code() -> str:
    return secrets.token_hex(5).upper()


def send_confirmation_email(
    customer_name: str,
    customer_email: str,
    bay_type: str,
    date_str: str,
    start_time: str,
    duration_hours: int,
    player_count: int,
    total_price: float,
    confirmation_code: str,
) -> bool:
    try:
        smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        sender_email = os.getenv("SENDER_EMAIL", "noreply@pelhamhills.com")
        sender_password = os.getenv("SENDER_PASSWORD", "")

        if not sender_password:
            return False

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Booking Confirmation - PH Indoor Golf ({confirmation_code})"
        msg["From"] = sender_email
        msg["To"] = customer_email

        html = f"""
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
              <h2 style="color: #214d2f;">Your booking is confirmed</h2>
              <p>Hi {customer_name},</p>
              <p>Your booking for PH Indoor Golf has been confirmed.</p>

              <div style="background-color: #f7f4ed; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>{bay_type} Bay</strong></p>
                <p><strong>Date:</strong> {date_str}</p>
                <p><strong>Time:</strong> {start_time} ({duration_hours} hour{'s' if duration_hours > 1 else ''})</p>
                <p><strong>Players:</strong> {player_count}</p>
                <p><strong>Total Price:</strong> ${total_price:.2f}</p>
                <p><strong>Confirmation Code:</strong> <span style="color: #214d2f; font-weight: bold; font-size: 18px;">{confirmation_code}</span></p>
              </div>

              <p style="color: #666; font-size: 14px;">
                <strong>Operating Hours:</strong><br>
                Monday - Tuesday: CLOSED<br>
                Wednesday - Sunday: 2:00 PM - 10:00 PM
              </p>

              <p style="color: #666; font-size: 12px;">
                Questions? Contact us at info@pelhamhills.com or call 905-735-6768
              </p>
            </div>
          </body>
        </html>
        """

        part = MIMEText(html, "html")
        msg.attach(part)

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, customer_email, msg.as_string())

        return True
    except Exception as e:
        print(f"Email sending failed: {e}")
        return False


@router.get("/simulator/bays")
async def list_bays(bay_type: str = Query(None), db: AsyncSession = Depends(get_db)):
    """List all simulator bays, optionally filtered by type."""
    query = select(SimulatorBay).where(SimulatorBay.is_active == True)

    if bay_type:
        query = query.where(SimulatorBay.bay_type == bay_type)

    result = await db.execute(query.order_by(SimulatorBay.bay_number))
    bays = result.scalars().all()

    return [
        {
            "id": bay.id,
            "bay_number": bay.bay_number,
            "bay_type": bay.bay_type,
            "hourly_rate": bay.hourly_rate,
        }
        for bay in bays
    ]


@router.get("/simulator/availability")
async def get_availability(
    date: str,
    bay_type: str = Query("right_handed"),
    duration_hours: int = Query(1),
    db: AsyncSession = Depends(get_db),
):
    """Get available time slots for a specific date, bay type, and duration."""
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    # Check if closed (Monday=0, Tuesday=1)
    if target_date.weekday() in CLOSED_DAYS:
        return {"date": date, "is_closed": True, "available_slots": []}

    # Get all bays of the specified type
    bays_result = await db.execute(
        select(SimulatorBay).where(
            and_(SimulatorBay.bay_type == bay_type, SimulatorBay.is_active == True)
        )
    )
    bays = bays_result.scalars().all()

    if not bays:
        raise HTTPException(status_code=404, detail=f"No active bays found for type: {bay_type}")

    available_slots = []

    # Generate time slots from 2:00 PM to 10:00 PM
    start_hour = SIMULATOR_HOURS["start"]
    end_hour = SIMULATOR_HOURS["end"]

    for hour in range(start_hour, end_hour):
        for minute in [0, 15, 30, 45]:
            start_slot_time = f"{hour:02d}:{minute:02d}"

            # Check if this time slot is valid (enough time until closing)
            end_time_minutes = (hour + duration_hours) * 60 + minute
            closing_minutes = end_hour * 60
            if end_time_minutes > closing_minutes:
                continue

            # Parse slot time
            slot_start_hour = hour
            slot_start_minute = minute
            slot_end_hour = hour + duration_hours
            slot_end_minute = minute

            # Convert to minutes for easier comparison
            slot_start_total = slot_start_hour * 60 + slot_start_minute
            slot_end_total = slot_end_hour * 60 + slot_end_minute

            # Check availability for all bays
            available_bay_count = 0

            for bay in bays:
                # Query for overlapping reservations
                # A reservation conflicts if: res_start < slot_end AND res_end > slot_start
                conflicts = await db.execute(
                    select(SimulatorReservation).where(
                        and_(
                            SimulatorReservation.bay_id == bay.id,
                            SimulatorReservation.date == target_date,
                            SimulatorReservation.status == "confirmed",
                        )
                    )
                )
                reservations = conflicts.scalars().all()

                # Check if any reservation overlaps with this slot
                has_conflict = False
                for res in reservations:
                    res_start_h, res_start_m = map(int, res.start_time.split(":"))
                    res_start_total = res_start_h * 60 + res_start_m
                    res_end_total = res_start_total + (res.duration_hours * 60)

                    # Check for time overlap
                    if res_start_total < slot_end_total and res_end_total > slot_start_total:
                        has_conflict = True
                        break

                if not has_conflict:
                    available_bay_count += 1

            if available_bay_count > 0:
                available_slots.append(
                    {
                        "time": start_slot_time,
                        "available_bays": available_bay_count,
                        "total_bays": len(bays),
                    }
                )

    return {
        "date": date,
        "bay_type": bay_type,
        "duration_hours": duration_hours,
        "is_closed": False,
        "available_slots": available_slots,
    }


@router.post("/simulator/reservations")
async def create_simulator_reservation(
    reservation: dict,
    db: AsyncSession = Depends(get_db),
):
    """Create a simulator bay reservation."""
    try:
        bay_id = reservation.get("bay_id")
        date_str = reservation.get("date")
        start_time = reservation.get("start_time")
        duration_hours = reservation.get("duration_hours")
        player_count = reservation.get("player_count", 1)
        customer_name = reservation.get("customer_name")
        customer_email = reservation.get("customer_email")
        phone = reservation.get("phone")
        notes = reservation.get("notes", "")

        # Validate inputs
        if not all([bay_id, date_str, start_time, duration_hours, customer_name, customer_email]):
            raise HTTPException(
                status_code=400, detail="Missing required fields"
            )

        # Get bay info
        bay = await db.get(SimulatorBay, bay_id)
        if not bay or not bay.is_active:
            raise HTTPException(status_code=404, detail="Bay not found or inactive")

        # Check date validity
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")

        # Check if closed
        if target_date.weekday() in CLOSED_DAYS:
            raise HTTPException(status_code=400, detail="Simulator is closed on this day")

        # Parse time
        try:
            start_hour, start_minute = map(int, start_time.split(":"))
        except:
            raise HTTPException(status_code=400, detail="Invalid time format")

        # Validate time is within operating hours
        end_hour = start_hour + duration_hours
        if start_hour < SIMULATOR_HOURS["start"] or end_hour > SIMULATOR_HOURS["end"]:
            raise HTTPException(status_code=400, detail="Requested time is outside operating hours")

        # Check for conflicts (atomic check within transaction)
        conflicts = await db.execute(
            select(func.count(SimulatorReservation.id)).where(
                and_(
                    SimulatorReservation.bay_id == bay_id,
                    SimulatorReservation.date == target_date,
                    SimulatorReservation.status == "confirmed",
                    SimulatorReservation.start_time < f"{end_hour:02d}:{start_minute:02d}",
                )
            )
        )
        if conflicts.scalar() > 0:
            raise HTTPException(status_code=409, detail="Time slot already booked")

        # Generate confirmation code
        confirmation_code = generate_confirmation_code()

        # Calculate total price (1 bay, hourly rate)
        total_price = bay.hourly_rate * duration_hours

        # Create reservation
        db_reservation = SimulatorReservation(
            bay_id=bay_id,
            date=target_date,
            start_time=start_time,
            duration_hours=duration_hours,
            player_count=player_count,
            customer_name=customer_name,
            customer_email=customer_email,
            phone=phone,
            notes=notes,
            confirmation_code=confirmation_code,
        )

        db.add(db_reservation)
        await db.commit()
        await db.refresh(db_reservation)

        # Send confirmation email
        bay_type_display = bay.bay_type.replace("_", " ").title()
        send_confirmation_email(
            customer_name=customer_name,
            customer_email=customer_email,
            bay_type=bay_type_display,
            date_str=date_str,
            start_time=start_time,
            duration_hours=duration_hours,
            player_count=player_count,
            total_price=total_price,
            confirmation_code=confirmation_code,
        )

        return {
            "id": db_reservation.id,
            "confirmation_code": confirmation_code,
            "bay_type": bay_type_display,
            "date": date_str,
            "start_time": start_time,
            "duration_hours": duration_hours,
            "player_count": player_count,
            "total_price": total_price,
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/simulator/reservations/{confirmation_code}")
async def get_reservation_by_code(
    confirmation_code: str, db: AsyncSession = Depends(get_db)
):
    """Get reservation details by confirmation code."""
    result = await db.execute(
        select(SimulatorReservation).where(
            SimulatorReservation.confirmation_code == confirmation_code
        )
    )
    reservation = result.scalar_one_or_none()

    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    bay = await db.get(SimulatorBay, reservation.bay_id)

    return {
        "id": reservation.id,
        "confirmation_code": reservation.confirmation_code,
        "bay_type": bay.bay_type.replace("_", " ").title() if bay else "Unknown",
        "date": reservation.date.strftime("%Y-%m-%d"),
        "start_time": reservation.start_time,
        "duration_hours": reservation.duration_hours,
        "player_count": reservation.player_count,
        "customer_name": reservation.customer_name,
        "customer_email": reservation.customer_email,
        "status": reservation.status,
        "created_at": reservation.created_at.isoformat(),
    }


@router.post("/simulator/admin/init-bays")
async def init_simulator_bays(db: AsyncSession = Depends(get_db)):
    """Initialize default simulator bays (Admin only - v1 no auth)."""
    # Check if bays already exist
    existing = await db.execute(select(func.count(SimulatorBay.id)))
    if existing.scalar() > 0:
        return {"message": "Bays already initialized"}

    # Create default bays
    default_bays = [
        SimulatorBay(bay_number=1, bay_type="right_handed", hourly_rate=20.0),
        SimulatorBay(bay_number=2, bay_type="right_handed", hourly_rate=20.0),
        SimulatorBay(bay_number=3, bay_type="right_handed", hourly_rate=20.0),
        SimulatorBay(bay_number=4, bay_type="left_right", hourly_rate=20.0),
        SimulatorBay(bay_number=5, bay_type="vip", hourly_rate=25.0),
    ]

    for bay in default_bays:
        db.add(bay)

    await db.commit()

    return {
        "message": "Simulator bays initialized successfully",
        "bays_created": len(default_bays),
    }
