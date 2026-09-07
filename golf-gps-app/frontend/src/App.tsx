import { useEffect } from 'react';
import { Router, Route } from 'wouter';
import Home from './pages/Home';
import Golf from './pages/Golf';
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
      </div>
    </Router>
  );
}
