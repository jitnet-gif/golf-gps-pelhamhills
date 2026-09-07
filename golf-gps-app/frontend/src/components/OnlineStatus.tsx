import React from 'react';
import { useAppStore } from '@/store/appStore';
import { Wifi, WifiOff } from 'lucide-react';

export const OnlineStatus: React.FC = () => {
  const { isOnline } = useAppStore();

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
        isOnline
          ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'
          : 'bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300'
      }`}
    >
      {isOnline ? (
        <>
          <Wifi className="w-4 h-4" />
          Online
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4" />
          Offline
        </>
      )}
    </div>
  );
};
