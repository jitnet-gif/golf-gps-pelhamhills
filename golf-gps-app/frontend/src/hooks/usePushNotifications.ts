import { useCallback, useEffect, useState } from 'react';
import {
  isIos,
  isPushSupported,
  isStandalone,
  subscribeToPush,
  syncExistingSubscription,
  unsubscribeFromPush,
} from '@/lib/push';

/**
 * 알림 상태
 *
 * - unsupported: 이 브라우저에서 웹 푸시가 안 됩니다.
 * - needs-install: iOS. 홈 화면에 추가해야 알림을 켤 수 있습니다.
 * - prompt: 아직 묻지 않았습니다. 켜기 버튼을 보여 줄 때입니다.
 * - subscribed: 구독 중.
 * - denied: 사용자가 거부했습니다. 사이트 설정에서만 되돌릴 수 있으므로
 *   다시 묻지 않습니다.
 */
export type PushStatus = 'unsupported' | 'needs-install' | 'prompt' | 'subscribed' | 'denied';

interface UsePushNotifications {
  status: PushStatus;
  isBusy: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

/**
 * 웹 푸시 구독 상태 관리
 *
 * enable()은 반드시 클릭 핸들러 안에서 불러야 합니다. 브라우저는 사용자
 * 조작 없이 부른 권한 요청을 거부하고, 그 거부는 되돌리기 어렵습니다.
 */
export function usePushNotifications(): UsePushNotifications {
  const [status, setStatus] = useState<PushStatus>('unsupported');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      if (!isPushSupported()) {
        // iOS는 16.4부터 지원하지만 홈 화면에 설치해야 PushManager가 생깁니다.
        // 안 되는 것과 아직 설치를 안 한 것은 사용자에게 다른 이야기입니다.
        setStatus(isIos() && !isStandalone() ? 'needs-install' : 'unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }
      if (Notification.permission !== 'granted') {
        setStatus('prompt');
        return;
      }

      // 이미 허용해 둔 기기입니다. 브라우저가 구독을 갱신했을 수 있으므로
      // 서버 쪽 기록을 지금 값으로 맞춰 둡니다.
      const active = await syncExistingSubscription(ac.signal).catch(() => false);
      if (!ac.signal.aborted) setStatus(active ? 'subscribed' : 'prompt');
    })();

    return () => ac.abort();
  }, []);

  const enable = useCallback(async () => {
    setIsBusy(true);
    setError(null);

    try {
      await subscribeToPush();
      setStatus('subscribed');
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'UNKNOWN';

      if (reason === 'PERMISSION_DENIED') {
        setStatus('denied');
      } else if (reason === 'PUSH_UNSUPPORTED') {
        setStatus(isIos() && !isStandalone() ? 'needs-install' : 'unsupported');
      } else {
        // 서버가 꺼져 있거나 VAPID 키가 없는 경우입니다. 권한은 이미
        // 받았을 수 있으므로 상태는 prompt로 두고 다시 시도하게 합니다.
        setError('알림을 켜지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setIsBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setIsBusy(true);
    setError(null);

    try {
      await unsubscribeFromPush();
      setStatus('prompt');
    } catch {
      setError('알림을 끄지 못했습니다.');
    } finally {
      setIsBusy(false);
    }
  }, []);

  return { status, isBusy, error, enable, disable };
}
