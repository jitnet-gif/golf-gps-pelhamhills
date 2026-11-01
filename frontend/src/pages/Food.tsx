import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  Ban,
  ChevronLeft,
  Clock,
  ContactRound,
  EyeOff,
  Loader2,
  Minus,
  Plus,
  Receipt,
  Search,
  UtensilsCrossed,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import {
  cachedMenu,
  clockTime,
  compareCategories,
  DEFAULT_ORDER_SETTINGS,
  fetchMenu,
  fetchMyOrders,
  cancelOrder,
  fetchOrderSettings,
  hideOrder,
  lastOrderContact,
  lookupOrder,
  unhideOrder,
  money,
  orderTotalCents,
  pickupSlots,
  placeOrder,
  rememberOrderCode,
  type MenuItem,
  type OrderLine,
  type OrderSettings,
  type PlacedOrder,
} from '@/lib/foodOrders';
import { BUNDLED_MENU } from '@/data/proShopMenu';
import { menuPhoto } from '@/data/menuImages';
import type { ServerProblem } from '@/lib/holePaths';

/** What an order's state means to the person holding the phone. */
const STATUS_TEXT: Record<PlacedOrder['status'], string> = {
  new: 'The pro shop has it',
  ready: 'Ready to pick up',
  picked_up: 'Picked up',
  cancelled: 'Cancelled - call the pro shop',
};

const CLUB_PHONE = '+1 (905) 735-6768';
const CLUB_PHONE_HREF = 'tel:+19057356768';

/**
 * Name and phone stay on the phone, so a second round does not retype them -
 * and so `fetchMyOrders` can find today's orders without a code. Reading it is
 * lib/foodOrders' job (`lastOrderContact`), because that is where it is read
 * from too; this end only writes.
 */
const WHO_KEY = 'golf.food.who';

/**
 * Taking the name and number off the phone rather than making a player type
 * them on the 8th tee. Three ways, in the order they are worth having:
 *
 * 1. What this phone sent last time (above). Works everywhere, needs no
 *    permission, and after the first order it is the only one that runs.
 * 2. The name on the scorecard, for a first order - the player already typed
 *    it at the start of the round.
 * 3. The phone's own contacts, for the number, which is the field nothing else
 *    can fill.
 *
 * There is no way for a web page to read the number out of the SIM - no browser
 * exposes it, on purpose. The Contact Picker below is the closest thing that
 * exists: the player taps the button, the phone shows its own contact list, and
 * whichever card they pick (their own, usually) comes back as a name and a
 * number. The page never sees anything they did not choose.
 *
 * Chrome on Android only, and only over https. Everywhere else the button is
 * not drawn and the fields work as they always did, with the keyboard's own
 * autofill behind `autocomplete`.
 */
interface ContactsApi {
  select: (
    properties: string[],
    options?: { multiple?: boolean }
  ) => Promise<{ name?: string[]; tel?: string[] }[]>;
  getProperties?: () => Promise<string[]>;
}

const contactsApi = (): ContactsApi | null => {
  const api = (navigator as Navigator & { contacts?: ContactsApi }).contacts;
  return api && typeof api.select === 'function' && 'ContactsManager' in window ? api : null;
};

/**
 * Ordering food from the pro shop while the round is still going, for pickup at
 * a time the player chooses.
 *
 * The menu and the pickup rules are the club's, kept in the database (migration
 * 0012) and edited in /admin - this screen holds no prices and no opening hours
 * of its own. The order is priced again by the database when it is sent, so a
 * stale menu on a phone cannot buy a burger at yesterday's price.
 *
 * Payment is at the counter. The app takes no money.
 */
export default function Food() {
  // The club's menu, best copy first: what this phone last saw, then the boards
  // bundled into the app. Never an empty screen - see data/proShopMenu.
  const [menu, setMenu] = useState<MenuItem[]>(() => {
    const cached = cachedMenu();
    return cached.length ? cached : BUNDLED_MENU;
  });
  /**
   * The pro shop's table has no menu in it yet - the server answered, and
   * answered with nothing (0013 not run). The board is still worth showing, but
   * an order placed against it would be refused by the database with something
   * about the menu having changed, which is not what happened. So the screen
   * says what is actually true and offers the phone instead.
   */
  const [menuUnseeded, setMenuUnseeded] = useState(false);
  /** Why the menu could not be read, when it could not be. 'missingTable' = 0012 not run. */
  const [menuProblem, setMenuProblem] = useState<ServerProblem | null>(null);
  const [settings, setSettings] = useState<OrderSettings>(DEFAULT_ORDER_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [pickup, setPickup] = useState<string>('');
  const [who, setWho] = useState(lastOrderContact);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [allSlots, setAllSlots] = useState(false);
  const [lookupCode, setLookupCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<PlacedOrder | null>(null);
  const [lookupError, setLookupError] = useState('');

  // Which hole the player is on goes with the order, so the pro shop knows how
  // far out they are. The store holds it while the GPS screen is open; a tab
  // opened straight at this page reads the hole that screen left in the tab
  // (Golf.tsx keeps it under the same key), and sends nothing if there is none.
  const storeHole = useAppStore((s) => s.uiState.selectedHole);
  const holeNumber = useMemo(() => {
    if (storeHole) return storeHole;
    try {
      return Number(sessionStorage.getItem('golf.selectedHole')) || null;
    } catch {
      return null;
    }
  }, [storeHole]);

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchMenu(), fetchOrderSettings()]).then(([menuResult, shopSettings]) => {
      if (!alive) return;
      // Zero rows is not a menu. Keep the bundled boards on screen and
      // remember why, rather than replacing them with nothing.
      if (menuResult.items?.length) setMenu(menuResult.items);
      setMenuUnseeded(menuResult.items?.length === 0);
      setMenuProblem(menuResult.problem);
      setLoadFailed(!menuResult.items);
      setSettings(shopSettings);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The orders this phone has placed, looked up by the codes it kept - see
  // lib/foodOrders. Re-read whenever the screen is opened, because the state
  // that changes is the pro shop's ('ready'), not this phone's.
  const [myOrders, setMyOrders] = useState<PlacedOrder[]>([]);
  const refreshMyOrders = useCallback(() => {
    void fetchMyOrders().then(setMyOrders);
  }, []);
  useEffect(refreshMyOrders, [refreshMyOrders]);

  // The name on the card, for a player who has not ordered from this phone
  // before. 'Me' is the card's own placeholder and names nobody at a counter.
  const cardName = useAppStore((s) => s.scorecard?.players?.[0]?.name ?? '');
  useEffect(() => {
    if (cardName && cardName !== 'Me') {
      setWho((current) => (current.name ? current : { ...current, name: cardName }));
    }
  }, [cardName]);

  // 취소 중인 주문 코드, 그리고 서버가 거절한 이유(이미 만들었다 등).
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<{ code: string; message: string } | null>(null);

  const cancel = async (order: PlacedOrder) => {
    if (
      !window.confirm(
        `Cancel order ${order.code}? The pro shop will stop making it. You cannot undo this.`
      )
    ) {
      return;
    }
    setCancelling(order.code);
    setCancelError(null);
    try {
      const cancelled = await cancelOrder(order.code);
      setMyOrders((rows) => rows.map((r) => (r.code === cancelled.code ? cancelled : r)));
      setFound((current) => (current && current.code === cancelled.code ? cancelled : current));
    } catch (failure) {
      // Usually "already made" or "pickup time has passed" - the words come
      // from the database, which is the only thing that knows.
      setCancelError({
        code: order.code,
        message: failure instanceof Error ? failure.message : 'That order could not be cancelled.',
      });
      // Whatever the reason, the state on screen is stale - go and look.
      refreshMyOrders();
    } finally {
      setCancelling(null);
    }
  };

  const [contactProblem, setContactProblem] = useState('');
  const canPickContact = useMemo(() => contactsApi() !== null, []);

  const pickContact = async () => {
    const api = contactsApi();
    if (!api) return;
    setContactProblem('');
    try {
      const [picked] = await api.select(['name', 'tel'], { multiple: false });
      if (!picked) return;
      const name = picked.name?.[0]?.trim() ?? '';
      const phone = picked.tel?.[0]?.trim() ?? '';
      if (!name && !phone) {
        setContactProblem('That contact has no name or number saved.');
        return;
      }
      // Only fill what the contact actually carries: a card with no number must
      // not wipe a number the player already typed.
      setWho((current) => ({
        name: name || current.name,
        phone: phone || current.phone,
      }));
    } catch {
      // Cancelling the picker throws too, and a cancel is not an error worth
      // a line of red on the screen.
      setContactProblem('');
    }
  };

  // The hours are the pro shop's to change from /admin, and a player may keep
  // this screen open for nine holes. So the settings are read again every
  // minute and whenever the phone comes back to the page, and the clock ticks
  // so a pickup time that has gone by drops off the list.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setNow(new Date());
      void fetchOrderSettings().then((shopSettings) => {
        if (alive) setSettings(shopSettings);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const slots = useMemo(() => pickupSlots(now, settings), [now, settings]);
  useEffect(() => {
    // A time the shop no longer offers - passed, or outside new hours - would
    // only come back from the database as a refusal.
    if (pickup && slots.some((slot) => slot.toISOString() === pickup)) return;
    setPickup(slots.length ? slots[0].toISOString() : '');
  }, [slots, pickup]);

  const lines: OrderLine[] = useMemo(
    () =>
      menu
        .filter((item) => (quantities[item.id] ?? 0) > 0 && item.isAvailable)
        .map((item) => ({ item, quantity: quantities[item.id] })),
    [menu, quantities]
  );
  const total = orderTotalCents(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  const categories = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of menu) {
      const key = item.category || 'Menu';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    // The club's board order, not the alphabet - see compareCategories.
    return [...groups.entries()].sort(([a], [b]) => compareCategories(a, b));
  }, [menu]);

  const setQuantity = (id: string, next: number) =>
    setQuantities((current) => ({ ...current, [id]: Math.max(0, Math.min(20, next)) }));

  const send = async () => {
    setSending(true);
    setError('');
    try {
      const order = await placeOrder({
        name: who.name,
        phone: who.phone,
        note,
        holeNumber,
        pickupAt: new Date(pickup),
        lines,
      });
      try {
        localStorage.setItem(WHO_KEY, JSON.stringify(who));
      } catch {
        /* the name simply is not remembered */
      }
      rememberOrderCode(order.code);
      refreshMyOrders();
      setPlaced(order);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The order could not be sent.');
      // A refused order usually means the menu or the time moved under us.
      void fetchMenu().then(({ items }) => items?.length && setMenu(items));
    } finally {
      setSending(false);
    }
  };

  const find = async () => {
    setLooking(true);
    setLookupError('');
    setFound(null);
    try {
      const order = await lookupOrder(lookupCode);
      if (order) {
        setFound(order);
        // Typed once, kept from then on - the next visit shows it by itself.
        // Typing a code is also asking for an order back that was hidden.
        rememberOrderCode(order.code);
        unhideOrder(order.code);
        refreshMyOrders();
      }
      else setLookupError('No order with that code. Check the code on your confirmation, or call the pro shop.');
    } catch (failure) {
      setLookupError(failure instanceof Error ? failure.message : 'That order could not be opened.');
    } finally {
      setLooking(false);
    }
  };

  const header = (
    <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
      <Link
        href="/"
        className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1.5 text-sm font-medium text-primary hover:bg-accent"
      >
        <ChevronLeft className="h-4 w-4" />
        Home
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-center text-sm font-semibold">Pro shop food</h1>
      <a href={CLUB_PHONE_HREF} className="rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-accent">
        Call
      </a>
    </header>
  );

  if (placed) {
    return (
      <main className="flex min-h-screen flex-col bg-background">
        {header}
        <div className="mx-auto w-full max-w-md p-4">
          <section className="rounded-2xl border border-border bg-card p-5 text-center">
            <p className="text-3xl" aria-hidden>
              ✓
            </p>
            <h2 className="mt-2 text-xl font-bold text-primary">Order sent to the pro shop</h2>
            <p className="mt-3 text-sm text-muted-foreground">Pick up at</p>
            <p className="text-3xl font-black tabular-nums">{clockTime(placed.pickupAt)}</p>
            <div className="mt-4 border-t border-border pt-4 text-left">
              {placed.items.map((item) => (
                <p key={item.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {item.quantity} × {item.name}
                  </span>
                  <span className="tabular-nums">{money(item.price_cents * item.quantity)}</span>
                </p>
              ))}
              <p className="mt-2 flex justify-between gap-3 border-t border-border pt-2 font-bold">
                <span>Total</span>
                <span className="tabular-nums">{money(placed.totalCents)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Pay at the counter when you pick it up.</p>
            </div>
            <div className="mt-4 rounded-xl bg-muted p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order code</p>
              <p className="font-mono text-2xl font-bold tracking-[0.2em] text-primary">{placed.code}</p>
            </div>
          </section>
          <button
            type="button"
            onClick={() => {
              setPlaced(null);
              setQuantities({});
              setNote('');
            }}
            className="mt-4 h-12 w-full rounded-xl bg-primary text-base font-bold text-primary-foreground"
          >
            Order something else
          </button>
        </div>
      </main>
    );
  }

  /**
   * Nothing on this screen can be ordered: the shop has switched ordering off,
   * it is shut for the day, or its menu table is empty or absent because the
   * club has not run 0012/0013 yet.
   *
   * The board still shows either way - a price list is worth reading on the
   * 8th tee whether or not the kitchen can take the order - but the +/-
   * buttons, the pickup time and the send bar all hang off this.
   */
  const noServerMenu = menuUnseeded || menuProblem === 'missingTable';
  const shut = !settings.enabled || noServerMenu || (!loading && slots.length === 0);

  return (
    <main className="flex min-h-screen flex-col bg-background pb-32">
      {header}
      <div className="mx-auto w-full max-w-md p-4">
        {loading && menu.length === 0 && <p className="text-sm text-muted-foreground">Loading the menu…</p>}

        {!loading && menu.length === 0 && (
          <section className="rounded-xl border border-border bg-card p-5 text-center">
            <UtensilsCrossed className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-semibold">
              {loadFailed ? 'The menu could not be loaded' : 'The pro shop has not put its menu up yet'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">You can still order by phone.</p>
            <a
              href={CLUB_PHONE_HREF}
              className="mt-4 flex h-12 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground"
            >
              Call {CLUB_PHONE}
            </a>
          </section>
        )}

        {/* The club's system is not up yet, so the board below is the app's own
            copy. Saying "not taking orders right now" here would be a lie about
            the hour - see noServerMenu. */}
        {noServerMenu && !loading && (
          <p className="mb-4 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-900 dark:text-amber-200">
            This is the pro shop&apos;s printed menu. Ordering from the app is not switched on yet, so
            please call {CLUB_PHONE} to order.
          </p>
        )}

        {shut && !noServerMenu && menu.length > 0 && (
          <p className="mb-4 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-900 dark:text-amber-200">
            The pro shop is not taking orders right now. It takes orders from {settings.open} to {settings.close}.
            You can still call {CLUB_PHONE}.
          </p>
        )}

        {/* The orders this phone has going. Above the menu, because a player
            who opens this screen mid-round is more often checking on a burger
            than ordering a second one - and the alternative was typing a
            six-character code they read once on the 8th tee. */}
        {myOrders.length > 0 && (
          <section className="mb-5 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
              <Receipt className="h-4 w-4 text-primary" />
              My orders
            </h2>
            <ul className="flex flex-col gap-2">
              {myOrders.map((order) => (
                <li
                  key={order.code}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-bold">
                      <span className="tracking-widest">{order.code}</span>
                      <span className="tabular-nums">{clockTime(order.pickupAt)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          order.status === 'ready'
                            ? 'bg-green-600 text-white'
                            : order.status === 'cancelled'
                              ? 'bg-red-500/15 text-red-800 dark:text-red-200'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {STATUS_TEXT[order.status]}
                      </span>
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}
                    </p>
                    <p className="mt-1 text-sm font-semibold tabular-nums">
                      {money(order.totalCents)}
                    </p>
                  </div>
                  {/* Two different things, so two buttons rather than one X
                      that had to mean both. Hiding takes it off this screen and
                      leaves the order standing; cancelling stops the pro shop
                      making it. The old single X looked like it did the second
                      and did the first. */}
                  <div className="flex shrink-0 flex-col gap-1">
                    {(order.status === 'new' || order.status === 'ready') && (
                      <button
                        type="button"
                        onClick={() => void cancel(order)}
                        disabled={cancelling === order.code}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-red-300 px-2 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300"
                      >
                        {cancelling === order.code ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Ban className="h-3.5 w-3.5" />
                        )}
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        hideOrder(order.code);
                        setMyOrders((rows) => rows.filter((r) => r.code !== order.code));
                      }}
                      title="Take this off my screen - the pro shop keeps the order"
                      className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-muted-foreground"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      Hide
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {cancelError && (
              <p
                role="alert"
                className="mt-2 rounded-lg bg-red-500/15 p-3 text-sm text-red-800 dark:text-red-200"
              >
                {cancelError.code}: {cancelError.message}{' '}
                <a href={CLUB_PHONE_HREF} className="font-semibold underline">
                  {CLUB_PHONE}
                </a>
              </p>
            )}

            <p className="mt-2 text-[11px] text-muted-foreground">
              Pay at the counter when you pick up. Cancel works until the pro shop starts
              making it - after that, give them a call.
            </p>
          </section>
        )}

        {categories.map(([category, items]) => (
          <section key={category} className="mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{category}</h2>
            <ul className="flex flex-col gap-2">
              {items.map((item) => {
                const quantity = quantities[item.id] ?? 0;
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3 rounded-xl border border-border bg-card p-3 ${
                      item.isAvailable ? '' : 'opacity-60'
                    }`}
                  >
                    {/* The picture off the printed board, or the one the club
                        uploaded in /admin if they have replaced it - see
                        data/menuImages. A row with neither keeps the old
                        layout: an empty grey square on the drinks, which the
                        board never pictured one by one, would look more broken
                        than no picture at all. */}
                    {menuPhoto(item.id, item.imageUrl) && (
                      <img
                        src={menuPhoto(item.id, item.imageUrl)!}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={64}
                        height={64}
                        onError={(e) => {
                          // A photo the club deleted, or a fairway with no
                          // signal. Drop it rather than show a broken frame.
                          e.currentTarget.style.display = 'none';
                        }}
                        className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight">{item.name}</p>
                      {item.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                      )}
                      <p className="mt-1 text-sm font-bold tabular-nums text-primary">
                        {money(item.priceCents)}
                        {!item.isAvailable && (
                          <span className="ml-2 text-xs font-semibold text-muted-foreground">Sold out</span>
                        )}
                      </p>
                    </div>
                    {item.isAvailable && !shut && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setQuantity(item.id, quantity - 1)}
                          disabled={quantity === 0}
                          aria-label={`One less ${item.name}`}
                          className="grid h-11 w-11 place-items-center rounded-xl bg-muted disabled:opacity-30"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span
                          aria-label={`${quantity} ${item.name}`}
                          className="w-6 text-center text-base font-bold tabular-nums"
                        >
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQuantity(item.id, quantity + 1)}
                          aria-label={`One more ${item.name}`}
                          className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {itemCount > 0 && !shut && (
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Clock className="h-4 w-4 text-primary" />
              Pick up at
            </h2>
            {/* The next two hours fit the screen; the rest of the day is a tap
                away. A whole day of ten minute steps is fifty buttons, and the
                name and phone below them fall off the bottom of a phone. */}
            <div className="grid grid-cols-4 gap-2">
              {(allSlots ? slots : slots.slice(0, 12)).map((slot) => {
                const value = slot.toISOString();
                const on = value === pickup;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPickup(value)}
                    className={`h-11 rounded-lg text-sm font-semibold tabular-nums ${
                      on ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'
                    }`}
                  >
                    {clockTime(slot)}
                  </button>
                );
              })}
            </div>
            {!allSlots && slots.length > 12 && (
              <button
                type="button"
                onClick={() => setAllSlots(true)}
                className="mt-2 h-11 w-full rounded-lg bg-muted text-sm font-semibold"
              >
                Later today ({slots.length - 12} more times)
              </button>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Orders are taken from {settings.open} to {settings.close}. The kitchen needs{' '}
              {settings.leadMinutes} minutes. Times go in {settings.slotMinutes} minute steps.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {/* One tap instead of typing a name and a number on a fairway.
                  Only drawn where the phone actually has the picker - see
                  contactsApi. */}
              {canPickContact && (
                <button
                  type="button"
                  onClick={() => void pickContact()}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-muted text-sm font-semibold"
                >
                  <ContactRound className="h-4 w-4" />
                  Fill from my contacts
                </button>
              )}
              {contactProblem && (
                <p className="text-xs text-muted-foreground">{contactProblem}</p>
              )}

              <label className="text-sm font-semibold" htmlFor="food-name">
                Name
                <input
                  id="food-name"
                  value={who.name}
                  onChange={(e) => setWho({ ...who, name: e.target.value })}
                  autoComplete="name"
                  className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base font-normal"
                />
              </label>
              <label className="text-sm font-semibold" htmlFor="food-phone">
                Phone
                <input
                  id="food-phone"
                  value={who.phone}
                  onChange={(e) => setWho({ ...who, phone: e.target.value })}
                  autoComplete="tel"
                  inputMode="tel"
                  className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base font-normal"
                />
              </label>
              <label className="text-sm font-semibold" htmlFor="food-note">
                Anything else? (optional)
                <input
                  id="food-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="No onions, extra napkins…"
                  className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base font-normal"
                />
              </label>
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-red-500/15 p-3 text-sm text-red-800 dark:text-red-200">
                {error}
              </p>
            )}
          </section>
        )}

        <section className="mt-6 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <Search className="h-4 w-4 text-primary" />
            Find an order
          </h2>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="food-code">
              Order code
            </label>
            <input
              id="food-code"
              value={lookupCode}
              onChange={(e) => setLookupCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              autoCapitalize="characters"
              className="h-12 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-base uppercase tracking-widest"
            />
            <button
              type="button"
              onClick={() => void find()}
              disabled={!lookupCode.trim() || looking}
              className="h-12 shrink-0 rounded-lg bg-muted px-4 text-sm font-bold disabled:opacity-50"
            >
              {looking ? 'Looking…' : 'Find'}
            </button>
          </div>
          {lookupError && <p className="mt-2 text-sm text-muted-foreground">{lookupError}</p>}
          {found && (
            <div className="mt-3 rounded-lg bg-muted p-3 text-sm">
              <p className="font-bold">
                {found.code} · {clockTime(found.pickupAt)}
              </p>
              <p className="mt-1 text-muted-foreground">
                {found.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}
              </p>
              <p className="mt-1 font-semibold">
                {money(found.totalCents)} ·{' '}
                {STATUS_TEXT[found.status]}
              </p>
              {/* The same Cancel as in My orders - an order found by code is
                  just as much theirs as one this phone remembered. */}
              {(found.status === 'new' || found.status === 'ready') && (
                <button
                  type="button"
                  onClick={() => void cancel(found)}
                  disabled={cancelling === found.code}
                  className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300"
                >
                  {cancelling === found.code ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Ban className="h-4 w-4" />
                  )}
                  Cancel this order
                </button>
              )}
              {cancelError?.code === found.code && (
                <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
                  {cancelError.message}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* The basket rides the bottom of the screen: on a phone the menu is
          longer than the screen, and the total has to stay where the thumb is. */}
      {itemCount > 0 && !shut && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold tabular-nums">
                {itemCount} item{itemCount === 1 ? '' : 's'} · {money(total)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Pickup {pickup ? clockTime(pickup) : '—'} · pay at the counter
              </p>
            </div>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !who.name.trim() || !who.phone.trim() || !pickup}
              className="h-12 shrink-0 rounded-xl bg-primary px-5 text-base font-bold text-primary-foreground disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send order'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
