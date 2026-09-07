const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

interface TeeBooking {
  id: string;
  date: string;
  time: string;
  title: string;
  rate: number;
  players: Array<{ name: string; email: string }>;
  status: string;
  cartCount: number;
  holes: number;
}

interface DailyReport {
  date: string;
  total_tee_times: number;
  booked_slots: number;
  available_slots: number;
  occupancy_rate: number;
  total_revenue: number;
}

export const teeSheetApi = {
  // ===== Bookings =====
  async listBookings(): Promise<TeeBooking[]> {
    const res = await fetch(`${API_BASE}/v1/tee-sheet/bookings`);
    if (!res.ok) throw new Error("Failed to fetch bookings");
    return res.json();
  },

  async createBooking(data: Partial<TeeBooking>): Promise<TeeBooking> {
    const res = await fetch(`${API_BASE}/v1/tee-sheet/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to create booking");
    return res.json();
  },

  async updateBooking(id: string, data: Partial<TeeBooking>): Promise<TeeBooking> {
    const res = await fetch(`${API_BASE}/v1/tee-sheet/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update booking");
    return res.json();
  },

  async deleteBooking(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/v1/tee-sheet/bookings/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete booking");
  },

  // ===== Orchestration (병렬 처리) =====
  async startDailyBatch(date: string): Promise<any> {
    const res = await fetch(
      `${API_BASE}/v1/tee-sheet/orchestration/daily-batch?date=${encodeURIComponent(date)}`,
      { method: "POST" }
    );
    if (!res.ok) throw new Error("Failed to start daily batch");
    return res.json();
  },

  async sendReminders(date: string): Promise<any> {
    const res = await fetch(
      `${API_BASE}/v1/tee-sheet/orchestration/send-reminders?date=${encodeURIComponent(date)}`,
      { method: "POST" }
    );
    if (!res.ok) throw new Error("Failed to send reminders");
    return res.json();
  },

  async cleanup(): Promise<any> {
    const res = await fetch(`${API_BASE}/v1/tee-sheet/orchestration/cleanup`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to run cleanup");
    return res.json();
  },

  async getOrchestrationStatus(): Promise<any> {
    const res = await fetch(`${API_BASE}/v1/tee-sheet/orchestration/status`);
    if (!res.ok) throw new Error("Failed to get status");
    return res.json();
  },

  // ===== Reports =====
  async getDailyReport(date: string): Promise<DailyReport> {
    const res = await fetch(
      `${API_BASE}/v1/tee-sheet/reports/daily?date=${encodeURIComponent(date)}`
    );
    if (!res.ok) throw new Error("Failed to fetch daily report");
    return res.json();
  },

  async getWeekReport(): Promise<any> {
    const res = await fetch(`${API_BASE}/v1/tee-sheet/reports/week`);
    if (!res.ok) throw new Error("Failed to fetch week report");
    return res.json();
  },
};

export default teeSheetApi;
