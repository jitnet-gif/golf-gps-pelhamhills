import { useEffect } from 'react';
import { Router, Route } from 'wouter';
import Home from './pages/Home';
import Golf from './pages/Golf';
import Book from './pages/Book';
import Admin from './pages/Admin';
import { useOfflineMode } from './hooks';

export default function App() {
  const { hasServiceWorker } = useOfflineMode();

  // Register service worker for PWA
  useEffect(() => {
    if (hasServiceWorker && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('Service Worker registered:', reg);
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    }
  }, [hasServiceWorker]);

  return (
    <Router>
      <div className="min-h-screen bg-background text-foreground">
        <Route path="/" component={Home} />
        <Route path="/golf/:courseId" component={Golf} />
        {/* 티타임 예약. 웹사이트의 /book/tee-time 과 같은 티 시트 서버를 본다. */}
        <Route path="/book" component={Book} />
        {/* 운영자용. 링크로 노출하지 않습니다 - 주소를 아는 사람만 들어오고,
            실제 차단은 화면이 아니라 서버의 X-Admin-Key가 합니다. */}
        <Route path="/admin" component={Admin} />
      </div>
    </Router>
  );
}
