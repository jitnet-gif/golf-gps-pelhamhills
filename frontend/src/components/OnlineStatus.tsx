import React from 'react';
import { useAppStore } from '@/store/appStore';
import { Wifi, WifiOff } from 'lucide-react';

// Compact on purpose: it shares the header's second row with the course details,
// and at text-sm it pushed the course name into one word per line on a phone.
//
// On a phone held upright "Online" gives way to the GPS pill beside it: three
// pills squeezed the club's name down to one letter, and being online is the
// normal case - Offline, the one worth a glance, always shows.
export const OnlineStatus: React.FC = () => {
  const { isOnline } = useAppStore();

  return (
    <div
      className={`items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
        isOnline
          ? 'hidden sm:flex short:flex bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'
          : 'flex bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300'
      }`}
    >
      {isOnline ? (
        <>
          <Wifi className="w-3.5 h-3.5" />
          Online
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          Offline
        </>
      )}
    </div>
  );
};
