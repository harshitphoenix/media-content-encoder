# Media Content Encoder

A production-ready media processing pipeline built on Node.js. Upload images and videos via a REST API — the system validates, stores the original, and queues background jobs that transcode/process files into web-optimised variants, adaptive streaming manifests, and thumbnails.

```
POST /v1/media  →  API validates + stores  →  BullMQ queue  →  Workers process  →  S3 variants  →  CDN delivery
```

See [docs/HLD.md](docs/HLD.md) for architecture details and [docs/flow-diagram.svg](docs/flow-diagram.svg) for the system diagram.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5 (strict) |
| Monorepo | pnpm 9 workspaces |
| API | Fastify 5 + Pino |
| ORM | Drizzle ORM |
| Queue | BullMQ |
| Image processing | Sharp |
| Video processing | FFmpeg |
| Storage | AWS S3 / MinIO |
| Database | PostgreSQL 16 |
| Cache / Queue broker | Redis 7 |
| Auth | JWT (jose) + Argon2id |
| Security | Helmet, rate-limit (Redis-backed), AJV UUID validation |

---

## Monorepo layout

```
apps/
  api/            Fastify REST API — upload, query, admin, auth routes
  worker-image/   BullMQ consumer — Sharp image variants (15 per asset)
  worker-video/   BullMQ consumer — FFmpeg renditions + HLS/DASH + thumbnails
packages/
  shared/         TypeScript types, Zod schemas, constants
  db/             Drizzle schema, migrations, db client
  storage/        S3/MinIO client wrapper, path utilities
infra/
  docker-compose.yml   PostgreSQL 16 · Redis 7 · MinIO
scripts/          Dev helper scripts
```

---

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm i -g pnpm`)
- Docker + Docker Compose
- FFmpeg and ffprobe on `PATH` (or set `FFPROBE_PATH` in env)

---

## Quick start

### 1 — Start infrastructure

```bash
pnpm infra:up          # starts PostgreSQL, Redis, MinIO in Docker
```

MinIO console is available at http://localhost:9001 (user: `mce_access_key`, password: `mce_secret_key_change_me_in_prod`).

### 2 — Configure environment

Copy and edit the API env file:

```bash
cp apps/api/.env.example apps/api/.env   # if .env.example exists, else create manually
```

Minimum required variables:

```bash
# apps/api/.env
NODE_ENV=development

DATABASE_URL=postgres://mce:mce_dev_password@localhost:5432/mce_dev
REDIS_URL=redis://localhost:6379

STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY_ID=mce_access_key
STORAGE_SECRET_ACCESS_KEY=mce_secret_key_change_me_in_prod
STORAGE_BUCKET_ORIGINALS=mce-originals
STORAGE_BUCKET_VARIANTS=mce-variants
STORAGE_FORCE_PATH_STYLE=true

CDN_BASE_URL=http://localhost:9000/mce-variants

# Must be ≥ 32 chars — use a strong random value in production
JWT_SECRET=change-me-to-a-strong-random-value-min-32-chars
ADMIN_API_KEY=change-me-to-a-strong-random-value-min-32-chars
```

Worker packages read the same `DATABASE_URL`, `REDIS_URL`, and storage vars — copy as needed.

### 3 — Install dependencies

```bash
pnpm install
```

### 4 — Run database migrations

```bash
pnpm db:migrate
```

### 5 — Start services (three terminals)

```bash
pnpm dev:api            # Fastify API on :3000
pnpm dev:worker-image   # Image processing worker
pnpm dev:worker-video   # Video transcoding worker
```

### Health check

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready   # checks DB + Redis connectivity
```

---

## API reference

All media routes are under `/v1/media`. Auth routes under `/v1/auth`. Admin routes under `/v1/admin`.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/auth/register` | Create account (`email`, `password` in JSON body) |
| POST | `/v1/auth/login` | Exchange credentials for JWT |
| GET | `/v1/auth/me` | Return current user (requires Bearer token) |

### Media

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/media` | Bearer | Upload image or video (multipart, field `file`). Rate-limited 10 req/min. Returns `201` with asset ID. |
| GET | `/v1/media/:id` | Bearer | Asset metadata + current processing status |
| GET | `/v1/media/:id/status` | Bearer | Lightweight status poll (`pending → processing → ready/failed`) |
| GET | `/v1/media/:id/variants` | Bearer | All processed image variants with delivery URLs |
| GET | `/v1/media/:id/manifests` | Bearer | HLS and DASH streaming manifest URLs |
| GET | `/v1/media/:id/thumbnails` | Bearer | Cover, preview, and timeline thumbnail URLs |
| GET | `/v1/media/:id/access` | Bearer | Unified delivery URL for the asset |

All `:id` params are UUID v4 — non-UUID values return `400` immediately.

### Admin

Requires `x-admin-key` header matching `ADMIN_API_KEY`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/admin/metrics` | Queue depths, job counts by status |
| POST | `/v1/admin/media/:id/reprocess` | Re-enqueue a failed or completed asset |
| DELETE | `/v1/admin/media/:id` | Delete asset, all variants, and S3 objects |

### Rate limits (per IP)

| Endpoint | Limit |
|----------|-------|
| POST `/v1/media` | 10 req / 60 s |
| All other routes | 100 req / 60 s |

Limits are backed by Redis (`@fastify/rate-limit`). Exceeding the limit returns `429` with a `Retry-After` header.

---

## File limits

| Type | Max size | Other |
|------|----------|-------|
| Image | 100 MB | Max 7680 × 4320 px (8K) |
| Video | 5 GB | Max 2 hours duration |

Accepted MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/avif`, `image/gif`, `video/mp4`, `video/quicktime`, `video/x-msvideo`, `video/x-matroska`.

---

## Processing output

### Images

Per asset: **15 variants** (5 sizes × 3 formats)

| Size key | Max dimension |
|----------|--------------|
| thumbnail | 150 px |
| small | 400 px |
| medium | 800 px |
| large | 1200 px |
| xl | 2400 px |

Formats: WebP · AVIF · JPEG

Optional crop: append `?cropX=&cropY=&cropWidth=&cropHeight=` to the upload URL.

### Videos

Per asset: up to **5 renditions** + HLS + DASH + thumbnails

| Rendition | Codec | Bitrate |
|-----------|-------|---------|
| 240p | H.264 | 400 kbps |
| 360p | H.264 | 800 kbps |
| 480p | H.264 | 1400 kbps |
| 720p | H.264 | 2800 kbps |
| 1080p | H.264 | 5000 kbps |

Additional outputs: HLS master + segment playlists, DASH MPD, cover thumbnail, 10-frame preview strip, 1-per-minute timeline thumbnails, loudness-normalised audio.

---

## Asset state machine

```
PENDING → QUEUED → PROCESSING → COMPLETED
                              → FAILED (retries remaining)
                              → DEAD   (max retries exhausted)
```

Retry: 3 attempts, exponential backoff starting at 5 s. Dead-lettered jobs are preserved in the DB for inspection.

---

## Security

- **JWT auth** — Argon2id password hashing, RS256-style claims (`sub`, `email`)
- **Admin key** — constant-time comparison (CWE-208)
- **Input validation** — Zod on config, AJV + `ajv-formats` on routes (UUID enforcement)
- **Helmet** — strict CSP, HSTS, X-Frame-Options, etc.
- **Rate limiting** — Redis-backed, per-IP
- **Log redaction** — `Authorization` and `x-admin-key` headers never appear in logs (CWE-532)
- **Production errors** — 5xx responses never leak stack traces or internal messages (CWE-209)
- **IDOR prevention** — ownership checks return 404, not 403, to avoid asset ID enumeration (CWE-639)

---

## Development commands

```bash
pnpm build            # build all packages + apps
pnpm typecheck        # run tsc --noEmit across the repo
pnpm lint             # ESLint
pnpm test             # Vitest across all packages
pnpm db:generate      # generate Drizzle migration from schema changes
pnpm db:migrate       # apply pending migrations
pnpm db:studio        # open Drizzle Studio (DB browser)
pnpm infra:up         # start Docker services
pnpm infra:down       # stop Docker services
pnpm infra:reset      # wipe volumes + restart (destructive)
pnpm infra:logs       # tail Docker compose logs
```

---

## Production notes

- Set `NODE_ENV=production` — enables generic 500 error messages and disables dev logging
- Use real S3 buckets; set `STORAGE_FORCE_PATH_STYLE=false`
- Set a real `CDN_BASE_URL` pointing to your CDN distribution in front of the variants bucket
- Set `SIGNED_URLS=true` if you want presigned S3 URLs instead of plain CDN URLs for variants
- Run `pnpm db:migrate` before each deploy
- Workers scale independently — run multiple image worker instances for higher image throughput
