# Golf GPS App

A full-stack golf GPS application for GPS-based golf course navigation, scoring, and player tracking.

## Project Structure

This is a monorepo containing three main packages:

```
golf-gps-app/
├── backend/          # Cloudflare Workers API
├── frontend/         # React + Vite web application
├── shared/           # Shared types and utilities
├── scripts/          # Build and deployment scripts
├── docs/             # Documentation
└── .github/workflows # CI/CD pipelines
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account (for deployment)
- Git

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd golf-gps-app
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment variables:
```bash
cp .env.example .env.local
```

4. Update `.env.local` with your configuration.

### Development

Start both frontend and backend in development mode:

```bash
npm run dev
```

This will:
- Start the frontend dev server at http://localhost:5173
- Start the backend dev server at http://localhost:8787

### Building

Build all packages for production:

```bash
npm run build
```

Build individual packages:

```bash
npm run build:backend
npm run build:frontend
```

### Deployment

#### Backend Deployment (Cloudflare Workers)

Requires Cloudflare API token and account ID.

Deploy to production:
```bash
npm run deploy:prod --workspace=backend
```

Deploy to staging:
```bash
npm run deploy:staging --workspace=backend
```

#### Frontend Deployment

The frontend can be deployed to:
- Cloudflare Pages (recommended, integrated with Workers)
- Netlify
- Vercel
- Any static hosting service

## Technology Stack

### Backend
- **Runtime**: Cloudflare Workers
- **Framework**: Hono (lightweight web framework for Workers)
- **Database**: D1 (Cloudflare's SQLite)
- **Storage**: R2 (Cloudflare's object storage)
- **Type Safety**: TypeScript + Zod

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite
- **Styling**: Tailwind CSS 3.4
- **Routing**: Wouter (lightweight router)
- **Form Handling**: React Hook Form
- **API Client**: Fetch API

### Shared
- **Type Validation**: Zod

## API Endpoints

### Core Endpoints

#### Health Check
```
GET /api/health
```
Returns server status and version.

#### Courses
```
GET /api/courses
```
Fetch available golf courses.

#### Games/Rounds
```
POST /api/games
GET /api/games/:gameId
PUT /api/games/:gameId
```
Manage golf rounds and scoring.

## Configuration

### Environment Variables

See `.env.example` for all available variables. Key configurations:

- `VITE_API_URL`: Backend API URL (frontend)
- `CF_DATABASE_URL`: Cloudflare D1 database URL (backend)
- `CF_R2_*`: R2 object storage credentials (backend)
- `NODE_ENV`: Environment (development/staging/production)

### TypeScript Configuration

- **Root**: `tsconfig.json` - Base configuration
- **Backend**: `backend/tsconfig.json` - Workers-specific settings
- **Frontend**: `frontend/tsconfig.json` - Browser and React settings
- **Shared**: `shared/tsconfig.json` - Shared types and utilities

### Tailwind CSS

Frontend uses Tailwind CSS 3.4 with custom theme configuration:
- Custom color palette using CSS variables
- Dark mode support via `prefers-color-scheme` and `class` strategy
- Custom animations for UI feedback

See `frontend/tailwind.config.js` and `frontend/src/index.css` for theme configuration.

## Database Schema

### D1 Database Setup

After initial deployment, create the database schema:

```sql
-- Courses table
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  holes INTEGER DEFAULT 18,
  par INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Holes table
CREATE TABLE holes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  par INTEGER NOT NULL,
  length INTEGER,
  latitude REAL,
  longitude REAL,
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- Games table
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  status TEXT DEFAULT 'active',
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- Scores table
CREATE TABLE scores (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  strokes INTEGER,
  FOREIGN KEY (game_id) REFERENCES games(id)
);
```

## Workspace Scripts

The monorepo uses npm workspaces for dependency management:

- `npm run dev` - Development mode (all packages)
- `npm run build` - Production build (all packages)
- `npm run check` - TypeScript type check
- `npm run clean` - Remove all build outputs and node_modules

To run scripts in a specific workspace:
```bash
npm run <script> --workspace=<package-name>
```

Example:
```bash
npm run dev --workspace=frontend
npm run build --workspace=backend
```

## CI/CD Pipeline

GitHub Actions workflows are configured in `.github/workflows/`:

### build.yml
- Runs on push and pull request to main/develop
- Tests with Node 18.x and 20.x
- Type checks and builds all packages
- Uploads build artifacts

### deploy.yml
- Runs on push to main
- Builds and deploys backend to Cloudflare Workers
- Optional staging deployment from develop branch

To enable deployments, add secrets to GitHub:
- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID

## Development Guidelines

### Package Dependencies

- **Shared** has no dependencies on backend or frontend
- **Backend** depends on shared types
- **Frontend** depends on shared types
- Cross-package imports use path aliases:
  - Backend: `@shared/*` → `../shared/src/*`
  - Frontend: `@shared/*` → `../shared/src/*`

### Type Safety

All packages use strict TypeScript configuration. Run type check before committing:

```bash
npm run check
```

### Adding Dependencies

Dependencies should be added to the specific package where they're used:

```bash
npm install <package> --workspace=frontend
npm install <package> --workspace=backend
```

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and ensure type safety: `npm run check`
3. Commit changes: `git commit -m "Your message"`
4. Push to remote: `git push origin feature/your-feature`
5. Create a pull request

## Troubleshooting

### Port Already in Use
- Frontend: Default port 5173 (configure via Vite)
- Backend: Default port 8787 (configure in wrangler.toml)

### Node version mismatch
```bash
nvm use 20
npm install
npm run build
```

### Build failures
- Clear cache and rebuild:
  ```bash
  npm run clean
  npm install
  npm run build
  ```

## Resources

- [Hono Documentation](https://hono.dev)
- [Cloudflare Workers](https://developers.cloudflare.com/workers)
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [TypeScript Documentation](https://www.typescriptlang.org)

## License

MIT
