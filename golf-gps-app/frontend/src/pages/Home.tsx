import { Link } from 'wouter';
import { CalendarDays, ChevronRight, MapPin } from 'lucide-react';
import { NotificationOptIn, PromoBanner } from '@/components';
import { PELHAM_HILLS, PELHAM_HILLS_HOLES } from '@/data/pelhamHills';

export default function Home() {
  const yards = Math.round(
    PELHAM_HILLS_HOLES.reduce((sum, h) => sum + h.length, 0) * 1.09361
  );

  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-6 p-6 py-10">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Golf GPS</h1>
        <p className="text-lg text-muted-foreground mt-2">
          GPS-based golf course navigation and scoring
        </p>
      </div>

      <Link
        href={`/golf/${PELHAM_HILLS.id}`}
        className="w-full max-w-md p-5 rounded-lg border-2 border-border hover:border-primary/50 bg-background transition-colors"
      >
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="font-semibold text-base">{PELHAM_HILLS.name}</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin className="w-3.5 h-3.5" />
              {PELHAM_HILLS.location}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">
              {PELHAM_HILLS.holes}
            </div>
            <div className="text-xs text-muted-foreground">holes</div>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-sm">
          <span className="font-medium">Par {PELHAM_HILLS.par}</span>
          <span className="text-muted-foreground">
            {yards.toLocaleString()} yds
          </span>
        </div>
      </Link>

      {/* 티타임 예약. 코스 카드와 나란히 두는 이유: 앱을 여는 순간은 둘 중
          하나다 - 지금 치러 왔거나, 다음에 칠 날을 잡으러 왔거나. */}
      <Link
        href="/book"
        className="w-full max-w-md p-5 rounded-lg border-2 border-border hover:border-primary/50 bg-background transition-colors flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 min-w-0">
          <CalendarDays className="w-5 h-5 text-primary shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold text-base">Book a tee time</h2>
            <p className="text-sm text-muted-foreground">
              Live availability, up to two weeks out
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </Link>

      {/* 홍보 배너와 알림 신청. 둘 다 보여 줄 게 없으면 스스로 사라지므로,
          아무것도 걸려 있지 않은 날의 첫 화면은 지금과 똑같습니다. */}
      <PromoBanner placement="home" />
      <NotificationOptIn />
    </main>
  );
}
