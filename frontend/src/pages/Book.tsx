import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ChevronLeft, ExternalLink, Loader2, WifiOff } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

/** 예약 사이트의 티타임 페이지. 주소는 `frontend/lib/nav.ts` 의 BOOK_TEE_TIME 과
 *  같은 곳을 가리킨다 (두 앱은 빌드가 갈라져 있어 상수를 공유할 수 없다). */
export const BOOKING_URL = 'https://pelhamhills.vercel.app/book/tee-time';

/** 이만큼 지나도 안 뜨면 '브라우저로 열기' 를 앞으로 꺼낸다. */
const SLOW_MS = 12_000;

/**
 * 티타임 예약 - 클럽 예약 사이트를 앱 화면 안에 그대로 띄운다.
 *
 * 예약 폼을 이 앱에 한 벌 더 만들지 않는다: 요금·정원·취소 규칙이 두 곳에서
 * 갈라지기 때문이다. 여기 보이는 것은 예약 사이트 그 자체이고, 이 앱은 틀만
 * 댄다. 예약 사이트는 지금 다른 사이트 안에 뜨는 것을 막지 않지만, 그 사이트의
 * 배포 하나로 바뀔 수 있으므로 '브라우저로 열기' 는 늘 헤더에 둔다.
 */
export default function Book() {
  const isOnline = useAppStore((s) => s.isOnline);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const openInBrowser = (
    <a
      href={BOOKING_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
    >
      Open in browser
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Link
          href="/"
          className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1.5 text-sm font-medium text-primary hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
          Home
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-semibold">Book a tee time</h1>
        {openInBrowser}
      </header>

      <div className="relative min-h-0 flex-1">
        {!isOnline ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <WifiOff className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">Booking needs an internet connection.</p>
            <p className="text-xs text-muted-foreground">
              The course map and scorecard still work offline.
            </p>
          </div>
        ) : (
          <>
            {!loaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading the booking page...</p>
                {slow && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Taking a while. You can open it in the browser instead.
                    </p>
                    {openInBrowser}
                  </>
                )}
              </div>
            )}
            <iframe
              src={BOOKING_URL}
              title="Pelham Hills tee time booking"
              // 예약 사이트의 'Book by voice' 는 마이크와 음성 재생을 쓴다. 틀 안에서는
              // 여기서 허락해 주지 않으면 브라우저가 둘 다 막는다.
              allow="microphone; autoplay"
              onLoad={() => setLoaded(true)}
              className={`absolute inset-0 h-full w-full border-0 bg-white ${loaded ? '' : 'opacity-0'}`}
            />
          </>
        )}
      </div>
    </main>
  );
}
