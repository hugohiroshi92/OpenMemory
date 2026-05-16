# ECS Horizontal Scaling — Design Spec

**Date:** 2026-05-16
**Scope:** `packages/openmemory-js` server (Node/TS). Python SDK out of scope.
**Author:** Claude + Hugo Hiroshi
**Status:** Draft — pending review

---

## 1. Goal

Prepare the OpenMemory JS server (port 8080) to run horizontally on AWS ECS Fargate, with N stateless API replicas behind an Application Load Balancer (ALB) and a separate singleton worker container for background jobs. All shared state would live in managed services (RDS Postgres for metadata, S3 Vectors for vectors).

**Scope clarification (revised 2026-05-16):** the deliverables in *this* repo are (a) the application code changes that make horizontal scaling safe, and (b) the deployment documentation. The Terraform / infrastructure code is **handled in a separate project**, not in this repo — this spec documents the operational shape that the external Terraform must implement, but no Terraform files are committed here.

The deliverables in this repo must:

- Scale API replicas by CPU/RPS without breaking decay, prune, reflection, or user-summary jobs *when* eventually deployed.
- Stay compatible with the existing public HTTP/MCP API and the local `docker-compose.yml` workflow.
- Keep the change surface in the product code minimal — the scaling-aware logic is a single new env var (`OM_BG_JOBS`) plus an early-return in `src/server/index.ts`.
- Document the deployment shape (env vars, IAM, secrets, networking, observability) in `docs/ecs-deployment.md` so the external Terraform project has an unambiguous contract to implement against.

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

## 6. Infrastructure (handled in an external Terraform project)

The Terraform that provisions all of this lives in a **separate project**, not in this repo. The shape it must implement is captured here for design context and is fully expanded — with concrete env var names, secret keys, IAM actions, and network rules — in [`docs/ecs-deployment.md`](../../ecs-deployment.md).

Suggested module layout for the external project (illustrative, the team owning the Terraform decides the final shape):

```
modules/
├── network/      # VPC, subnets, NAT, security groups
├── ecr/          # repo + lifecycle policy
├── rds/          # Postgres instance + parameter group + subnet group
├── secrets/      # Secrets Manager entries (4: api-key, db, embeddings, webhook)
├── ecs_cluster/  # cluster, IAM exec role, IAM task roles (api, worker — separate)
├── ecs_api/      # task def + service + ALB target group + autoscaling
├── ecs_worker/   # task def + service (singleton, no ALB)
└── alb/          # ALB + listener + cert
```

The reasoning behind `ecs_api` and `ecs_worker` as separate modules (rather than one parameterized module): they share the underlying image but differ meaningfully in env, count, ALB attachment, and deployment strategy — keeping them separate keeps each module focused.

### 6.1 IAM (summary; see ecs-deployment.md §5 for actions)

Three roles total:
- **`openmemory-api-task-role`** — R/W to S3 Vectors index. Nothing else.
- **`openmemory-worker-task-role`** — identical policy to api, kept as a separate role so the two can diverge later without coupled changes.
- **Task execution role (shared)** — ECR pull, CloudWatch Logs write, Secrets Manager read.

### 6.2 Secrets Manager entries (4 total; see ecs-deployment.md §4)

`openmemory/api-key`, `openmemory/db`, `openmemory/embeddings`, `openmemory/webhook` (last one only if HMAC webhooks are wired).

### 6.3 Networking (see ecs-deployment.md §6 for the full table)

1 VPC, 2 private + 2 public subnets, 4 security groups (ALB, API, Worker, RDS), VPC endpoints for ECR/S3/Secrets/Logs/S3-Vectors.

### 6.4 Observability (see ecs-deployment.md §8)

CloudWatch Logs (30 days retention), ALB access logs to S3, Container Insights, 5 recommended alarms (API 5xx, API CPU, Worker singleton health, RDS connections, ALB target unhealthy).

## 7. Delivery phases (what this work produces)

Revised scope: only the code and the deployment documentation are produced in this repo. The Terraform is built in a separate project and is not part of this effort.

1. **Code change (PR 1) — DONE:** added `OM_BG_JOBS` flag, extracted `bg_jobs.ts`, gated the loops, added worker mode, updated `docker-compose.yml`, added a CLAUDE.md handbook entry. Branch: `feat/ecs-bg-jobs`. Verified by: `npm run typecheck`, `npm test` (60/60), manual smoke for all three modes via `npx tsx`.
2. **Deployment documentation (this PR / follow-up):** `docs/ecs-deployment.md` — operator-facing deployment guide. Covers the architecture, container image, two task definitions (env vars + secrets + IAM), Secrets Manager layout, networking, ECS service configuration (including the singleton worker invariants), observability, health checks, DB bootstrap, decide-at-apply-time items, rollback, and known operational notes.

**What is NOT in this repo and lives in the external Terraform project:**

- All Terraform modules (network, ECR, RDS, ECS cluster, ECS services, ALB, Secrets, IAM)
- The state backend (S3 + DynamoDB lock) bootstrap
- AWS account setup, Route53 zone, ACM cert provisioning
- Any `terraform apply` against real environments
- Smoke tests against a live ALB
- DNS cutover
- Production cost monitoring beyond what Terraform provisions

The external Terraform project should treat `docs/ecs-deployment.md` as its requirements document — every env var, secret, IAM action, network rule, and service-deployment parameter the application needs is enumerated there.

**Definition of done for this repo:**

- Code PR 1 merged ✅
- `docs/ecs-deployment.md` merged
- Local `docker compose up` still works exactly as before for someone who clones the repo today ✅
- `npm test` and `npm run typecheck` green in `packages/openmemory-js` ✅

Rollback for any merged PR in this repo is a `git revert`. There is no live AWS state to roll back from this repo.

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Worker service drifts to 0 replicas during a bad deploy → background jobs silently stop | CloudWatch alarm on `runningCount` (§6.4). A missed cycle is recoverable — decay/prune catch up at the next tick because they operate on the full memory set, not on a delta queue. Recovery is just bringing the worker back up. |
| Two workers run briefly during a rolling deploy → decay applied twice in one interval (over-decays salience) | Forced by `maximumPercent=100, minimumHealthyPercent=0` (deploy stops the old task before starting the new one). This favors a brief zero-worker window over an overlap window, which is the safer trade-off given that decay multiplies salience by `exp(-λΔt)` per run. |
| Postgres connection pool exhaustion under autoscale | API task env caps pool size; alarm on RDS connections; pool size × max API tasks must stay under RDS `max_connections`. Documented in `infra/terraform/README.md`. |
| Secrets Manager rotation breaks running tasks | Out of scope for now — rotation requires task restart. Document the manual rotation procedure; revisit when we wire rotation lambdas. |
| Cold-start latency on new API tasks during autoscale | Health check grace period 30s (matches Dockerfile `HEALTHCHECK --start-period=30s`). Scale-out is reactive; if we see latency spikes, switch to scheduled scaling for known peak windows. |
| Image size pulls slow Fargate start | Existing Dockerfile is already multi-stage and prunes dev deps — acceptable for now. Revisit if cold start > 60s. |

## 9. Decide-at-apply-time

Things that don't block this work but do block actual deployment. The Terraform exposes each one as a `variable` with no default (or a documented placeholder), so `terraform plan` runs but `apply` fails fast if anything is missing. All are listed in the operator runbook (PR 5).

1. **Region:** spec assumes `us-east-1` to match the existing S3 default. If prod traffic is LATAM-heavy (`evahsaude.com.br` suggests so), `sa-east-1` may be better. Set in `envs/<env>/terraform.tfvars` at apply time.
2. **Domain & TLS:** ALB needs an ACM cert ARN. Assumed provisioned out-of-band; passed in via `terraform.tfvars`.
3. **HMAC webhook secret distribution:** today `OM_WEBHOOK_SECRETS` is plaintext env. In ECS it goes into Secrets Manager same as `OM_API_KEY`. Same pattern as the other secrets — included in the `secrets` module so it's not forgotten.
4. **RDS sizing:** dev uses `db.t4g.small` single-AZ; prod placeholder is `db.t4g.medium` Multi-AZ. Operator confirms or changes at apply time based on actual load expectations.
5. **API min/max replicas:** dev defaults to 2..4, prod placeholder 2..10. Tuned post-deploy from real traffic.
6. **State backend bucket + DynamoDB lock table:** must exist before `terraform init` works. Bootstrap procedure is in the runbook.
