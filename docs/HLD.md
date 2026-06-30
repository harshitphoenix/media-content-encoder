# High-Level Design — Media Content Encoder

**Version:** Phase 9 (Auth & Authorization)
**Stack:** Node.js 20 · TypeScript 5 · Fastify 5 · Drizzle ORM · BullMQ · Sharp · FFmpeg · PostgreSQL 16 · Redis 7 · S3/MinIO

---

## 1. Architecture overview

The system is a **monorepo of three independently deployable services** connected through a shared PostgreSQL database, Redis broker, and S3-compatible object storage.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          pnpm workspace                             │
│                                                                     │
│  apps/api          apps/worker-image      apps/worker-video         │
│  (Fastify REST)    (Sharp processor)      (FFmpeg transcoder)       │
│                                                                     │
│  packages/shared  packages/db  packages/storage                     │
└─────────────────────────────────────────────────────────────────────┘
         │                  │                  │
     PostgreSQL           Redis             S3 / MinIO
```

The API is **synchronous at the boundary** (it streams the file to S3 and returns a job ID in one request) but **asynchronous in processing** (all heavy work runs in background workers via BullMQ queues).

---

## 2. Service responsibilities

### 2.1 API (`apps/api`)

Built on Fastify 5 with the following plugin chain (registration order matters):

1. **Config** — Zod validation of all env vars at startup; fail fast if misconfigured
2. **Redis plugin** — ioredis client decorated as `app.redis`, used by rate limiter + health check
3. **Security plugin** — `@fastify/helmet` (strict CSP for JSON API) + production error handler (CWE-209)
4. **Rate limiter** — `@fastify/rate-limit` backed by Redis; 100 req/min globally, 10 req/min for upload
5. **CORS** — `@fastify/cors`
6. **Multipart** — `@fastify/multipart` for file upload streaming
7. **Database** — Drizzle ORM client via `postgres-js`
8. **Storage** — S3/MinIO client (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)
9. **Queue** — BullMQ `Queue` instances for `imageProcess` and `videoTranscode`
10. **JWT** — `jose` library, decorates `req.user` for authenticated routes
11. **Routes** — plugged in last: `/v1/auth`, `/v1/media`, `/v1/admin`, `/health`

**Pino logging** — structured JSON with redaction of `Authorization` and `x-admin-key` headers (CWE-532). Log level defaults to `info`; configurable via `LOG_LEVEL`.

### 2.2 Image worker (`apps/worker-image`)

A standalone BullMQ consumer. Concurrency: **5 jobs** in parallel.

Processing pipeline per job:
1. Download original file from S3 originals bucket to a temp directory
2. Probe dimensions and colour space via Sharp metadata
3. For each of 5 sizes × 3 formats (15 variants total):
   - Resize (fit: cover, without enlargement)
   - Apply optional crop if crop parameters were stored with the job
   - Convert to WebP / AVIF / JPEG
   - Stream-upload to S3 variants bucket
   - Write `media_variants` row to PostgreSQL
4. Update `media_assets.status = 'ready'` and `processing_jobs.status = 'completed'`
5. Clean up temp files

On error: job is retried up to `JOB_MAX_ATTEMPTS` times with exponential backoff (`JOB_BACKOFF_BASE_MS` base). On exhaustion the job is marked `dead` in the DB.

### 2.3 Video worker (`apps/worker-video`)

A standalone BullMQ consumer. Concurrency: **2 jobs** in parallel (FFmpeg is CPU-intensive).

Processing pipeline per job (phases 1–4 are critical; 5–8 are best-effort):

| Phase | Output | Critical |
|-------|--------|----------|
| 1 | Probe metadata via ffprobe (fps, codec, duration, bitrate) | Yes |
| 2 | MP4 renditions: 240p / 360p / 480p / 720p / 1080p — H.264, AAC | Yes |
| 3 | HLS master playlist + segment playlists | Best-effort |
| 4 | DASH MPD | Best-effort |
| 5 | Cover thumbnail (frame at 5 s) | Best-effort |
| 6 | Preview thumbnail strip (10 frames across duration) | Best-effort |
| 7 | Timeline thumbnails (1 per minute) | Best-effort |
| 8 | Audio loudness normalisation (EBU R128) | Best-effort |

Best-effort phases log and continue on error rather than failing the whole job. HLS/DASH manifests use plain CDN URLs (not presigned) to preserve relative segment resolution in players.

---

## 3. Data model

Eight PostgreSQL tables, all with UUID primary keys:

```
users
  id · email · password_hash · created_at · updated_at
  └── index on email

media_assets
  id · owner_id (FK→users, SET NULL) · mime_type · original_filename
  size_bytes · status (enum) · storage_key · created_at · updated_at
  └── indexes on owner_id, status, created_at

image_metadata          (1:1 with media_assets, CASCADE delete)
  id · asset_id · width · height · format · color_space · has_alpha

video_metadata          (1:1 with media_assets, CASCADE delete)
  id · asset_id · width · height · duration_seconds · codec · fps
  bitrate_bps · audio_codec · audio_channels · audio_sample_rate_hz

processing_jobs         (N:1 with media_assets, CASCADE delete)
  id · asset_id · job_type (enum) · status (enum) · attempts · max_attempts
  error_message · error_stack · queued_at · started_at · completed_at

media_variants          (N:1 with media_assets + processing_jobs, CASCADE delete)
  id · asset_id · job_id · variant_type (enum) · format (enum)
  width · height · bitrate_bps · size_bytes · storage_key · cdn_url

streaming_manifests     (N:1 with media_assets, CASCADE delete)
  id · asset_id · manifest_type (hls|dash) · storage_key · cdn_url

thumbnail_entries       (N:1 with media_assets, CASCADE delete)
  id · asset_id · thumbnail_type (cover|preview|timeline) · storage_key
  cdn_url · width · height · timestamp_seconds
```

### Asset status flow

```
pending  →  processing  →  ready
                        →  failed   (retriable — job retried, asset reset)
```

### Job status flow

```
pending  →  queued  →  processing  →  completed
                                   →  failed  (retries left)
                                   →  dead    (max retries exhausted)
```

---

## 4. Storage layout

Two S3 buckets (MinIO in local dev, real S3 in production):

### `mce-originals` (private)

```
originals/{assetId}/original.{ext}
```

Workers download from here. Never publicly accessible. Presigned URLs with short TTL used if direct access is needed.

### `mce-variants` (public-read or CDN-fronted)

```
variants/{assetId}/{variantType}.{format}       ← image variants
variants/{assetId}/{rendition}.mp4              ← video renditions
manifests/{assetId}/hls/master.m3u8             ← HLS master
manifests/{assetId}/hls/{rendition}/playlist.m3u8
manifests/{assetId}/hls/{rendition}/seg*.ts
manifests/{assetId}/dash/manifest.mpd
thumbnails/{assetId}/cover.jpg
thumbnails/{assetId}/preview.jpg
thumbnails/{assetId}/timeline_{N}.jpg
```

Cache-Control headers on variants: `public, max-age=31536000, immutable` (1-year CDN cache, keys are content-addressable via asset ID).

Manifests are **never presigned** — HLS/DASH players resolve relative segment paths, which breaks if the base URL changes. Manifests always return the plain `CDN_BASE_URL`-prefixed URL.

---

## 5. Queue design

BullMQ on Redis 7. Two named queues:

| Queue | Concurrency | Retry | Backoff |
|-------|------------|-------|---------|
| `imageProcess` | 5 | 3 attempts | Exponential, 5 s base |
| `videoTranscode` | 2 | 3 attempts | Exponential, 5 s base |

**Job payload:**
```typescript
{ assetId: string; mimeType: string; storageKey: string; /* crop params if any */ }
```

The API writes a `processing_jobs` row (status=`pending`) then enqueues. The worker marks it `queued` on pick-up, `processing` on start, and `completed` or `failed` on outcome. On `dead`, the DB row is updated but the original file is preserved for manual reprocessing via `POST /v1/admin/media/:id/reprocess`.

---

## 6. Authentication & authorization model

### User authentication

- Passwords hashed with **Argon2id** (via the `argon2` npm package — strongest memory-hard variant)
- JWTs issued by the API using **jose** (`HS256`), containing `{ sub: userId, email }`
- Token expiry configurable via `JWT_EXPIRY` (default `7d`)
- Tokens are Bearer tokens in the `Authorization` header

### Admin authentication

- Static API key passed in `x-admin-key` header
- Compared using `crypto.timingSafeEqual` with a dummy same-buffer call when lengths differ to prevent timing attacks (CWE-208)
- Admin routes are in a separate Fastify scope with their own `preHandler`

### Authorization rules

- Every media route checks that `req.user.id === asset.ownerId`
- Mismatches return `404` (not `403`) to prevent asset ID enumeration (CWE-639/IDOR)
- Assets with `ownerId = null` (pre-auth uploads) are accessible only by admin

---

## 7. Security controls summary

| Control | Implementation | CWE addressed |
|---------|---------------|---------------|
| Input validation | AJV + `ajv-formats` (UUID format enforcement), Zod (config) | CWE-20 |
| SQL injection | Drizzle ORM parameterised queries — no raw string concatenation | CWE-89 |
| Auth bypass | JWT verification on every protected route via Fastify preHandler | CWE-306 |
| Timing attack (admin key) | `crypto.timingSafeEqual` with constant dummy call | CWE-208 |
| IDOR | Ownership check returns 404 | CWE-639 |
| Information leakage (errors) | Production error handler returns generic 500 message | CWE-209 |
| Sensitive data in logs | Pino `redact` on `Authorization` and `x-admin-key` headers | CWE-532 |
| Clickjacking / CSP | `@fastify/helmet` with strict directives | CWE-1021 |
| Brute force | Redis-backed rate limiter per IP | CWE-307 |
| File upload abuse | MIME probe + size/dimension limits | CWE-434 |
| Path traversal | Storage keys are constructed from UUIDs only | CWE-22 |
| Secrets in repo | `.env` in `.gitignore`; `.env.example` uses placeholder values | CWE-798 |
| Cryptography | Argon2id (passwords), HS256 JWT (sessions), AES via AWS SDK (S3 at rest) | CWE-327 |

---

## 8. Health checks

`GET /health` — always returns `200 { status: "ok" }` (used by load balancer liveness probe)

`GET /health/ready` — checks PostgreSQL (SELECT 1) + Redis (PING); returns `503` if either fails (used by readiness probe before routing traffic)

---

## 9. Configuration reference

All configuration is read from environment variables, validated by Zod at startup. Missing required vars cause immediate startup failure with a descriptive error.

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `API_PORT` | `3000` | Fastify listen port |
| `API_HOST` | `0.0.0.0` | Fastify listen host |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `REDIS_URL` | required | Redis connection string |
| `STORAGE_ENDPOINT` | required | S3/MinIO endpoint URL |
| `STORAGE_ACCESS_KEY_ID` | required | S3 access key |
| `STORAGE_SECRET_ACCESS_KEY` | required | S3 secret key |
| `STORAGE_BUCKET_ORIGINALS` | required | Originals bucket name |
| `STORAGE_BUCKET_VARIANTS` | required | Variants bucket name |
| `STORAGE_REGION` | `us-east-1` | S3 region |
| `STORAGE_FORCE_PATH_STYLE` | `true` | Use `true` for MinIO; `false` for real S3 |
| `CDN_BASE_URL` | required | Base URL prepended to variant storage keys |
| `CDN_URL_TTL_SECONDS` | `3600` | Presigned URL expiry (when `SIGNED_URLS=true`) |
| `SIGNED_URLS` | `false` | Return presigned URLs instead of plain CDN URLs |
| `MAX_IMAGE_SIZE_BYTES` | `104857600` | 100 MB |
| `MAX_VIDEO_SIZE_BYTES` | `5368709120` | 5 GB |
| `MAX_IMAGE_WIDTH` | `7680` | px |
| `MAX_IMAGE_HEIGHT` | `4320` | px |
| `MAX_VIDEO_DURATION_SECONDS` | `7200` | 2 hours |
| `JOB_MAX_ATTEMPTS` | `3` | BullMQ retry count |
| `JOB_BACKOFF_BASE_MS` | `5000` | Exponential backoff base |
| `JWT_SECRET` | required (≥ 32 chars) | JWT signing secret |
| `JWT_EXPIRY` | `7d` | JWT token lifetime |
| `ADMIN_API_KEY` | required (≥ 32 chars) | Static admin API key |
| `FFPROBE_PATH` | `ffprobe` | Path to ffprobe binary |
| `RATE_LIMIT_MAX` | `100` | Requests per window (global) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms |
| `LOG_LEVEL` | `info` | Pino log level |

---

## 10. Local infrastructure (Docker Compose)

`infra/docker-compose.yml` starts three containers on a shared `mce-network`:

| Container | Image | Port(s) | Notes |
|-----------|-------|---------|-------|
| `mce-postgres` | postgres:16-alpine | 5432 | health check via `pg_isready` |
| `mce-redis` | redis:7-alpine | 6379 | AOF persistence, 512 MB LRU cap |
| `mce-minio` | minio/minio:latest | 9000 (S3 API), 9001 (console) | `mce-minio-init` sidecar creates the two buckets |

---

## 11. Deployment considerations

- Workers are **stateless** — scale horizontally by running multiple instances
- The API is also stateless (session state is in Redis rate-limit keys + JWTs) — scale behind a load balancer
- Run `pnpm db:migrate` as a pre-deploy job; Drizzle migrations are idempotent
- For high-throughput image workloads, increase `IMAGE_WORKER_CONCURRENCY` (default 5)
- For video, concurrency is kept at 2 by default to limit CPU contention; increase only if the host has sufficient cores
- HLS/DASH segment files are immutable once written; CDN edge caching is safe to enable aggressively
