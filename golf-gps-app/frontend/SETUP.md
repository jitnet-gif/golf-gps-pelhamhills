# Golf GPS Frontend - Setup Guide

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Backend running on `http://localhost:8787` (or configure `VITE_API_URL`)

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Edit .env.local with your configuration
# - VITE_API_URL: Backend API endpoint
# - VITE_R2_BUCKET_URL: Cloudflare R2 bucket URL
```

### Development

```bash
# Start development server with hot reload
npm run dev

# Navigate to http://localhost:5173
```

The dev server includes:
- API proxy to `http://localhost:8787/api/*`
- Hot module replacement (HMR)
- Instant recompile on file changes

### Production Build

```bash
# Type-check and build for production
npm run build

# Preview production build locally
npm run preview
```

Output in `dist/` directory ready for deployment.

---

## Project Configuration

### Environment Variables (.env.local)

```env
# Required
VITE_API_URL=http://localhost:8787
VITE_R2_BUCKET_URL=https://your-bucket.r2.cloudflarestorage.com

# Optional
VITE_GPS_ENABLE_HIGH_ACCURACY=true
VITE_MAP_DEFAULT_ZOOM=16
```

### Tailwind Customization (tailwind.config.js)

Colors, spacing, fonts configured via CSS custom properties in `src/index.css`:

```css
:root {
  --primary: 219 93% 48%;           /* Blue */
  --secondary: 240 10% 85%;         /* Gray */
  --accent: 217 91% 60%;            /* Highlight */
  --background: 0 0% 100%;          /* White */
  --foreground: 0 0% 10%;           /* Black */
}
```

Swap values to rebrand without touching component code.

### Vite Config (vite.config.ts)

Key settings:
- **PWA Plugin**: Generates Service Worker + manifest
- **Path Aliases**: `@/` = `./src/`, `@shared/` = `../shared/src/`
- **API Proxy**: `/api` → `http://localhost:8787`
- **Code Splitting**: Vendor bundles for React, Leaflet, UI, Utils

---

## Development Workflow

### Adding a Component

1. Create component in `src/components/MyComponent.tsx`:

```tsx
import React from 'react';

interface MyComponentProps {
  title: string;
}

export const MyComponent: React.FC<MyComponentProps> = ({ title }) => {
  return <div className="text-lg font-bold">{title}</div>;
};
```

2. Export from `src/components/index.ts`:

```ts
export { MyComponent } from './MyComponent';
```

3. Use in pages:

```tsx
import { MyComponent } from '@/components';

export default function Home() {
  return <MyComponent title="Hello" />;
}
```

### Adding a Hook

1. Create hook in `src/hooks/useMyHook.ts`:

```ts
import { useState } from 'react';

export const useMyHook = () => {
  const [state, setState] = useState(null);
  return { state, setState };
};
```

2. Export from `src/hooks/index.ts`
3. Use in components: `const { state } = useMyHook()`

### State Management (Zustand)

Global state in `appStore.ts`:

```tsx
import { useAppStore } from '@/store/appStore';

export const MyComponent = () => {
  const { currentRound, setScore } = useAppStore();

  return (
    <button onClick={() => setScore(1, 4)}>
      Save Score
    </button>
  );
};
```

No provider needed - hooks automatically subscribed to store.

### Database Operations (Dexie)

IndexedDB access from hooks/components:

```ts
import { db } from '@/db';

// Save
await db.rounds.add(round);

// Query
const rounds = await db.rounds.where('courseId').equals('1').toArray();

// Update
await db.syncQueue.update(id, { attempts: 1 });

// Delete
await db.rounds.delete(roundId);
```

---

## Testing

### Type Checking

```bash
npm run check    # TypeScript validation only, no build
```

### Running Tests

Tests not yet configured. To add Jest/Vitest:

```bash
npm install -D vitest @testing-library/react
```

Create `src/__tests__/components/HoleMap.test.tsx`:

```ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoleMap } from '@/components';

describe('HoleMap', () => {
  it('renders map container', () => {
    render(<HoleMap courseId="1" />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });
});
```

---

## Deployment

### Cloudflare Pages

The backend is deployed to Cloudflare Workers. Frontend can be deployed to Cloudflare Pages:

```bash
# Build
npm run build

# Deploy (requires wrangler auth)
npx wrangler pages deploy dist --project-name golf-gps
```

### Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
# VITE_API_URL, VITE_R2_BUCKET_URL
```

### Docker

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json .
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run:

```bash
docker build -t golf-gps-frontend .
docker run -p 3000:80 golf-gps-frontend
```

---

## Debugging

### Browser DevTools

**Application Tab**:
- Inspect IndexedDB (`GolfGpsDB` > `rounds`, `scores`, `syncQueue`)
- Clear Service Worker cache
- Check Service Worker status

**Network Tab**:
- Monitor API requests to backend
- Verify Service Worker intercepts correctly
- Check R2 tile loading

**Console**:
- GPS updates logged via `useGPS.ts`
- Sync queue changes via `useScorecard.ts`
- Errors caught by API client

### Local Database Inspection

```ts
// In browser console
await db.rounds.toArray();           // All rounds
await db.syncQueue.toArray();        // Pending syncs
await db.tileMeta.where('courseId').equals('1').first();  // Cached tiles
```

### Service Worker Debugging

```ts
// In browser console (PWA must be registered)
navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(reg => {
    console.log('Service Worker:', reg);
    console.log('Active:', reg.active);
    reg.update();  // Check for updates
  });
});
```

### Offline Testing

1. Open DevTools Network tab
2. Check "Offline" checkbox
3. Refresh page - app should work
4. Enter scores - saved to IndexedDB
5. Uncheck "Offline" - scores sync to backend

---

## Performance Tips

### Bundle Analysis

```bash
npm install -D rollup-plugin-visualizer
```

Update `vite.config.ts`:

```ts
import { visualizer } from 'rollup-plugin-visualizer';

plugins: [
  // ...
  visualizer({
    open: true,
  }),
]
```

Run `npm run build` to open bundle analysis.

### Optimize Dependencies

- Use `import { X } from '@radix-ui/react-dialog'` (not `*`)
- Tree-shake unused code with `sideEffects: false` in package.json
- Lazy-load routes: `const Golf = lazy(() => import('./pages/Golf'))`

### CSS Performance

- Tailwind purges unused classes in production
- Critical CSS inlined automatically by Vite
- No runtime CSS-in-JS overhead

### Runtime

- Memoize expensive calculations: `useMemo()`
- Debounce rapid events: `useCallback()` + `debounce()`
- Profile with React DevTools Profiler tab

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Map blank | Leaflet CSS missing | Verify `import 'leaflet/dist/leaflet.css'` in HoleMap.tsx |
| Icons not showing | Marker icon paths wrong | Check `L.Icon.Default` paths in HoleMap component |
| No GPS signal | Permission denied | Check browser location permissions, enable in settings |
| Tiles not loading | CORS issue on R2 | Verify R2 CORS headers allow frontend domain |
| Service Worker not installing | Build issue | Clear `node_modules` and `.next`, reinstall |
| Scores not persisting | IndexedDB full | Check browser quota in DevTools Storage tab |
| API 401 Unauthorized | Token expired | Clear localStorage, re-authenticate |

---

## Resources

- **Vite Docs**: https://vitejs.dev
- **React Docs**: https://react.dev
- **Tailwind CSS**: https://tailwindcss.com
- **Leaflet**: https://leafletjs.com
- **Zustand**: https://github.com/pmndrs/zustand
- **Dexie**: https://dexie.org
- **MDN Web Docs**: https://developer.mozilla.org

---

## Next Steps

1. ✅ Frontend scaffold with React + Vite
2. ✅ Components: HoleMap, DistanceIndicator, ScoreCard, etc.
3. ✅ Hooks: GPS tracking, tiles, scorecard, offline mode
4. ✅ State management with Zustand
5. ✅ IndexedDB with Dexie
6. ✅ PWA with Service Worker
7. ⏳ Backend API integration (wire up actual courses/holes)
8. ⏳ E2E tests (Playwright already configured)
9. ⏳ Leaderboard (Phase 2)
10. ⏳ Multiplayer features (Phase 2)
