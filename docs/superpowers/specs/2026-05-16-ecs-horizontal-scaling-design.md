# ECS Horizontal Scaling — Design Spec

**Date:** 2026-05-16
**Scope:** `packages/openmemory-js` server (Node/TS). Python SDK out of scope.
**Author:** Claude + Hugo Hiroshi
**Status:** Draft — pending review

---

## 1. Goal

Run the OpenMemory JS server (port 8080) horizontally on AWS ECS Fargate, with N stateless API replicas behind an Application Load Balancer (ALB) and a separate singleton worker container for background jobs. All shared state lives in managed services (RDS Postgres for metadata, S3 Vectors for vectors).

The deployment must:

- Scale API replicas by CPU/RPS without breaking decay, prune, reflection, or user-summary jobs.
- Stay compatible with the existing public HTTP/MCP API and the local `docker-compose.yml` workflow.
- Keep the change surface in the product code minimal — the scaling-aware logic is a single new env var (`OM_BG_JOBS`) plus an early-return in `src/server/index.ts`.
- Ship as Terraform under `infra/terraform/` so the AWS topology is reviewable in PRs.

## 2. Non-goals

- Multi-region / cross-AZ DR beyond what RDS Multi-AZ and Fargate's default AZ spread give us.
- Spot capacity or Graviton optimization (cost tuning happens later).
- WAF, CloudFront, edge caching.
- Migrating the dashboard (`dashboard/`) onto ECS — separate decision.
- Touching `packages/openmemory-py`. The Python SDK is not deployed by this work.
- Replacing Doppler for local development (the existing `tools/ops/compose_with_doppler.sh` workflow stays as-is).

## 3. What blocks horizontal scaling today

Two concrete issues in the current server. Everything else is already stateless or has a working remote backend.

### 3.1 Local SQLite default

`docker-compose.yml:14` sets `OM_DB_PATH=/data/openmemory.sqlite` on a local Docker volume. SQLite cannot be shared between containers. In ECS this would mean each task has its own divergent metadata DB.

**Resolution:** force `OM_METADATA_BACKEND=postgres` in the ECS task definitions. The Postgres backend already exists (`packages/openmemory-js/src/core/db.ts`, configured via `OM_PG_*` env vars).

### 3.2 Background jobs run on every replica

`src/server/index.ts:96-135` schedules four background loops inside the HTTP server process:

| Line | Job | Interval |
|------|-----|----------|
| `index.ts:101-111` | `run_decay_process()` | `OM_DECAY_INTERVAL_MINUTES` (default 24h) |
| `index.ts:112-123` | `prune_weak_waypoints()` | 7 days |
| `index.ts:124-132` | Initial decay on boot | `setTimeout` 3s after start |
| `index.ts:134-135` | `start_reflection()` and `start_user_summary_reflection()` | internal intervals |

With N API replicas, all N execute every job, causing duplicate writes against the shared Postgres + S3 backend.

**Resolution:** gate these loops on a new `OM_BG_JOBS` env var (see §5).

## 4. Architecture

### 4.1 Components

```
                              Internet
                                 │
                          ┌──────▼──────┐
                          │     ALB     │  (HTTPS, /health target)
                          └──────┬──────┘
                                 │
                       ┌─────────┴─────────┐
                       │                   │
              ┌────────▼───────┐  ┌────────▼───────┐
              │  openmemory-api │  │  openmemory-api │  …  (Fargate, autoscaled)
              │  OM_BG_JOBS=off │  │  OM_BG_JOBS=off │
              └────────┬───────┘  └────────┬───────┘
                       │                   │
                       └──────┬────────────┘
                              │
                       ┌──────┴──────────┐
                       │                 │
                  ┌────▼────┐      ┌─────▼────────┐
                  │   RDS    │      │ S3 Vectors  │
                  │ Postgres │      │   bucket    │
                  └────▲─────┘      └──────▲──────┘
                       │                   │
                  ┌────┴───────────────────┴────┐
                  │  openmemory-worker          │  (Fargate, desired=1)
                  │  OM_BG_JOBS=worker          │
                  └─────────────────────────────┘
```

**`openmemory-api`** (ECS Service)
- Same Docker image as today (`packages/openmemory-js/Dockerfile`)
- `OM_BG_JOBS=off`, `OM_METADATA_BACKEND=postgres`, `OM_VECTOR_BACKEND=s3`
- desired count = 2, autoscale 2..N on target tracking (CPU 60%)
- Behind ALB target group, health check `GET /health`
- Stateless: no volumes, no local file writes

**`openmemory-worker`** (ECS Service)
- Same image, same task definition shape
- `OM_BG_JOBS=worker`
- desired count = **1**, deployment minimumHealthyPercent = 0, maximumPercent = 100 (singleton guarantee — never two workers running simultaneously, even during deploys)
- No ALB attachment. Healthcheck via ECS task definition healthCheck command, not via ALB.
- Restart on crash (Fargate default)

**RDS Postgres**
- Single managed instance, db.t4g.small to start, Multi-AZ optional (off in dev, on in prod)
- Schema bootstrap via the existing `npm run migrate` (= `tsx src/core/migrate.ts`)
- Credentials in AWS Secrets Manager

**S3 Vectors**
- Existing bucket via `OPENMEMORY_S3_BUCKET`, index `OPENMEMORY_S3_INDEX_NAME` (default `om-vectors`)
- IAM role on the ECS task grants vector R/W; no static AWS keys in env

**ECR**
- Single repo `openmemory/openmemory-js`
- Image tagged by git SHA; both services reference the same tag

### 4.2 Data flow

Identical to the current architecture — the engine code is unchanged. The only behavioral difference is *who runs the periodic jobs* (worker, not API). Read/write paths from API replicas to RDS+S3 are unchanged.

### 4.3 What stays the same

- HSG add/query flows, embeddings, MCP server (`/mcp`), LangGraph routes (`/lgm/*`)
- i18n language packs and `pt-health` domain overlay
- Multi-tenant identity via `req.tenant` (headers)
- Webhook HMAC verification
- Public API surface — zero breaking changes
- `docker-compose.yml` for local dev — keeps SQLite default; `OM_BG_JOBS` defaults to `api` so a single local container still runs the jobs (see §5.4)

## 5. Code changes

Scope: ~5 files touched. Everything else is infra.

### 5.1 New env var: `OM_BG_JOBS`

Added to `src/core/cfg.ts` env parsing:

```ts
bg_jobs: (process.env.OM_BG_JOBS ?? "api") as "api" | "worker" | "off"
```

| Value | Behavior |
|-------|----------|
| `api` *(default)* | HTTP server runs **and** background jobs run. Matches today's behavior — preserves local/compose UX. |
| `off` | HTTP server runs, background jobs do not. Used by ECS API service. |
| `worker` | Background jobs run, HTTP server does **not** call `app.listen`. Used by ECS worker service. The worker still exposes `/health` on a lightweight loopback for ECS task healthcheck. |

### 5.2 Edits to `src/server/index.ts`

Gate the four scheduled jobs (`index.ts:101-135`) behind `env.bg_jobs !== "off"`, and gate the `app.listen` call (`index.ts:138`) behind `env.bg_jobs !== "worker"`.

In worker mode, expose `/health` via a minimal listener (so ECS task healthcheck has something to probe) but do not register the full route tree.

Pseudocode (illustrative; final code will follow existing style):

```ts
if (env.bg_jobs !== "off") {
  // existing setInterval blocks
  start_reflection();
  start_user_summary_reflection();
}

if (env.bg_jobs === "worker") {
  // minimal healthcheck-only listener
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
  app.listen(env.port);
} else {
  // existing full listen
  app.listen(env.port, () => { /* … */ });
}
```

### 5.3 Telemetry note

`sendTelemetry()` is called once on API boot today (`index.ts:140`). Worker mode skips it — we don't want every worker restart to look like a new install. The API service is the source of truth for telemetry.

### 5.4 `docker-compose.yml`

- Add `OM_BG_JOBS=${OM_BG_JOBS:-api}` to the `openmemory` service environment block
- Add a commented-out `openmemory-worker` service example (for users who want to mirror the production split locally)
- Default behavior unchanged: `docker compose up` still gives you a single container running everything (`OM_BG_JOBS=api`)

### 5.5 Tests

- Add a vitest spec (`tests/bg_jobs_mode.test.ts`) that imports `cfg` with `OM_BG_JOBS=worker`/`off`/`api` and asserts the parsed value
- Smoke-style integration test is **out of scope** for this spec — the gating logic in `index.ts` is straightforward enough that the env-var unit test plus manual deploy verification covers it

## 6. Infrastructure (Terraform)

Layout under `infra/terraform/`:

```
infra/terraform/
├── README.md                  # how to apply, prerequisites
├── envs/
│   ├── dev/
│   │   ├── main.tf            # composes modules, sets dev-specific values
│   │   ├── variables.tf
│   │   └── terraform.tfvars   # gitignored if it contains secrets; .example committed
│   └── prod/                  # same shape as dev
└── modules/
    ├── network/               # VPC, subnets, NAT, security groups
    ├── ecr/                   # repo + lifecycle policy
    ├── rds/                   # Postgres instance + parameter group + subnet group
    ├── secrets/               # Secrets Manager entries
    ├── ecs_cluster/           # cluster, IAM exec role, IAM task roles (api, worker)
    ├── ecs_api/               # task def + service + ALB target group + autoscaling
    ├── ecs_worker/            # task def + service (no ALB)
    └── alb/                   # ALB + listener + cert
```

**Module boundaries chosen so each module owns one AWS-level concept.** `ecs_api` and `ecs_worker` share the underlying image but differ in env, count, and ALB attachment — keeping them separate keeps each module focused and avoids the "one mega-module with bool toggles" pattern that gets unreadable fast.

State backend: S3 + DynamoDB lock table. Bucket name configurable via `terraform.tfvars`.

### 6.1 IAM

Two task roles, narrowly scoped:

- **`openmemory-api-task-role`**: read from Secrets Manager (DB creds, API key), R/W to S3 Vectors bucket+index, no other AWS access
- **`openmemory-worker-task-role`**: same as API role (worker hits the same resources)

The ECS execution role (separate from task role) gets pull access to ECR and write access to CloudWatch Logs.

### 6.2 Secrets Manager entries

| Secret name | Contents |
|-------------|----------|
| `openmemory/db` | JSON: `{username, password, host, port, dbname}` — RDS master creds |
| `openmemory/api-key` | `OM_API_KEY` value |
| `openmemory/embeddings` | JSON with `OPENAI_API_KEY`, `OM_GEMINI_API_KEY`, etc. — whichever providers are active |

Task definitions reference these via `secrets` (mapped to env vars at container start).

### 6.3 Networking

- 1 VPC, 2 private subnets (one per AZ), 2 public subnets (for ALB + NAT)
- Security groups:
  - ALB SG: 443 from 0.0.0.0/0
  - API task SG: 8080 from ALB SG only
  - Worker task SG: no inbound (egress only)
  - RDS SG: 5432 from API SG and Worker SG
- VPC endpoints for ECR, S3, Secrets Manager, CloudWatch Logs (avoids NAT egress charges for AWS API traffic)

### 6.4 Observability

- CloudWatch Logs groups: `/ecs/openmemory-api` and `/ecs/openmemory-worker`, retention 30 days
- ALB access logs to a dedicated S3 bucket, 30-day lifecycle
- Container Insights enabled on the cluster (CPU/memory/network metrics per service)
- Alarms (CloudWatch):
  - API 5xx rate > 1% over 5 min
  - API task CPU > 80% sustained 10 min (signals autoscale gap)
  - Worker desiredCount != runningCount for > 10 min (singleton health)
  - RDS connections > 80% of max

## 7. Migration / rollout

Phased rollout, each step independently verifiable:

1. **Code change (PR 1):** add `OM_BG_JOBS` flag and the `index.ts` gating. Update `docker-compose.yml`. Land vitest spec. Defaults preserve current behavior — this PR is mergeable on its own with no infra.
2. **Terraform skeleton (PR 2):** `network`, `ecr`, `rds`, `secrets` modules + dev env. Apply against a dev AWS account. Validate RDS reachability and that `npm run migrate` runs against it from a one-shot ECS task.
3. **Terraform services (PR 3):** `ecs_cluster`, `ecs_api`, `ecs_worker`, `alb`. Apply to dev. Smoke test: `curl https://<alb>/health`, post a memory, query it, watch worker CloudWatch logs to confirm decay runs there and **not** in API logs.
4. **Prod env (PR 4):** clone dev env folder, switch sizes (Multi-AZ RDS, larger API min/max), apply.
5. **Cutover:** point production DNS to the prod ALB. Old single-container deployment can stay running in parallel during validation, then be torn down.

Rollback at any step is `terraform destroy` of that env, or for the code PR, a simple `git revert`.

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Worker service drifts to 0 replicas during a bad deploy → background jobs silently stop | CloudWatch alarm on `runningCount` (§6.4). A missed cycle is recoverable — decay/prune catch up at the next tick because they operate on the full memory set, not on a delta queue. Recovery is just bringing the worker back up. |
| Two workers run briefly during a rolling deploy → decay applied twice in one interval (over-decays salience) | Forced by `maximumPercent=100, minimumHealthyPercent=0` (deploy stops the old task before starting the new one). This favors a brief zero-worker window over an overlap window, which is the safer trade-off given that decay multiplies salience by `exp(-λΔt)` per run. |
| Postgres connection pool exhaustion under autoscale | API task env caps pool size; alarm on RDS connections; pool size × max API tasks must stay under RDS `max_connections`. Documented in `infra/terraform/README.md`. |
| Secrets Manager rotation breaks running tasks | Out of scope for now — rotation requires task restart. Document the manual rotation procedure; revisit when we wire rotation lambdas. |
| Cold-start latency on new API tasks during autoscale | Health check grace period 30s (matches Dockerfile `HEALTHCHECK --start-period=30s`). Scale-out is reactive; if we see latency spikes, switch to scheduled scaling for known peak windows. |
| Image size pulls slow Fargate start | Existing Dockerfile is already multi-stage and prunes dev deps — acceptable for now. Revisit if cold start > 60s. |

## 9. Open questions for review

1. **Region:** assumed `us-east-1` to match the existing S3 default. If prod traffic is LATAM-heavy (`evahsaude.com.br` suggests so), `sa-east-1` may be better. Picked in `envs/prod/terraform.tfvars`, easy to change before apply.
2. **Domain & TLS:** ALB needs a cert. Assumed ACM cert provisioned out-of-band; spec leaves the ARN as a `terraform.tfvars` input rather than provisioning it inline.
3. **HMAC webhook secret distribution:** today `OM_WEBHOOK_SECRETS` is plaintext env. In ECS it would go into Secrets Manager same as `OM_API_KEY`. Same pattern, no architectural decision needed — flagged here so it's not forgotten in the plan.

These do not block the spec. They are the first questions the implementation plan will pin down.
