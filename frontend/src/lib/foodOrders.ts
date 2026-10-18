import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

/**
 * Pro shop food: the menu the club keeps, and the orders players place from the
 * course with a pickup time.
 *
 * Migration 0012. The rules that matter are the database's, not this file's:
 * prices are read from `menu_items` when the order is placed (a phone never
 * sends a price), and the pickup time is checked against the club's hours
 * again in `place_food_order`. What is here is the same arithmetic for the
 * screen, so the player sees what they will be charged before they send it.
 *
 * The order table is closed to the publishable key - a player's own order comes
 * back by its confirmation code through `lookup_food_order`, and the pro shop
 * reads the table itself as a signed-in admin.
 */

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  isAvailable: boolean;
  sortOrder: number;
  /**
   * A photo of the thing, from the club's own camera (migration 0015). Null for
   * a row nobody has photographed yet - most of them, at first: the printed
   * boards have no pictures, so every one of these is taken by the pro shop.
   */
  imageUrl: string | null;
}

export interface OrderSettings {
  /** 'HH:MM', club local time. */
  open: string;
  close: string;
  /** How long the kitchen needs before the first pickup slot. */
  leadMinutes: number;
  /** Pickup times go in steps of this many minutes. */
  slotMinutes: number;
  enabled: boolean;
}

export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  open: '08:00',
  close: '19:00',
  leadMinutes: 20,
  slotMinutes: 10,
  enabled: true,
};

export interface OrderLine {
  item: MenuItem;
  quantity: number;
}

export interface PlacedOrderItem {
  id: string;
  name: string;
  quantity: number;
  price_cents: number;
}

export interface PlacedOrder {
  code: string;
  items: PlacedOrderItem[];
  totalCents: number;
  pickupAt: string;
  status: OrderStatus;
  customerName?: string;
  createdAt?: string;
}

export type OrderStatus = 'new' | 'ready' | 'picked_up' | 'cancelled';

export interface ShopOrder extends PlacedOrder {
  id: string;
  customerName: string;
  phone: string;
  note: string;
  holeNumber: number | null;
  createdAt: string;
  /**
   * When the counter took the money, and how (migration 0018). Null until they
   * do. The app never takes payment - this is the club writing down that they
   * did, so that a shift change does not lose it.
   *
   * Deliberately not on the customer's copy of an order: a phone showing
   * "paid" reads as the app having charged them, and it has not.
   */
  paidAt: string | null;
  paidMethod: PaymentMethod | null;
  /**
   * What goes on the receipt beside the method (migration 0021). Cash: what the
   * customer handed over - the change is that minus the total. Card: the last
   * four digits and the terminal's approval number. Never the full card number:
   * the column only holds four digits.
   */
  paidCashCents: number | null;
  paidCardLast4: string | null;
  paidCardAuth: string | null;
}

/** The extra facts a payment can carry. Only the ones matching the method are sent. */
export interface PaymentDetails {
  cashCents?: number | null;
  cardLast4?: string | null;
  cardAuth?: string | null;
}

export type PaymentMethod = 'cash' | 'card' | 'member';

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: '현금',
  card: '카드',
  member: '회원 계정',
};

export const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * The order the club's two printed boards read in - food and snacks on one,
 * the drinks on the other.
 *
 * The menu arrives from PostgREST sorted by category name, which is alphabetical
 * and puts Beer above Food. That is nobody's menu. A category the club invents
 * later is on neither board, so it sorts after these by name rather than
 * silently landing at the top.
 */
const BOARD_ORDER = ['Food', 'Snacks', 'Beer', 'Cider & Seltzer'];

export const compareCategories = (a: string, b: string): number => {
  const ia = BOARD_ORDER.indexOf(a);
  const ib = BOARD_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  return (ia === -1 ? BOARD_ORDER.length : ia) - (ib === -1 ? BOARD_ORDER.length : ib);
};

export const orderTotalCents = (lines: OrderLine[]): number =>
  lines.reduce((sum, line) => sum + line.item.priceCents * line.quantity, 0);

// ---------------------------------------------------------------------------
// Pickup times
// ---------------------------------------------------------------------------

/**
 * The club's own clock, whatever the phone is set to.
 *
 * A phone carried from another time zone - or simply set wrong - would
 * otherwise draw pickup times from its own clock, and the database would
 * refuse every one of them as "today only" or as off the grid. The same
 * mistake the club's booking site made twice with toISOString().
 */
export const CLUB_TIME_ZONE = 'America/Toronto';

interface ClubClock {
  /** YYYY-MM-DD in the club's day. */
  date: string;
  minutes: number;
  /** '-04:00' etc., so a club-local time can be turned back into an instant. */
  offset: string;
}

export const clubClock = (at: Date = new Date()): ClubClock => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // 'GMT-04:00', and plain 'GMT' when the club is on UTC.
  const zone = get('timeZoneName').replace('GMT', '') || '+00:00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    offset: zone,
  };
};

/** The instant at which the club's clock reads `minutes` past midnight today. */
const clubInstant = (clock: ClubClock, minutes: number): Date =>
  new Date(
    `${clock.date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00${clock.offset}`
  );

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/**
 * The pickup times a player may choose: every `slotMinutes` step from the first
 * one the kitchen can make, to closing, on the club's clock. Empty once the
 * shop is shut for the day.
 */
export const pickupSlots = (now: Date, settings: OrderSettings): Date[] => {
  const step = Math.max(1, settings.slotMinutes);
  const clock = clubClock(now);
  const earliest = clock.minutes + Math.max(0, settings.leadMinutes);
  const first = Math.ceil(Math.max(earliest, minutesOf(settings.open)) / step) * step;
  const slots: Date[] = [];
  for (let m = first; m <= minutesOf(settings.close); m += step) slots.push(clubInstant(clock, m));
  return slots;
};

/** "2:30 PM" at the pro shop counter - not on a phone still set to another zone. */
export const clockTime = (at: Date | string): string =>
  (typeof at === 'string' ? new Date(at) : at).toLocaleTimeString('en-US', {
    timeZone: CLUB_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  });

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

interface MenuRow {
  id: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  is_available: boolean;
  sort_order: number;
  image_url?: string | null;
}

// image_url is 0015's. A club that has not run it yet gets a 42703 from
// PostgREST for the whole query, so the ask is dropped for the rest of the
// session the first time that happens - the menu matters more than the
// pictures. Both spellings are written out rather than built from a variable:
// supabase-js parses the column list at the type level, and it can only do
// that for a literal.
const MENU_COLUMNS =
  'id, name, description, category, price_cents, is_available, sort_order, image_url';
const MENU_COLUMNS_NO_PHOTO =
  'id, name, description, category, price_cents, is_available, sort_order';
let menuHasPhotos = true;

/** 42703 is undefined_column: the club has not run 0015. */
const isMissingPhotoColumn = (error: { code?: string } | null): boolean =>
  menuHasPhotos && error?.code === '42703';
const CACHE_KEY = 'golf.menu';

const toItem = (r: MenuRow): MenuItem => ({
  id: r.id,
  name: r.name,
  description: r.description ?? '',
  category: r.category ?? '',
  priceCents: Number(r.price_cents),
  isAvailable: r.is_available,
  sortOrder: Number(r.sort_order ?? 0),
  imageUrl: r.image_url ?? null,
});

/** The menu as this phone last saw it - the first frame, and all there is with no signal. */
export const cachedMenu = (): MenuItem[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as MenuItem[]) : [];
  } catch {
    return [];
  }
};

export const fetchMenu = async (): Promise<{ items: MenuItem[] | null; problem: ServerProblem | null }> => {
  if (!supabase) return { items: null, problem: 'unavailable' };
  const db = supabase;
  try {
    const read = (columns: typeof MENU_COLUMNS | typeof MENU_COLUMNS_NO_PHOTO) =>
      db
        .from('menu_items')
        .select(columns)
        .order('category')
        .order('sort_order')
        .order('name');

    let { data, error } = menuHasPhotos
      ? await read(MENU_COLUMNS)
      : await read(MENU_COLUMNS_NO_PHOTO);
    if (isMissingPhotoColumn(error)) {
      menuHasPhotos = false;
      ({ data, error } = await read(MENU_COLUMNS_NO_PHOTO));
    }
    if (error) return { items: null, problem: problemOf(error) };
    const items = ((data ?? []) as unknown as MenuRow[]).map(toItem);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch {
      /* no storage: fetched again next time */
    }
    return { items, problem: null };
  } catch (err) {
    return { items: null, problem: problemOf(err as { message?: string }) };
  }
};

export const fetchOrderSettings = async (): Promise<OrderSettings> => {
  if (!supabase) return DEFAULT_ORDER_SETTINGS;
  try {
    const { data, error } = await supabase.rpc('food_order_settings');
    if (error || !data || typeof data !== 'object') return DEFAULT_ORDER_SETTINGS;
    const raw = data as Record<string, unknown>;
    return {
      open: typeof raw.open === 'string' ? raw.open : DEFAULT_ORDER_SETTINGS.open,
      close: typeof raw.close === 'string' ? raw.close : DEFAULT_ORDER_SETTINGS.close,
      leadMinutes: Number(raw.lead_minutes ?? DEFAULT_ORDER_SETTINGS.leadMinutes),
      slotMinutes: Number(raw.slot_minutes ?? DEFAULT_ORDER_SETTINGS.slotMinutes),
      enabled: raw.enabled !== false,
    };
  } catch {
    return DEFAULT_ORDER_SETTINGS;
  }
};

// ---------------------------------------------------------------------------
// Placing and finding an order
// ---------------------------------------------------------------------------

/** What went wrong, in words a player can act on. The database writes most of these. */
export class OrderError extends Error {
  readonly problem: ServerProblem | 'rejected';

  constructor(message: string, problem: ServerProblem | 'rejected' = 'rejected') {
    super(message);
    this.name = 'OrderError';
    this.problem = problem;
  }
}

const OFFLINE_MESSAGE = 'The pro shop could not be reached. Please try again, or call them.';

const asOrder = (value: unknown): PlacedOrder => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    code: String(raw.code ?? ''),
    items: Array.isArray(raw.items) ? (raw.items as PlacedOrderItem[]) : [],
    totalCents: Number(raw.total_cents ?? 0),
    pickupAt: String(raw.pickup_at ?? ''),
    status: (raw.status as OrderStatus) ?? 'new',
    customerName: typeof raw.customer_name === 'string' ? raw.customer_name : undefined,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : undefined,
  };
};

export const placeOrder = async (input: {
  name: string;
  phone: string;
  note?: string;
  holeNumber?: number | null;
  pickupAt: Date;
  lines: OrderLine[];
}): Promise<PlacedOrder> => {
  if (!supabase) throw new OrderError('Ordering is not set up on this build.', 'unavailable');
  const { data, error } = await supabase.rpc('place_food_order', {
    p: {
      name: input.name.trim(),
      phone: input.phone.trim(),
      note: input.note?.trim() ?? '',
      hole: input.holeNumber ?? null,
      pickup_at: input.pickupAt.toISOString(),
      items: input.lines.map((line) => ({ id: line.item.id, quantity: line.quantity })),
    },
  });
  if (error) {
    // A PTxxx code is the database refusing the order in words meant for the
    // player ("that time has passed"). Everything else is plumbing, and gets a
    // sentence with no jargon in it.
    if (/^PT\d{3}$/.test(error.code ?? '')) throw new OrderError(error.message);
    const problem = problemOf(error);
    if (problem === 'missingTable') {
      throw new OrderError('Food ordering is not switched on yet. Please call the pro shop.', problem);
    }
    throw new OrderError(OFFLINE_MESSAGE, problem);
  }
  return asOrder(data);
};

export const lookupOrder = async (code: string): Promise<PlacedOrder | null> => {
  if (!supabase) throw new OrderError(OFFLINE_MESSAGE, 'unavailable');
  const { data, error } = await supabase.rpc('lookup_food_order', { p_code: code.trim() });
  if (error) throw new OrderError(OFFLINE_MESSAGE, problemOf(error));
  return data ? asOrder(data) : null;
};

// ---------------------------------------------------------------------------
// The pro shop
// ---------------------------------------------------------------------------

// 0018's two columns are asked for by name like the rest; a club that has not
// run it gets 42703 and fetchShopOrders falls back, the same bargain the menu
// photos make. The counter screen then simply has no payment column.
// 0021's detail columns fall back the same way, one level further in.
const SHOP_COLUMNS_DETAIL =
  'id, code, customer_name, phone, note, items, total_cents, pickup_at, hole_number, status, created_at, paid_at, paid_method, paid_cash_cents, paid_card_last4, paid_card_auth';
const SHOP_COLUMNS =
  'id, code, customer_name, phone, note, items, total_cents, pickup_at, hole_number, status, created_at, paid_at, paid_method';
const SHOP_COLUMNS_NO_PAYMENT =
  'id, code, customer_name, phone, note, items, total_cents, pickup_at, hole_number, status, created_at';
let ordersHavePayment = true;
let ordersHavePaymentDetail = true;

interface ShopRow {
  id: string;
  code: string;
  customer_name: string;
  phone: string;
  note: string;
  items: PlacedOrderItem[];
  total_cents: number;
  pickup_at: string;
  hole_number: number | null;
  status: OrderStatus;
  created_at: string;
  paid_at?: string | null;
  paid_method?: string | null;
  paid_cash_cents?: number | null;
  paid_card_last4?: string | null;
  paid_card_auth?: string | null;
}

/** Whether this server has 0018's payment columns. False until a read says so. */
export const ordersTrackPayment = (): boolean => ordersHavePayment;

/** Whether this server has 0021's detail columns (cash handed over, card last 4). */
export const ordersTrackPaymentDetail = (): boolean => ordersHavePayment && ordersHavePaymentDetail;

/** Today's orders, soonest pickup first. Admin only - row security decides, not this query. */
export const fetchShopOrders = async (): Promise<{
  orders: ShopOrder[] | null;
  problem: ServerProblem | null;
}> => {
  if (!supabase) return { orders: null, problem: 'unavailable' };
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const db = supabase;
    const read = (
      columns: typeof SHOP_COLUMNS_DETAIL | typeof SHOP_COLUMNS | typeof SHOP_COLUMNS_NO_PAYMENT
    ) =>
      db
        .from('food_orders')
        .select(columns)
        .gte('pickup_at', since.toISOString())
        .order('pickup_at');

    let { data, error } = !ordersHavePayment
      ? await read(SHOP_COLUMNS_NO_PAYMENT)
      : ordersHavePaymentDetail
        ? await read(SHOP_COLUMNS_DETAIL)
        : await read(SHOP_COLUMNS);
    // 0021 not run: drop its columns first, then (below) 0018's if need be.
    if (error && ordersHavePayment && ordersHavePaymentDetail && error.code === '42703') {
      ordersHavePaymentDetail = false;
      ({ data, error } = await read(SHOP_COLUMNS));
    }
    // 42703: undefined_column - 0018 has not been run. Ask again without it,
    // and stop asking for the rest of the session. The pro shop needs today's
    // orders far more than it needs the paid column.
    if (error && ordersHavePayment && error.code === '42703') {
      ordersHavePayment = false;
      ({ data, error } = await read(SHOP_COLUMNS_NO_PAYMENT));
    }
    if (error) return { orders: null, problem: problemOf(error) };
    const orders = ((data ?? []) as unknown as ShopRow[]).map((r) => ({
      id: r.id,
      code: r.code,
      customerName: r.customer_name,
      phone: r.phone,
      note: r.note ?? '',
      items: Array.isArray(r.items) ? r.items : [],
      totalCents: Number(r.total_cents),
      pickupAt: r.pickup_at,
      holeNumber: r.hole_number,
      status: r.status,
      createdAt: r.created_at,
      paidAt: r.paid_at ?? null,
      paidMethod: (r.paid_method as PaymentMethod | null) ?? null,
      paidCashCents: r.paid_cash_cents ?? null,
      paidCardLast4: r.paid_card_last4 ?? null,
      paidCardAuth: r.paid_card_auth ?? null,
    }));
    return { orders, problem: null };
  } catch (err) {
    return { orders: null, problem: problemOf(err as { message?: string }) };
  }
};

export const setOrderStatus = async (id: string, status: OrderStatus): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  const { error } = await supabase.from('food_orders').update({ status }).eq('id', id);
  return error ? problemOf(error) : null;
};

/**
 * Write down that the counter took the money, or take it back (migration 0018).
 *
 * Separate from the status on purpose. 'picked_up' means the food left the
 * counter; paid means the money arrived. They usually happen together and one
 * day a week they do not, and a screen that collapses them into one button is a
 * screen that cannot tell you which of the two went wrong.
 */
export const setOrderPayment = async (
  id: string,
  method: PaymentMethod | null,
  details: PaymentDetails = {}
): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  // The column is not there. Saying so is better than a write that looks like
  // it worked; the counter screen turns the buttons off on this answer.
  if (!ordersHavePayment) return 'missingTable';
  const row: Record<string, string | number | null> = method
    ? { paid_at: new Date().toISOString(), paid_method: method }
    : { paid_at: null, paid_method: null };
  if (ordersHavePaymentDetail) {
    // Cleared on every write so an undo, or a switch from cash to card, leaves
    // nothing of the last payment behind (0021's CHECK would refuse it anyway).
    row.paid_cash_cents = method === 'cash' ? (details.cashCents ?? null) : null;
    row.paid_card_last4 = method === 'card' ? (details.cardLast4 ?? null) : null;
    row.paid_card_auth = method === 'card' ? (details.cardAuth ?? null) : null;
  }
  const { error } = await supabase.from('food_orders').update(row).eq('id', id);
  return error ? problemOf(error) : null;
};

// ---------------------------------------------------------------------------
// The orders this phone placed
// ---------------------------------------------------------------------------

/**
 * `food_orders` is closed to a player - an order comes back only by its
 * confirmation code, through `lookup_food_order` (migration 0012). That is the
 * right rule: without it, anybody with the publishable key could read every
 * order the club took today, names and phone numbers included.
 *
 * It does mean the code is the whole of a player's claim on their own order, so
 * the phone keeps the codes it was given. A player who backs out of the
 * confirmation screen - or comes back two holes later to see if it is ready -
 * finds the order waiting rather than a box asking for six characters they read
 * once on the 8th tee.
 *
 * On this phone only. Clearing the browser's storage loses the codes, not the
 * orders; the pro shop still has them, and the counter takes a name.
 */
const MY_ORDERS_KEY = 'golf.food.myOrders';

/** Enough for a round. Older codes are dropped rather than kept for ever. */
const REMEMBERED_ORDERS = 10;

export const myOrderCodes = (): string[] => {
  try {
    const raw = localStorage.getItem(MY_ORDERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]).filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
};

export const rememberOrderCode = (code: string): void => {
  try {
    const next = [code, ...myOrderCodes().filter((c) => c !== code)].slice(0, REMEMBERED_ORDERS);
    localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(next));
  } catch {
    /* the code is still on the confirmation screen */
  }
};

/**
 * Orders the player has taken off their own screen.
 *
 * A separate list from the codes, and it has to be. Since 0016 the list is also
 * looked up by phone number, so dropping a code no longer hides anything - the
 * next open finds the order again by number and puts it straight back. This is
 * the list that makes "hide" stick.
 *
 * It hides, it does not cancel. The pro shop still has the order, and the order
 * is still going to be made - which is why the button that writes to this is
 * next to a Cancel that actually cancels.
 */
const HIDDEN_ORDERS_KEY = 'golf.food.hiddenOrders';

const hiddenOrderCodes = (): string[] => {
  try {
    const raw = localStorage.getItem(HIDDEN_ORDERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]).filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
};

export const hideOrder = (code: string): void => {
  try {
    const next = [code, ...hiddenOrderCodes().filter((c) => c !== code)].slice(0, 40);
    localStorage.setItem(HIDDEN_ORDERS_KEY, JSON.stringify(next));
  } catch {
    /* it will come back on the next open, which is the honest failure */
  }
  forgetOrderCode(code);
};

/** Typing a code into Find an order is asking for it back. */
export const unhideOrder = (code: string): void => {
  try {
    localStorage.setItem(
      HIDDEN_ORDERS_KEY,
      JSON.stringify(hiddenOrderCodes().filter((c) => c !== code))
    );
  } catch {
    /* nothing to unhide it from */
  }
};

export const forgetOrderCode = (code: string): void => {
  try {
    localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(myOrderCodes().filter((c) => c !== code)));
  } catch {
    /* nothing to forget it from */
  }
};

/**
 * Cancel an order the pro shop has not started yet (migration 0017).
 *
 * The code is the claim, exactly as it is for reading one. The database decides
 * whether it is too late - 'ready' means it is already made, and a pickup time
 * that has passed means it is sitting on the counter - and says so in words the
 * screen can show.
 *
 * Cancelling twice is not an error: a second tab, or a tap that went out twice
 * on a bad signal, both come back with the cancelled order.
 */
export const cancelOrder = async (code: string): Promise<PlacedOrder> => {
  if (!supabase) throw new OrderError(OFFLINE_MESSAGE, 'unavailable');
  const { data, error } = await supabase.rpc('cancel_food_order', { p_code: code.trim() });
  if (error) {
    // PGRST202: 0017 has not been run. Say something a player can act on rather
    // than the name of a missing function.
    if (error.code === 'PGRST202') {
      throw new OrderError(
        'This order cannot be cancelled from the app yet. Please call the pro shop.',
        'other'
      );
    }
    throw new OrderError(error.message || OFFLINE_MESSAGE, problemOf(error));
  }
  return asOrder(data);
};

/**
 * Today's orders for a phone number, without a code (migration 0016).
 *
 * The number is the one already saved on the device from the last order, so
 * the player types nothing. It is a weaker key than a code - a code is one of
 * 32^6, a phone number can be guessed - so 0016 only answers for today, wants
 * at least eight digits, and never returns the number itself. If the club
 * decides that is too much, revoking `my_food_orders` is enough; this falls
 * back to the remembered codes on its own.
 */
const fetchOrdersByPhone = async (phone: string): Promise<PlacedOrder[]> => {
  if (!supabase) return [];
  if (phone.replace(/\D/g, '').length < 8) return [];
  try {
    const { data, error } = await supabase.rpc('my_food_orders', { p_phone: phone });
    // 0016 not run (PGRST202), or anything else. The codes below still work.
    if (error || !Array.isArray(data)) return [];
    return (data as unknown[]).map((row) => asOrder(row));
  } catch {
    return [];
  }
};

/**
 * Every order this phone can show, newest pickup first, with nothing typed.
 *
 * Two sources, because neither covers the round on its own:
 *
 * - **The number on the device.** Catches orders this phone does not hold a
 *   code for - one placed before the app started keeping them, or from the
 *   clubhouse iPad while the player was at the counter.
 * - **The codes this phone kept.** Catches an order placed under a different
 *   number, and is the whole of it where the club has not run 0016.
 *
 * A code that answers `null` is dropped - the club can delete an order, and a
 * row saying "not found" for ever is worse than no row. A code that *throws* is
 * kept: that is this phone being on the 12th with no signal, not the server
 * saying the order is gone. The codes are asked for together rather than one
 * after another; there are at most ten and a player should not wait ten trips.
 */
export const fetchMyOrders = async (): Promise<PlacedOrder[]> => {
  const codes = myOrderCodes();
  const { phone } = lastOrderContact();

  const [byPhone, found] = await Promise.all([
    phone ? fetchOrdersByPhone(phone) : Promise.resolve([]),
    Promise.all(
      codes.map(async (code) => {
        try {
          return await lookupOrder(code);
        } catch {
          return undefined;
        }
      })
    ),
  ]);

  const orders: PlacedOrder[] = [...byPhone];
  const seen = new Set(orders.map((o) => o.code));

  found.forEach((order, i) => {
    if (order === null) {
      forgetOrderCode(codes[i]);
      return;
    }
    if (order && !seen.has(order.code)) {
      seen.add(order.code);
      orders.push(order);
    }
  });

  // An order found by number is worth keeping the code of: if the club ever
  // turns 0016 off, this phone still knows its own orders.
  orders.forEach((order) => rememberOrderCode(order.code));

  // Last, so that nothing above can put a hidden order back. This is the whole
  // reason the hidden list exists - see hideOrder.
  const hidden = new Set(hiddenOrderCodes());
  return orders
    .filter((order) => !hidden.has(order.code))
    .sort((a, b) => +new Date(b.pickupAt) - +new Date(a.pickupAt));
};

/**
 * The name and number this phone last ordered under. Written by pages/Food -
 * this reads the same key, so the lookup above needs nothing passed in.
 */
const CONTACT_KEY = 'golf.food.who';

export const lastOrderContact = (): { name: string; phone: string } => {
  try {
    const raw = localStorage.getItem(CONTACT_KEY);
    const parsed = raw ? (JSON.parse(raw) as { name?: string; phone?: string }) : {};
    return { name: parsed.name ?? '', phone: parsed.phone ?? '' };
  } catch {
    return { name: '', phone: '' };
  }
};

export type MenuItemInput = Omit<MenuItem, 'id'>;

const toRow = (input: MenuItemInput) => ({
  name: input.name.trim(),
  description: input.description.trim(),
  category: input.category.trim(),
  price_cents: Math.max(0, Math.round(input.priceCents)),
  is_available: input.isAvailable,
  sort_order: Math.round(input.sortOrder),
  // Left out entirely where 0015 has not been run - writing a column that does
  // not exist fails the whole save, and a club editing prices must not be
  // blocked by a migration about pictures.
  ...(menuHasPhotos ? { image_url: input.imageUrl || null } : {}),
});

export const saveMenuItem = async (
  id: string | null,
  input: MenuItemInput
): Promise<{ item: MenuItem | null; problem: ServerProblem | null }> => {
  if (!supabase) return { item: null, problem: 'unavailable' };
  try {
    const query = id
      ? supabase.from('menu_items').update(toRow(input)).eq('id', id)
      : supabase.from('menu_items').insert(toRow(input));
    const { data, error } = await (menuHasPhotos
      ? query.select(MENU_COLUMNS).single()
      : query.select(MENU_COLUMNS_NO_PHOTO).single());
    if (error) return { item: null, problem: problemOf(error) };
    return { item: toItem(data as unknown as MenuRow), problem: null };
  } catch (err) {
    return { item: null, problem: problemOf(err as { message?: string }) };
  }
};

export const deleteMenuItem = async (id: string): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  const { error } = await supabase.from('menu_items').delete().eq('id', id);
  return error ? problemOf(error) : null;
};

export const saveOrderSettings = async (settings: OrderSettings): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: 'food_orders',
      value: {
        open: settings.open,
        close: settings.close,
        lead_minutes: settings.leadMinutes,
        slot_minutes: settings.slotMinutes,
        enabled: settings.enabled,
      },
    },
    { onConflict: 'key' }
  );
  return error ? problemOf(error) : null;
};

/** Order alerts on this phone, for a signed-in pro shop account (migration 0012). */
export const setProShopAlerts = async (endpoint: string, on: boolean): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  const { error } = await supabase.rpc('set_proshop_push', { p_endpoint: endpoint, p_on: on });
  return error ? problemOf(error) : null;
};
