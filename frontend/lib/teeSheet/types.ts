// Shared tee sheet contract. Backend source of truth: backend/api/routes/tee_sheet.py
// Wire dates are ISO `YYYY-MM-DD`. `dayIndex` is NEVER sent over the wire; it is
// derived at render time from the booking date and the visible week anchor.

export type BookingStatus =
  | "reserved"
  | "checked_in"
  | "paid"
  | "cancelled"
  | "no_show"
  | "blocked";

export type PlayerType = "Existing Customer" | "Guest";

export type BookingColor = "blue" | "gold" | "gray";

export type Player = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  type: PlayerType;
  ratePlan: string;
  arrived: boolean;
  paid: boolean;
  cancelled: boolean;
  no_show: boolean;
};

export type AuditEntry = {
  id: string;
  ts: string;
  message: string;
};

export type TeeBooking = {
  id: string;
  /** ISO date, e.g. "2026-09-11" */
  date: string;
  /** Slot label, e.g. "6:58 AM" — always one of the slots returned by /tee-sheet/slots */
  time: string;
  holes: 9 | 18;
  rate: number;
  span: number;
  color: BookingColor;
  title: string;
  status: BookingStatus;
  cartCount: number;
  notes: string;
  players: Player[];
  audit: AuditEntry[];
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeeSlot = {
  /** Slot label, e.g. "6:58 AM" */
  time: string;
  /** Minutes from midnight — stable sort key */
  minutes: number;
  rate: number;
  cartsTotal: number;
};

export type SlotsResponse = {
  date: string;
  slots: TeeSlot[];
};

export type CreateBookingInput = {
  date: string;
  time: string;
  title: string;
  holes?: 9 | 18;
  rate?: number;
  cartCount?: number;
  color?: BookingColor;
  notes?: string;
  players?: Array<Partial<Omit<Player, "id">>>;
};

export type PatchBookingInput = Partial<{
  date: string;
  time: string;
  title: string;
  holes: 9 | 18;
  rate: number;
  cartCount: number;
  color: BookingColor;
  notes: string;
  status: BookingStatus;
  cancelReason: string | null;
}>;

export type AddPlayerInput = Partial<Omit<Player, "id">>;
export type PatchPlayerInput = Partial<Omit<Player, "id">>;

// ===== Reports =====

export type DailyReport = {
  date: string;
  total_tee_times: number;
  total_slots: number;
  booked_slots: number;
  available_slots: number;
  occupancy_rate: number;
  total_revenue: number;
  collected_revenue: number;
  outstanding_revenue: number;
  checked_in: number;
  cancelled: number;
  no_show: number;
  carts: number;
  bookings: Array<{
    id: string;
    time: string;
    title: string;
    players: number;
    rate: number;
    status: BookingStatus;
  }>;
};

export type WeekReport = {
  from: string;
  to: string;
  days: DailyReport[];
  summary: {
    total_days: number;
    total_tee_times: number;
    total_booked_slots: number;
    total_revenue: number;
    collected_revenue: number;
    average_occupancy: number;
  };
};

// ===== Orchestration =====

export type TaskState = "queued" | "running" | "success" | "failed";

export type OrchestrationTask = {
  id: string;
  name: string;
  state: TaskState;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  detail: string;
  result: Record<string, unknown> | null;
  error: string | null;
};

export type OrchestrationStatus = {
  status: string;
  total_bookings: number;
  timestamp: string;
  available_tasks: Array<{ name: string; description: string; endpoint: string }>;
  tasks: OrchestrationTask[];
};

export type TaskAck = {
  accepted: boolean;
  tasks: OrchestrationTask[];
  message: string;
};

// ===== UI-side view models =====

export type ViewMode = "week" | "day";

export type ConnectionState = "connecting" | "online" | "offline";

export type Toast = { id: string; kind: "info" | "error" | "success"; text: string };

/**
 * The single controller object returned by `useTeeSheet`.
 * Every tee sheet component receives this (or a slice of it) as props — it is the
 * contract between the page shell, the grid, the detail panel and the panels.
 */
export type TeeSheetController = {
  // data
  bookings: TeeBooking[];
  /** Bookings limited to the currently visible range (day or week). */
  visibleBookings: TeeBooking[];
  slots: TeeSlot[];
  selected: TeeBooking | null;
  selectedId: string | null;

  // view state
  view: ViewMode;
  /** ISO date of the Monday anchoring the visible week. */
  weekStart: string;
  /** ISO date of the focused day. */
  focusedDate: string;
  /** 7 ISO dates, Monday..Sunday, for the visible week. */
  weekDates: string[];

  // connection + messaging
  connection: ConnectionState;
  message: string;
  toasts: Toast[];
  busy: boolean;
  dismissToast: (id: string) => void;

  // stats for the visible range
  stats: {
    reservations: number;
    players: number;
    arrived: number;
    paid: number;
    carts: number;
    revenue: number;
    outstanding: number;
  };

  // view actions
  setView: (view: ViewMode) => void;
  setFocusedDate: (isoDate: string) => void;
  goToPreviousWeek: () => void;
  goToNextWeek: () => void;
  goToToday: () => void;
  select: (bookingId: string | null) => void;

  // booking actions
  createBooking: (input: CreateBookingInput) => Promise<TeeBooking | null>;
  patchBooking: (bookingId: string, patch: PatchBookingInput) => Promise<TeeBooking | null>;
  deleteBooking: (bookingId: string) => Promise<boolean>;
  moveBooking: (bookingId: string, date: string, time: string) => Promise<TeeBooking | null>;
  setStatus: (bookingId: string, status: BookingStatus, cancelReason?: string) => Promise<TeeBooking | null>;

  // player actions
  addPlayer: (bookingId: string, input?: AddPlayerInput) => Promise<TeeBooking | null>;
  patchPlayer: (bookingId: string, playerId: string, patch: PatchPlayerInput) => Promise<TeeBooking | null>;
  removePlayer: (bookingId: string, playerId: string) => Promise<TeeBooking | null>;

  // misc
  refresh: () => Promise<void>;
};
