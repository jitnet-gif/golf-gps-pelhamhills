import React from 'react';
import { Bell, BellOff, Share } from 'lucide-react';
import { usePushNotifications } from '@/hooks';

/**
 * 알림 받기 카드
 *
 * 앱을 열자마자 권한을 묻지 않습니다. 브라우저의 권한 요청은 한 번 거부되면
 * 사이트 설정에 들어가지 않는 한 되돌릴 수 없어서, 사용자가 무엇을 받게
 * 되는지 알고 직접 누를 때만 띄웁니다.
 */
export const NotificationOptIn: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { status, isBusy, error, enable, disable } = usePushNotifications();

  // 이 브라우저에서 아예 안 되는 경우에는 자리만 차지하므로 그리지 않습니다.
  if (status === 'unsupported') return null;

  const card = 'w-full max-w-md p-4 rounded-lg border border-border bg-background';

  // iOS는 홈 화면에 추가해야 알림을 켤 수 있습니다. 안 된다고만 하면
  // 사용자가 할 수 있는 일이 없으므로, 방법을 알려 줍니다.
  if (status === 'needs-install') {
    return (
      <div className={`${card} ${className}`}>
        <div className="flex items-start gap-3">
          <Share className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm">알림을 받으려면 홈 화면에 추가하세요</h3>
            <p className="text-sm text-muted-foreground mt-1">
              공유 버튼을 누르고 &lsquo;홈 화면에 추가&rsquo;를 선택한 뒤, 홈 화면의
              아이콘으로 다시 열어 주세요. 아이폰은 설치된 앱에서만 알림을 보낼 수 있습니다.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className={`${card} ${className}`}>
        <div className="flex items-start gap-3">
          <BellOff className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm">알림이 차단되어 있습니다</h3>
            <p className="text-sm text-muted-foreground mt-1">
              브라우저 사이트 설정에서 이 사이트의 알림을 허용으로 바꾸면 다시 받을 수 있습니다.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const subscribed = status === 'subscribed';

  return (
    <div className={`${card} ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {subscribed ? (
            <Bell className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          ) : (
            <BellOff className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-sm">
              {subscribed ? '알림을 받고 있습니다' : '이벤트 알림 받기'}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {subscribed
                ? '할인과 이벤트 소식을 보내 드립니다.'
                : '그린피 할인, 이벤트, 티타임 소식을 알려 드립니다.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={subscribed ? disable : enable}
          disabled={isBusy}
          className={`shrink-0 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${
            subscribed
              ? 'border border-border hover:bg-muted/40'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {isBusy ? '...' : subscribed ? '끄기' : '켜기'}
        </button>
      </div>

      {error && <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-3">{error}</p>}
    </div>
  );
};
