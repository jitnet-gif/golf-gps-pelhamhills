import { Link } from 'wouter';
import { MapPin } from 'lucide-react';
import { PELHAM_HILLS, PELHAM_HILLS_HOLES } from '@/data/pelhamHills';

export default function Home() {
  const yards = Math.round(
    PELHAM_HILLS_HOLES.reduce((sum, h) => sum + h.length, 0) * 1.09361
  );

  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-8 p-6">
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
    </main>
  );
}
