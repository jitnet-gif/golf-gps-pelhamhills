import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';

export const useOfflineMode = () => {
  const { setIsOnline } = useAppStore();

  const handleOnline = useCallback(() => {
    setIsOnline(true);
  }, [setIsOnline]);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
  }, [setIsOnline]);

  useEffect(() => {
    // Set initial state
    setIsOnline(navigator.onLine);

    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline, handleOnline, handleOffline]);

  /**
   * Check if specific APIs are available
   */
  const hasGeolocation = useCallback(() => {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }, []);

  const hasServiceWorker = useCallback(() => {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  }, []);

  const hasIndexedDB = useCallback(() => {
    return typeof indexedDB !== 'undefined';
  }, []);

  /**
   * Attempt to sync with server
   */
  const syncWithServer = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) {
      return false;
    }

    try {
      const response = await fetch('/api/health', { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  return {
    isOnline: typeof navigator !== 'undefined' && navigator.onLine,
    hasGeolocation: hasGeolocation(),
    hasServiceWorker: hasServiceWorker(),
    hasIndexedDB: hasIndexedDB(),
    syncWithServer,
  };
};
