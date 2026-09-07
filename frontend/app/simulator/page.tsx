"use client";

import { useState, useEffect } from "react";

interface TimeSlot {
  time: string;
  available_bays: number;
  total_bays: number;
}

interface AvailabilityResponse {
  date: string;
  bay_type: string;
  duration_hours: number;
  is_closed: boolean;
  available_slots: TimeSlot[];
}

interface ReservationResponse {
  id: number;
  confirmation_code: string;
  bay_type: string;
  date: string;
  start_time: string;
  duration_hours: number;
  player_count: number;
  total_price: number;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function SimulatorBooking() {
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedBayType, setSelectedBayType] = useState("right_handed");
  const [playerCount, setPlayerCount] = useState(1);
  const [duration, setDuration] = useState(1);
  const [selectedTime, setSelectedTime] = useState("");
  const [availability, setAvailability] = useState<TimeSlot[]>([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);

  // Step 3 form
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");

  // Step 4 confirmation
  const [reservation, setReservation] = useState<ReservationResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Set minimum date to today
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    setSelectedDate(today);
  }, []);

  // Fetch availability when date, bay type, or duration changes
  useEffect(() => {
    if (!selectedDate) return;

    const fetchAvailability = async () => {
      setIsLoadingAvailability(true);
      setError("");
      try {
        const params = new URLSearchParams({
          date: selectedDate,
          bay_type: selectedBayType,
          duration_hours: duration.toString(),
        });

        const response = await fetch(
          `${BACKEND_URL}/api/v1/simulator/availability?${params}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch availability");
        }

        const data: AvailabilityResponse = await response.json();
        setAvailability(data.available_slots);

        if (data.is_closed) {
          setError("The simulator is closed on this day (Monday-Tuesday)");
        }
      } catch (err) {
        setError("Failed to load available time slots");
        setAvailability([]);
      } finally {
        setIsLoadingAvailability(false);
      }
    };

    fetchAvailability();
  }, [selectedDate, selectedBayType, duration]);

  const handleCreateReservation = async () => {
    setIsSubmitting(true);
    setError("");

    try {
      // Fetch available bays of selected type
      const baysResponse = await fetch(
        `${BACKEND_URL}/api/v1/simulator/bays?bay_type=${selectedBayType}`
      );

      if (!baysResponse.ok) {
        throw new Error("Failed to fetch available bays");
      }

      const baysData: Array<{ id: number; bay_number: number; bay_type: string; hourly_rate: number }> =
        await baysResponse.json();

      if (baysData.length === 0) {
        throw new Error("No available bays for selected type");
      }

      const bay_id = baysData[0].id; // Use first available bay

      const response = await fetch(`${BACKEND_URL}/api/v1/simulator/reservations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bay_id,
          date: selectedDate,
          start_time: selectedTime,
          duration_hours: duration,
          player_count: playerCount,
          customer_name: customerName,
          customer_email: customerEmail,
          phone: customerPhone,
          notes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Booking failed");
      }

      const data: ReservationResponse = await response.json();
      setReservation(data);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const bayTypeDisplay = {
    right_handed: "Right-Handed Bays",
    left_right: "Left & Right Handed Bay",
    vip: "VIP Bay",
  };

  return (
    <main className="min-h-screen bg-[#f7f4ed] text-[#182118]">
      <header className="sticky top-0 z-20 border-b border-[#d8d1c3] bg-[#f7f4ed]/92 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <a className="font-serif text-xl font-semibold tracking-[0.08em]" href="/">
            Pelham Hills
          </a>
          <a
            className="rounded-sm bg-[#214d2f] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#163820]"
            href="/"
          >
            Back Home
          </a>
        </nav>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-12 lg:px-8">
        {/* Progress Steps */}
        <div className="mb-12 flex justify-between">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex flex-col items-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full font-semibold ${
                  s <= step
                    ? "bg-[#214d2f] text-white"
                    : "bg-[#d8d1c3] text-[#8a6f30]"
                }`}
              >
                {s}
              </div>
              <div className="mt-2 text-center text-sm font-semibold">
                {s === 1 && "Choose"}
                {s === 2 && "Options"}
                {s === 3 && "Details"}
                {s === 4 && "Confirm"}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-sm bg-red-100 p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Step 1: Choose Date & Bay Type */}
        {step === 1 && (
          <div className="rounded-sm border border-[#d8d1c3] bg-white p-8">
            <h2 className="font-serif text-2xl font-semibold mb-6">
              Choose a date
            </h2>

            <div className="mb-8">
              <label className="block text-sm font-semibold mb-2">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-sm border border-[#d8d1c3] px-4 py-3"
              />
            </div>

            <div className="mb-8">
              <label className="block text-sm font-semibold mb-4">
                Choose an option
              </label>
              <div className="grid grid-cols-3 gap-4">
                {(
                  Object.entries(bayTypeDisplay) as [
                    keyof typeof bayTypeDisplay,
                    string
                  ][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedBayType(key)}
                    className={`rounded-sm border-2 px-4 py-3 text-center font-semibold transition ${
                      selectedBayType === key
                        ? "border-[#214d2f] bg-[#214d2f] text-white"
                        : "border-[#d8d1c3] bg-white text-[#182118] hover:border-[#214d2f]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full rounded-sm bg-[#214d2f] py-3 font-bold text-white transition hover:bg-[#163820]"
            >
              NEXT
            </button>
          </div>
        )}

        {/* Step 2: Choose Options */}
        {step === 2 && (
          <div className="rounded-sm border border-[#d8d1c3] bg-white p-8">
            <h2 className="font-serif text-2xl font-semibold mb-6">
              Choose your options
            </h2>

            <p className="mb-6 text-sm text-[#666]">
              Right-Handed bays only. Allow approximately 1 hour per golfer to
              complete 18 holes. Add 1 hour for each additional golfer.
            </p>

            {/* Date Display */}
            <div className="mb-6 rounded-sm bg-[#f7f4ed] p-4">
              <p className="text-sm font-semibold">
                {formatDate(selectedDate)}
              </p>
              <p className="text-sm text-[#666]">
                {bayTypeDisplay[
                  selectedBayType as keyof typeof bayTypeDisplay
                ]}
              </p>
            </div>

            {/* Player Count */}
            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">
                Number of players in group
              </label>
              <select
                value={playerCount}
                onChange={(e) => setPlayerCount(parseInt(e.target.value))}
                className="w-full rounded-sm border border-[#d8d1c3] px-4 py-3"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} player{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Duration */}
            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">
                Number of hours
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value))}
                className="w-full rounded-sm border border-[#d8d1c3] px-4 py-3"
              >
                {[1, 2, 3, 4, 5].map((h) => (
                  <option key={h} value={h}>
                    {h} hour{h > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Time Slots */}
            <div className="mb-6">
              <label className="block text-sm font-semibold mb-3">
                Select a time slot
              </label>
              {isLoadingAvailability ? (
                <p className="text-sm text-[#666]">Loading available times...</p>
              ) : availability.length === 0 ? (
                <p className="text-sm text-red-600">
                  No available time slots for this date and duration.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {availability.map((slot) => (
                    <button
                      key={slot.time}
                      onClick={() => setSelectedTime(slot.time)}
                      disabled={slot.available_bays === 0}
                      className={`rounded-sm border px-3 py-2 text-sm font-semibold transition ${
                        selectedTime === slot.time
                          ? "border-[#214d2f] bg-[#214d2f] text-white"
                          : slot.available_bays === 0
                            ? "border-[#d8d1c3] bg-[#f0f0f0] text-[#999] cursor-not-allowed"
                            : "border-[#d8d1c3] bg-white hover:border-[#214d2f]"
                      }`}
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-sm border border-[#d8d1c3] py-3 font-bold text-[#214d2f] transition hover:bg-[#f7f4ed]"
              >
                BACK
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!selectedTime}
                className={`flex-1 rounded-sm py-3 font-bold text-white transition ${
                  selectedTime
                    ? "bg-[#214d2f] hover:bg-[#163820]"
                    : "bg-[#ccc] cursor-not-allowed"
                }`}
              >
                NEXT
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Enter Details */}
        {step === 3 && (
          <div className="rounded-sm border border-[#d8d1c3] bg-white p-8">
            <h2 className="font-serif text-2xl font-semibold mb-6">
              Booking information
            </h2>

            {/* Booking Summary */}
            <div className="mb-6 rounded-sm bg-[#f7f4ed] p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-semibold text-[#8a6f30]">Date</p>
                  <p>{formatDate(selectedDate)}</p>
                </div>
                <div>
                  <p className="font-semibold text-[#8a6f30]">Time</p>
                  <p>{selectedTime}</p>
                </div>
                <div>
                  <p className="font-semibold text-[#8a6f30]">Duration</p>
                  <p>{duration} hour{duration > 1 ? "s" : ""}</p>
                </div>
                <div>
                  <p className="font-semibold text-[#8a6f30]">Players</p>
                  <p>{playerCount}</p>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-sm border border-[#d8d1c3] px-4 py-3"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">Email</label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full rounded-sm border border-[#d8d1c3] px-4 py-3"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">
                Phone (Optional)
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="+1 (905) 123-4567"
                className="w-full rounded-sm border border-[#d8d1c3] px-4 py-3"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special requests or notes..."
                className="w-full rounded-sm border border-[#d8d1c3] px-4 py-3"
                rows={3}
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(2)}
                className="flex-1 rounded-sm border border-[#d8d1c3] py-3 font-bold text-[#214d2f] transition hover:bg-[#f7f4ed]"
              >
                BACK
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={!customerName || !customerEmail}
                className={`flex-1 rounded-sm py-3 font-bold text-white transition ${
                  customerName && customerEmail
                    ? "bg-[#214d2f] hover:bg-[#163820]"
                    : "bg-[#ccc] cursor-not-allowed"
                }`}
              >
                REVIEW
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 4 && !reservation && (
          <div className="rounded-sm border border-[#d8d1c3] bg-white p-8">
            <h2 className="font-serif text-2xl font-semibold mb-6">
              Confirm your booking
            </h2>

            {/* Booking Summary */}
            <div className="mb-6 rounded-sm bg-[#f7f4ed] p-4">
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <p className="font-semibold text-[#8a6f30]">
                    {bayTypeDisplay[
                      selectedBayType as keyof typeof bayTypeDisplay
                    ]}
                  </p>
                </div>
                <div>
                  <p className="text-right font-semibold text-[#214d2f]">
                    ${(20 * duration).toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="border-t border-[#d8d1c3] pt-4 text-sm">
                <p>
                  <span className="font-semibold">Date:</span>{" "}
                  {formatDate(selectedDate)}
                </p>
                <p>
                  <span className="font-semibold">Time:</span> {selectedTime} (
                  {duration} hour{duration > 1 ? "s" : ""})
                </p>
                <p>
                  <span className="font-semibold">Players:</span> {playerCount}
                </p>
              </div>

              <div className="border-t border-[#d8d1c3] mt-4 pt-4">
                <p className="text-sm">
                  <span className="font-semibold">Name:</span> {customerName}
                </p>
                <p className="text-sm">
                  <span className="font-semibold">Email:</span> {customerEmail}
                </p>
                {customerPhone && (
                  <p className="text-sm">
                    <span className="font-semibold">Phone:</span> {customerPhone}
                  </p>
                )}
              </div>
            </div>

            {/* Booking Policies */}
            <div className="mb-6 text-sm text-[#666]">
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  Free cancellations up to 12 hours before reservation start
                  time.
                </li>
                <li>
                  Cancellations after the 12 hour delay will be billed 50% of
                  reservation total.
                </li>
                <li>
                  No shows will be billed 100% of reservation total.
                </li>
                <li>
                  Please bring indoor or CLEAN golf shoes for simulators. Dirty
                  Shoes will not be allowed in the simulators
                </li>
              </ul>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(3)}
                className="flex-1 rounded-sm border border-[#d8d1c3] py-3 font-bold text-[#214d2f] transition hover:bg-[#f7f4ed]"
              >
                BACK
              </button>
              <button
                onClick={handleCreateReservation}
                disabled={isSubmitting}
                className={`flex-1 rounded-sm py-3 font-bold text-white transition ${
                  isSubmitting
                    ? "bg-[#ccc] cursor-not-allowed"
                    : "bg-[#214d2f] hover:bg-[#163820]"
                }`}
              >
                {isSubmitting ? "BOOKING..." : "CONFIRM AND RESERVE"}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Confirmation */}
        {reservation && (
          <div className="rounded-sm border border-[#d8d1c3] bg-white p-8 text-center">
            <div className="mb-6">
              <div className="text-5xl mb-4">✓</div>
              <h2 className="font-serif text-3xl font-semibold text-[#214d2f]">
                Your booking is confirmed
              </h2>
            </div>

            <div className="mb-8 rounded-sm bg-[#f7f4ed] p-6">
              <p className="text-sm text-[#666] mb-4">
                {bayTypeDisplay[
                  selectedBayType as keyof typeof bayTypeDisplay
                ]}{" "}
                on {formatDate(selectedDate)}
              </p>

              <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                <div>
                  <p className="font-semibold text-[#8a6f30]">
                    {reservation.start_time}
                  </p>
                  <p className="text-[#666]">
                    {reservation.duration_hours} hour
                    {reservation.duration_hours > 1 ? "s" : ""}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[#214d2f]">
                    ${reservation.total_price.toFixed(2)}
                  </p>
                  <p className="text-[#666]">{reservation.player_count} player{reservation.player_count > 1 ? "s" : ""}</p>
                </div>
              </div>

              <div className="border-t border-[#d8d1c3] pt-4">
                <p className="text-sm mb-2">
                  <span className="font-semibold">Confirmation Code:</span>
                </p>
                <p className="text-2xl font-bold text-[#214d2f] tracking-widest">
                  {reservation.confirmation_code}
                </p>
              </div>
            </div>

            <p className="mb-4 text-sm text-[#666]">
              A confirmation email has been sent to{" "}
              <span className="font-semibold">{customerEmail}</span>
            </p>

            <p className="mb-6 text-sm text-[#666]">
              Please arrive 15 minutes early. Contact info@pelhamhills.com or
              call 905-735-6768 with any questions.
            </p>

            <a
              href="/"
              className="inline-block rounded-sm bg-[#214d2f] px-8 py-3 font-bold text-white transition hover:bg-[#163820]"
            >
              Back to Home
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
