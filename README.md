# Mailflow — Full-stack Email Job Scheduler

Mailflow schedules recipient-specific email jobs with BullMQ delayed jobs, Redis, PostgreSQL, and an independent worker. The React dashboard lets each authenticated user compose campaigns, inspect scheduled/sent mail, search indexed messages, and connect Slack for hourly-limit alerts.

> **No cron is used.** Every scheduled send is a BullMQ delayed job; BullMQ/Redis persistence and API boot reconciliation preserve pending work across restarts.

## Requirements

- Node.js 20+ and npm
- Docker Desktop with Docker Compose v2 (allow at least 4 GB RAM for Elasticsearch)
- Google OAuth credentials for Google sign-in
- Slack OAuth app credentials for Slack alerts

## Local setup

Run from this directory:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
npm install
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend\.env` before using Google sign-in. Configure Slack before connecting it from the dashboard. `TOKEN_ENCRYPTION_KEY` must be a fresh, private, 32-byte hex value; generate one in PowerShell with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Replace `SESSION_SECRET` with a separate long random secret as well. Do not use the example encryption key or session secret in a deployed environment.
Production startup rejects the sample secrets, requires HTTPS frontend/API URLs, secure cookies, and Google OAuth credentials, and trusts one TLS-terminating reverse proxy hop.

Start each process in its own terminal:

```powershell
npm run dev:backend
```

```powershell
npm run dev:worker
```

```powershell
npm run dev:frontend
```

The API listens on `http://localhost:4000` by default (or the configured `PORT`), the Vite app on `http://localhost:5173`, and the development-only Bull Board is at `/admin/queues` on the API host when enabled. Compose maps PostgreSQL's container port 5432 to host port 5433 so it does not collide with a locally installed PostgreSQL server; set `DATABASE_URL` to port 5433 when using this Compose database. Run database migrations before starting the API. The API and worker both need access to PostgreSQL and Redis; the API additionally uses Elasticsearch and initializes/reconciles search indexes on startup.

### Local dashboard demo login

For a local-only demo, set `VITE_ENABLE_DEMO_LOGIN=true` in `frontend\.env`, restart Vite, and choose **Continue with the local demo account**. The backend's `POST /auth/dev` route is disabled unless `NODE_ENV=development`; it creates/uses `DEMO_USER_EMAIL` and establishes a Redis-backed session. It is not an alternative production authentication method.

## OAuth and email setup

### Google

1. Create a Google OAuth 2.0 **Web application** client.
2. Add the callback URL configured in `GOOGLE_CALLBACK_URL` (by default `http://localhost:4000/auth/google/callback`) as an authorized redirect URI.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and (if needed) `GOOGLE_ALLOWED_EMAIL_DOMAIN` in `backend\.env`.
4. The frontend uses the backend session cookie; the Google profile's email, name, and avatar are stored in PostgreSQL. `/auth/me`, logout, and all email routes are user-scoped.

### Slack

1. Create a Slack app and enable OAuth v2.
2. Add the callback URL configured in `SLACK_CALLBACK_URL` (by default `http://localhost:4000/api/slack/callback`) as its redirect URL.
3. Grant bot scopes `chat:write` and `incoming-webhook`.
4. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_CALLBACK_URL`.
5. Sign in to the dashboard and select **Connect Slack**. Slack OAuth state is session-bound and validated on callback. Disconnect/reconnect is available from the same control.

Slack bot tokens and webhook metadata are encrypted with AES-256-GCM before storage in PostgreSQL. A worker checks the user's current Slack connection when a rate limit is reached, so a new connection is usable without redeploying or restarting.

### Ethereal SMTP

When Redis has no persisted sender pool, the first API or worker process creates `ETHEREAL_SENDER_COUNT` test accounts with `nodemailer.createTestAccount` under a Redis initialization lock, encrypts and stores the credentials in Redis, and rebuilds SMTP transports from that shared pool at startup. The credentials persist across restarts. New messages use Ethereal SMTP and the worker logs each Ethereal preview URL. Ethereal is a test inbox service, not a production delivery provider; replace the transport and configure production deliverability controls before real email use.

## Architecture and behavior

### Scheduling flow

1. An authenticated user posts a validated campaign to `POST /api/emails/schedule`. Recipient addresses are validated and de-duplicated case-insensitively. The requested start time is treated as an ISO timestamp; recipient *i* gets `startTime + i × delayBetweenEmails`.
2. PostgreSQL is the source of truth. One `Email` row per recipient stores the owner, sender, content, scheduled time, sequence, optional hourly limit, state, attempts, and deterministic queue job ID. The row IDs and job IDs are unique.
3. The API bulk-adds one delayed BullMQ job per row and indexes the email in Elasticsearch. A DB commit followed by a queue failure can leave a scheduled row without a job; the next API boot reconciles such rows and re-enqueues them. This is deliberately recoverable rather than pretending PostgreSQL and Redis share a distributed transaction.
4. The worker reserves a per-sender send slot using an atomic Redis Lua script, waits through BullMQ delayed state if the minimum interval has not elapsed, and checks the hourly Redis counter.
5. Before SMTP delivery, the worker atomically claims the row with `UPDATE ... WHERE status = 'scheduled' RETURNING`. A second/stalled execution cannot claim a row that is already processing, sent, or failed. After the one SMTP attempt it marks the row sent or failed and refreshes the Elasticsearch document.

### Restart, idempotency, and stalled work

- Redis uses AOF persistence and a Docker named volume; PostgreSQL and Elasticsearch also use named volumes.
- BullMQ restores delayed jobs after Redis/worker restarts. API boot additionally reconciles every `scheduled` DB row against its deterministic queue job ID.
- The DB claim is the final guard against duplicate delivery, including duplicate enqueue and stalled-job reprocessing. SMTP delivery is an external side effect and cannot participate in a PostgreSQL transaction: Mailflow uses **at-most-once delivery**. If a process dies after claiming a row, it will not send that row again. A row interrupted in the uncertain SMTP/DB-update interval may remain `processing`; this is surfaced in the scheduled view rather than retried and risking a duplicate. SMTP send errors are marked failed and are not automatically retried.
- This trade-off favors the explicit “never send twice” requirement. For production email providers, use provider-side idempotency keys and a delivery-event/webhook reconciliation flow to resolve uncertain outcomes.

### Concurrency, spacing, throttling, and 1000+ jobs

- `WORKER_CONCURRENCY` controls each worker process's BullMQ concurrency. Multiple workers can run against the same queue.
- `MIN_DELAY_BETWEEN_EMAILS_MS` defaults to **1000 ms per sender**. A sender-wide Redis Lua reservation assigns each email a stable time slot across workers; a job moved to delayed state retains its reservation when it resumes. This custom Redis gate is used instead of BullMQ's queue-wide fixed-window limiter so sender-specific spacing is shared safely.
- `MAX_EMAILS_PER_HOUR_PER_SENDER` is the default cap. `hourlyLimit` on a schedule overrides the cap for that campaign's emails. Rate counters use atomic Redis `INCR` guarded by a Lua limit check and expire shortly after the UTC hour boundary. A blocked attempt is not incremented.
- If a sender is at its hourly cap, the worker moves—not fails or drops—the job to the next UTC hour. `sequence` adds a bounded 100 ms offset (up to 100 seconds) within that next window so one large batch retains its order.
- Slack notification de-duplication is a Redis key per sender and UTC hour. One alert is sent for that sender/hour; absent Slack connections are skipped. Failures to send the alert are logged and never block job deferral.
- `MAX_SCHEDULE_BATCH_SIZE` defaults to 1000 (configurable up to 10000). The API inserts each batch with one atomic PostgreSQL `createManyAndReturn` statement and uses BullMQ `addBulk`; it does not create one timer per email or hold a campaign in application memory. With 1000 same-time emails, BullMQ persists each delayed job, worker concurrency and sender slot reservations spread execution, and the Redis cap defers over-limit jobs to the next UTC window. Each sender's hourly quota is independent; round-robin assignment spreads campaigns across the configured Ethereal pool.

### Search and queue dashboard

- Elasticsearch indexes each newly scheduled email and every delivery status update. Search is scoped by `userId` and supports full-text subject/body/recipient plus status and sender filters.
- If Elasticsearch is unavailable, search logs the degradation and falls back to case-insensitive PostgreSQL search. Index failures do not roll back persisted email scheduling or delivery.
- The Bull Board dashboard is disabled by default. To expose it locally, set `QUEUE_ADMIN_ENABLED=true`, `QUEUE_ADMIN_USERNAME`, and a unique `QUEUE_ADMIN_PASSWORD`. It is protected with HTTP Basic Auth and refuses the example password. Do not expose an unencrypted Basic Auth dashboard to the public internet.

## Feature map

| Feature | Backend | Frontend |
| --- | --- | --- |
| Google authentication and per-user isolation | `/auth/google`, callback, `/auth/me`, logout; session stored in Redis | Login screen, user profile/avatar, logout |
| Bulk schedule and sender rotation | Validated `/api/emails/schedule`, PostgreSQL rows, one BullMQ delayed job per email | Compose modal, recipient parser, sender selector, delay/start/rate controls |
| Scheduled and sent lists | Paginated `/api/emails/scheduled` and `/api/emails/sent` | Scheduled/Sent tabs, status badges, skeleton and empty states |
| Search | Elasticsearch `/api/emails/search` with PostgreSQL fallback | Search input scoped to the active tab |
| Hourly rate and Slack | Atomic Redis per-sender limiter, delayed deferral, Slack OAuth and encrypted connection | Slack connect/disconnect status control |
| Queue operations | Optional authenticated Bull Board | — |

## API overview

All `/api/emails/*` routes require the session cookie and scope database/search results to the authenticated user.

```text
GET    /health
GET    /auth/google
GET    /auth/google/callback
GET    /auth/me
POST   /auth/logout
POST   /api/emails/schedule
GET    /api/emails/scheduled?page=1&pageSize=25
GET    /api/emails/sent?page=1&pageSize=25
GET    /api/emails/search?q=hello&status=sent&sender=...&page=1&pageSize=25
GET    /api/emails/senders
GET    /api/slack/connect
GET    /api/slack/callback
GET    /api/slack/status
DELETE /api/slack/disconnect
GET    /admin/queues
```

Schedule body:

```json
{
  "subject": "A note for you",
  "body": "Hello!",
  "recipients": ["one@example.com", "two@example.com"],
  "startTime": "2026-10-16T22:00:00.000Z",
  "delayBetweenEmails": 2,
  "hourlyLimit": 25,
  "sender": "optional-configured-sender@example.com"
}
```

## Demo: rate limit, Slack, and restart recovery

This demo starts the built API and worker processes, schedules 50 test recipients with a per-sender limit of one, schedules a separate recovery probe, restarts both processes while jobs are still delayed, and verifies that (a) an actual Slack alert was recorded as delivered, (b) the recovery probe sends after restart, (c) sent DB rows contain no duplicate IDs, and (d) rate-limited messages remain queued for the next UTC hour. It refuses to reuse an already-consumed sender/hour counter.

1. Start Docker, apply migrations, and seed as described above.
2. Set `NODE_ENV=development`, configure working Slack and Ethereal settings, and optionally enable the dashboard's demo login (`VITE_ENABLE_DEMO_LOGIN=true`).
3. Sign into the dashboard with the local demo user and connect Slack once.
4. Run:

   ```powershell
   npm run demo
   ```

The script requires the current UTC-hour rate counter for its selected sender to be unused. Rate-limited recipients are intentionally delayed until the next UTC hour; they are not expected to send during the short demo. This demonstrates queue persistence and safe restart behavior without falsifying or clearing Redis rate-limit state.

## Tests and production build

```powershell
npm test
npm run build
```

Focused unit tests cover UTC rate-window boundaries and sequence offsets. The demo script is the integration check and requires running Redis, PostgreSQL, Elasticsearch, configured Ethereal senders, and a connected Slack workspace.

## Short demo video checklist (under 5 minutes)

1. Show the dashboard and Google/local-demo sign-in; point out the signed-in user and Slack status.
2. Compose a campaign from a CSV/text lead list; show deduplicated detected recipients, start time, spacing, sender rotation, and hourly limit.
3. Open the scheduled view and the Bull Board queue dashboard.
4. Run the demo script; show its sender/hour rate limit, Slack alert, and API/worker restart output.
5. Show the recovery probe in Sent and the remaining rate-limited rows still Scheduled; explain they resume next UTC hour without duplicate sends.

## Assumptions and trade-offs

- Ethereal is mandatory for this demo implementation; it accepts SMTP messages for inspection but does not deliver to real inboxes.
- Authentication is Google OAuth in normal use. The local development login is explicitly development-gated.
- The sender pool is generated once and encrypted in Redis; changing the sender count after the pool has been created does not rotate existing credentials. To deliberately recreate a local demo pool, remove its Redis data only after stopping the demo processes and after confirming the target Redis instance contains no state that must be preserved.
- Rate keys and send-slot reservations are global to the configured sender account. Per-schedule limits override the cap for that job, while the Redis count remains shared across users/campaigns using that sender.
- Slack notifications are de-duplicated globally once per sender/UTC hour. When the sender is shared by multiple users, the connection belonging to the first rate-limited job that acquires the alert key receives that window's notification.
- DB and queue commits cannot be made one atomic transaction. Startup reconciliation closes the DB-first/queue-second gap; the DB compare-and-set protects delivery idempotency.
- A worker crash after the SMTP server accepts a message but before PostgreSQL records it is inherently ambiguous without SMTP provider idempotency or delivery events. This implementation does not retry a claimed row.
