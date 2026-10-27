import { Link } from 'wouter';
import { CalendarDays, ChevronRight, MapPin, Navigation, Ticket, UtensilsCrossed } from 'lucide-react';
import { NotificationOptIn, PromoBanner } from '@/components';
import { PELHAM_HILLS, PELHAM_HILLS_HOLES } from '@/data/pelhamHills';

const tile =
  'w-full max-w-md p-5 rounded-xl border-2 border-border hover:border-primary/50 bg-background transition-colors flex items-center gap-4';

/**
 * 첫 화면은 두 갈래: 티타임 예약, 그리고 코스에서 쓰는 GPS·스코어카드.
 *
 * 예약은 클럽 예약 사이트를 앱 안의 /book 화면에 띄운 것이다 (pages/Book.tsx).
 * 이 앱은 티 시트 API 를 부르지 않으므로, 비행기 모드에서도 이 화면과 GPS 는
 * 그대로 열린다.
 */
export default function Home() {
  const yards = Math.round(
    PELHAM_HILLS_HOLES.reduce((sum, h) => sum + h.length, 0) * 1.09361
  );

  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 py-10">
      <div className="text-center mb-2">
        <h1 className="text-3xl font-bold">{PELHAM_HILLS.name}</h1>
        <p className="text-sm text-muted-foreground flex items-center justify-center gap-1 mt-1.5">
          <MapPin className="w-3.5 h-3.5" />
          {PELHAM_HILLS.location}
        </p>
      </div>

      <Link href="/book" className={tile}>
        <span className="grid place-items-center w-12 h-12 rounded-full bg-primary/10 shrink-0">
          <CalendarDays className="w-6 h-6 text-primary" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-lg">Book a tee time</span>
          <span className="block text-sm text-muted-foreground">
            Pick a day and time on the club&apos;s tee sheet
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </Link>

      <Link href={`/golf/${PELHAM_HILLS.id}`} className={tile}>
        <span className="grid place-items-center w-12 h-12 rounded-full bg-primary/10 shrink-0">
          <Navigation className="w-6 h-6 text-primary" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-lg">Course GPS</span>
          <span className="block text-sm text-muted-foreground">
            Distances, hole guide and scorecard
          </span>
          <span className="block text-xs text-muted-foreground mt-1">
            Par {PELHAM_HILLS.par} · {PELHAM_HILLS.holes} holes · {yards.toLocaleString()} yds
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </Link>

      <Link href="/food" className={tile}>
        <span className="grid place-items-center w-12 h-12 rounded-full bg-primary/10 shrink-0">
          <UtensilsCrossed className="w-6 h-6 text-primary" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-lg">Order food</span>
          <span className="block text-sm text-muted-foreground">
            Pick from the pro shop menu and choose a pickup time
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </Link>

      <Link href="/coupons" className={tile}>
        <span className="grid place-items-center w-12 h-12 rounded-full bg-primary/10 shrink-0">
          <Ticket className="w-6 h-6 text-primary" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-lg">Coupon book</span>
          <span className="block text-sm text-muted-foreground">
            Play 10 rounds, get 1 free
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </Link>

      {/* 홍보 배너와 알림 신청. 둘 다 보여 줄 게 없으면 스스로 사라지므로,
          아무것도 걸려 있지 않은 날의 첫 화면은 두 타일뿐입니다. */}
      <PromoBanner placement="home" />
      <NotificationOptIn />
    </main>
  );
}
