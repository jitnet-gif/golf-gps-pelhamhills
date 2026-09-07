# DevOps Infrastructure Setup Guide

## Overview

This document outlines the complete DevOps infrastructure for the Pelham Hills Golf Club application, including tile generation, deployment, monitoring, and local development setup.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Vercel)                       │
│                      Next.js 16 + React 19                      │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                 API Layer (Cloudflare Workers/Backend)          │
│                      FastAPI + PostgreSQL                       │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
        ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
        │  Supabase    │   │  Cloudflare  │   │   Redis      │
        │  PostgreSQL  │   │   R2 (CDN)   │   │  (Cache)     │
        └──────────────┘   └──────────────┘   └──────────────┘
```

## Core Infrastructure Components

### 1. Tile Generation Pipeline

**Purpose**: Convert geographic satellite data into XYZ pyramid tiles for efficient map rendering.

**File**: `scripts/generate-tiles.ts`

**Features**:
- USDA NAIP or OSM data sources
- Zoom levels 15-19 (golf course resolution)
- WebP compression (60% quality = 40% file size)
- Parallel processing support

**Usage**:
```bash
npm run generate-tiles
# Output: ./tiles/{courseId}/{z}/{x}/{y}.webp
```

**Configuration**:
```typescript
const config = {
  minZoom: 15,
  maxZoom: 19,
  dataSource: "USDA_NAIP",  // or "OSM"
  compression: 60,           // 0-100 quality
  format: "webp"
};
```

### 2. R2 Upload Script

**Purpose**: Upload generated tiles to Cloudflare R2 with CDN URL generation.

**File**: `scripts/upload-to-r2.ts`

**Features**:
- Concurrent uploads (configurable)
- Checksum verification
- CDN URL generation
- File listing and deletion

**Usage**:
```bash
npm run upload-r2 ./tiles/pelham-hills
```

**Environment Variables**:
```
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_ACCESS_KEY_ID=your_access_key
CLOUDFLARE_ACCESS_KEY_SECRET=your_secret
R2_BUCKET_NAME=golf-tiles
CDN_DOMAIN=https://tiles.yourdomain.com
```

**Tile URL Format**:
```
https://tiles.yourdomain.com/tiles/{courseId}/{z}/{x}/{y}.webp
```

### 3. Supabase Database Initialization

**Purpose**: Set up PostgreSQL schema with indexes, RLS policies, and sample data.

**File**: `scripts/seed-courses.ts`

**Tables**:
- `courses` - Golf course metadata
- `holes` - Individual hole information
- `rounds` - Round scoring sessions
- `scores` - Per-hole scores
- `leaderboard` - View for aggregate statistics

**Usage**:
```bash
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_ANON_KEY=xxx \
npm run seed-db
```

**Schema Features**:
- Automatic timestamp tracking
- Foreign key constraints
- Composite indexes on frequently queried columns
- Row Level Security (RLS) for multi-user access
- Leaderboard view for aggregated stats

### 4. Local Development Stack

**Purpose**: Run complete application stack locally for development.

**File**: `docker-compose.yml`

**Services**:
```yaml
Services Included:
├── postgres       # PostgreSQL 16 with pgvector
├── redis          # Redis 7 for caching
├── backend        # FastAPI application
├── frontend       # Next.js development server
├── minio          # S3-compatible storage (optional)
├── adminer        # Database GUI (optional)
├── prometheus     # Metrics collection (optional)
└── grafana        # Dashboards (optional)
```

**Start Development Stack**:
```bash
npm run docker:up
```

**Access Points**:
| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:3000 | Next.js dev server |
| API | http://localhost:8000 | FastAPI documentation |
| Adminer | http://localhost:8080 | Database management |
| MinIO | http://localhost:9000 | Object storage UI |
| Grafana | http://localhost:3001 | Monitoring dashboard |

**Cleanup**:
```bash
npm run docker:clean  # Remove all volumes and containers
```

### 5. Frontend Deployment (Vercel)

**Configuration**: `frontend/vercel.json`

**Features**:
- Automatic deployments from main branch
- Environment-specific configuration
- Cache headers for tiles (1 year)
- API route protection
- Serverless functions with 60s timeout

**Environment Variables** (Set in Vercel Dashboard):
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_CDN_DOMAIN
ANTHROPIC_API_KEY
```

**Deploy**:
```bash
npm run deploy:frontend
```

### 6. Backend Deployment

**Options**:
- **Railway**: `npm run deploy:backend`
- **Fly.io**: `flyctl deploy`
- **Docker**: Use `backend/Dockerfile`

**Environment Variables**:
```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
ANTHROPIC_API_KEY=...
```

**Production Build**:
```bash
docker build -t golf-backend:latest -f backend/Dockerfile .
docker run -p 8000:8000 -e DATABASE_URL=... golf-backend:latest
```

### 7. CI/CD Pipeline

**File**: `.github/workflows/deploy.yml`

**Workflow Stages**:
1. **Lint & Test** - Code quality checks
2. **Build Frontend** - Next.js build
3. **Deploy Frontend** - Vercel deployment
4. **Generate Tiles** (Manual) - Tile generation
5. **Upload Tiles** (Manual) - R2 upload
6. **Seed Database** (Manual) - DB initialization
7. **Deploy Backend** - Railway/Fly.io deployment
8. **Security Scan** - Vulnerability checks
9. **Notify** - Slack notifications

**Trigger Deployments**:
```bash
# Automatic on push to main
git push origin main

# Manual workflow
gh workflow run deploy.yml -f environment=production
```

**Secrets Required**:
- `VERCEL_TOKEN` - Vercel API token
- `VERCEL_ORG_ID` - Vercel organization ID
- `VERCEL_PROJECT_ID` - Vercel project ID
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID
- `CLOUDFLARE_ACCESS_KEY_ID` - R2 access key
- `CLOUDFLARE_ACCESS_KEY_SECRET` - R2 secret
- `RAILWAY_TOKEN` - Railway deployment token
- `FLY_API_TOKEN` - Fly.io API token
- `SUPABASE_URL` - Supabase URL
- `SUPABASE_ANON_KEY` - Supabase anon key
- `SLACK_WEBHOOK_URL` - Slack notifications

## NPM Commands

### Development
```bash
npm run dev              # Start all services locally
npm run dev:frontend    # Frontend only
npm run dev:backend     # Backend only
npm run docker:up       # Docker services
```

### Building
```bash
npm run build           # Build frontend + backend
npm run build:frontend  # Next.js build
```

### Testing
```bash
npm run test            # Run all tests
npm run test:frontend   # Frontend tests
npm run test:backend    # Backend tests with coverage
```

### Code Quality
```bash
npm run lint            # Lint frontend + backend
npm run format          # Format code (Prettier + Black)
npm run type-check      # TypeScript + mypy type checking
```

### Deployment
```bash
npm run deploy          # Deploy frontend + backend
npm run deploy:frontend # Deploy to Vercel
npm run deploy:backend  # Deploy to Railway/Fly.io
npm run deploy:tiles    # Generate and upload tiles
```

### Database
```bash
npm run db:migrate      # Run Alembic migrations
npm run db:seed         # Seed sample data
npm run seed-db         # TypeScript seed script
```

### Docker
```bash
npm run docker:up       # Start all containers
npm run docker:down     # Stop containers
npm run docker:logs     # View logs
npm run docker:clean    # Remove volumes
```

## Environment Setup

### 1. Clone Repository
```bash
git clone https://github.com/pelham-hills/golf-app.git
cd golf-app
```

### 2. Install Dependencies
```bash
npm run install:all
```

### 3. Configure Environment Variables

**Frontend**:
```bash
cp frontend/.env.local.example frontend/.env.local
# Edit frontend/.env.local with your values
```

**Backend**:
```bash
cp backend/.env.local.example backend/.env.local
# Edit backend/.env.local with your values
```

### 4. Start Local Stack
```bash
npm run docker:up
# Wait for services to be healthy
npm run db:migrate
npm run db:seed
```

### 5. Access Application
- Frontend: http://localhost:3000
- API Docs: http://localhost:8000/docs
- Database Admin: http://localhost:8080

## Monitoring & Logging

### Metrics Collection

**Prometheus** (`monitoring/prometheus.yml`):
- Scrapes metrics from backend at `:8000/metrics`
- Stores metrics for 15 days
- Target scrape interval: 15 seconds

**Grafana** (`monitoring/grafana/provisioning/`):
- Dashboard templates
- Pre-configured data sources
- Default password: admin/admin

**Access**: http://localhost:3001

### Application Logging

**Backend Logging**:
```python
import logging
logger = logging.getLogger(__name__)
logger.info("Event message", extra={"course_id": "123"})
```

**Log Levels**:
- `DEBUG` - Detailed diagnostic information
- `INFO` - General informational messages
- `WARNING` - Warning messages for potential issues
- `ERROR` - Error messages for failures
- `CRITICAL` - Critical errors requiring immediate attention

### Error Tracking

**Sentry Integration**:
```
SENTRY_DSN=https://key@sentry.io/project-id
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

## Security Considerations

### Environment Variables
- Never commit `.env.local` files
- Use `.env.local.example` as template
- Rotate API keys regularly
- Store secrets in platform-specific vaults (Vercel, Fly.io)

### Database Security
- Use strong passwords for development
- Enable Row Level Security (RLS) in production
- Set up database backups
- Use PostgreSQL encryption at rest

### API Security
- Validate all input with Pydantic
- Implement rate limiting
- Use CORS with allowed origins
- Enable HTTPS in production
- Use secure cookies (HttpOnly, Secure, SameSite)

### Tile Caching
- Tiles are immutable (append-only)
- Set 1-year cache headers
- Use CDN for geographic distribution
- Verify checksums on upload

## Troubleshooting

### Common Issues

**Database Connection Failed**:
```bash
# Check if postgres is running
docker ps | grep postgres

# View logs
docker logs bepu_postgres

# Restart service
docker restart bepu_postgres
```

**Redis Cache Issues**:
```bash
# Clear cache
redis-cli FLUSHALL

# Check memory usage
redis-cli INFO memory
```

**Tile Upload Failures**:
```bash
# Verify R2 credentials
export CLOUDFLARE_ACCOUNT_ID=your_id
export CLOUDFLARE_ACCESS_KEY_ID=your_key
export CLOUDFLARE_ACCESS_KEY_SECRET=your_secret

# Test connectivity
npm run upload-r2 ./tiles/test
```

**Frontend Build Errors**:
```bash
# Clear Next.js cache
rm -rf frontend/.next

# Reinstall dependencies
npm ci --workspace=frontend

# Rebuild
npm run build:frontend
```

## Performance Optimization

### Tile Optimization
- WebP format saves ~40% vs PNG
- Z-level 15 covers 1 mile (golf course area)
- Z-level 19 provides meter-level detail
- Consider caching tiles in Redis

### Database Optimization
- Use connection pooling (10-20 connections)
- Analyze slow queries with `EXPLAIN ANALYZE`
- Create indexes on frequently filtered columns
- Partition large tables by date

### Frontend Optimization
- Image optimization with Next.js Image
- Code splitting with dynamic imports
- Compression with gzip/brotli
- CDN distribution through Vercel/R2

## Maintenance Tasks

### Daily
- Monitor error tracking (Sentry)
- Check database disk space
- Verify API response times

### Weekly
- Review logs for security issues
- Check Redis memory usage
- Update dependencies with `npm audit`

### Monthly
- Database vacuum and reindex
- Backup verification
- Performance metrics review
- Cost analysis

### Quarterly
- Security audit
- Dependency updates
- Infrastructure capacity planning
- Disaster recovery testing

## Cost Management

### Estimated Monthly Costs

| Service | Usage | Estimated Cost |
|---------|-------|-----------------|
| Vercel | ~100K requests | $20-50 |
| Cloudflare R2 | ~500GB stored | $15-30 |
| Supabase | ~1M rows | $25-100 |
| Railway | Backend server | $50-100 |
| CDN Bandwidth | ~100GB | $50-100 |
| **Total** | | **$160-380** |

### Cost Optimization
- Use R2 instead of S3 (70% cheaper)
- Cache tiles with 1-year TTL
- Archive old rounds after 1 year
- Use connection pooling to reduce DB connections

## Support & Resources

- **Vercel Docs**: https://vercel.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **Supabase Docs**: https://supabase.com/docs
- **Cloudflare R2**: https://developers.cloudflare.com/r2/
- **Docker Docs**: https://docs.docker.com/

## Contributing

1. Create feature branch: `git checkout -b feature/xyz`
2. Make changes and test locally
3. Run quality checks: `npm run lint && npm run type-check`
4. Push to remote: `git push origin feature/xyz`
5. Create pull request on GitHub
6. Wait for CI/CD checks to pass
7. Merge when approved

## License

MIT License - See LICENSE file for details
