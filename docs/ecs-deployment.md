# Deploying OpenMemory JS on AWS ECS Fargate

This document is the operator-facing reference for running the OpenMemory JS server (`packages/openmemory-js`) horizontally on AWS ECS Fargate. It assumes the **Terraform/infrastructure code lives in a separate repository**. The OpenMemory repo ships only the application code, the env-var contract, and the operational shape the Terraform must implement.

> Companion document with full design rationale: [`docs/superpowers/specs/2026-05-16-ecs-horizontal-scaling-design.md`](superpowers/specs/2026-05-16-ecs-horizontal-scaling-design.md).

---

## 1. Overview

The JS server runs in **three modes**, selected by the `OM_BG_JOBS` env var:

| Mode | HTTP server | Background jobs | Use in ECS |
|---|---|---|---|
| `api` *(default)* | Full | Run | Single-container local dev only |
| `off` | Full | **Skipped** | API replicas (stateless, horizontally scaled) |
| `worker` | Only `/health` | Run | Singleton worker container |

The production deployment is two ECS services on the same cluster, sharing the same Docker image and almost the same env vars:

```
                          Internet
                             │
                       ┌─────▼─────┐
                       │    ALB    │  HTTPS, target group health = GET /health
                       └─────┬─────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
       ┌──────▼──────┐               ┌──────▼──────┐
       │   API task  │     ...       │   API task  │   ECS Service "openmemory-api"
       │ BG_JOBS=off │               │ BG_JOBS=off │   desired=N, autoscale on CPU
       └──────┬──────┘               └──────┬──────┘
              └──────────────┬──────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
           ┌────▼─────┐             ┌─────▼──────┐
           │ RDS PG   │             │ S3 Vectors │
           │ metadata │             │  vectors   │
           └────▲─────┘             └─────▲──────┘
                │                         │
           ┌────┴─────────────────────────┴─────┐
           │       Worker task                  │   ECS Service "openmemory-worker"
           │       BG_JOBS=worker               │   desired=1 (singleton)
           └────────────────────────────────────┘
```

**Why two services, not one autoscaled service:** background jobs (decay, prune, reflection) must run exactly once per cycle, not N times. The worker singleton is the simplest way to guarantee that without adding distributed-lock logic to the product code. See spec §3.2 for the failure mode.

---

## 2. Container image

Single image, built from `packages/openmemory-js/Dockerfile`. Multi-stage build, ends as `node:20-bookworm-slim`, runs as non-root `appuser:1001`, exposes `8080`, has a built-in `HEALTHCHECK` probing `http://localhost:8080/health`.

The same image runs both services — only env vars differ. Tag images by git SHA. Push to a single ECR repo (`openmemory/openmemory-js` or similar).

```bash
# Build and push (run from repo root, in CI or locally with appropriate IAM)
docker build -t $REPO:$SHA -f packages/openmemory-js/Dockerfile packages/openmemory-js/
docker push $REPO:$SHA
```

Both services' task definitions reference the same `$REPO:$SHA`.

---

## 3. Two task definitions

### 3.1 `openmemory-api` task definition

| Field | Value |
|---|---|
| CPU / memory | start with `512 / 1024` (0.5 vCPU, 1 GB); tune after observing |
| Network mode | `awsvpc` |
| Port mappings | container 8080 → target group 8080 |
| Healthcheck (container) | the Dockerfile's `HEALTHCHECK` is sufficient; ALB target group also probes `/health` |
| Restart policy | default (Fargate restarts on failure) |
| Execution role | pulls image from ECR, writes to CloudWatch Logs, reads referenced secrets |
| Task role | reads/writes to S3 Vectors bucket+index, reads Secrets Manager entries |

**Env (required):**

```
OM_BG_JOBS=off                              # CRITICAL — must be "off" on the API
OM_PORT=8080
OM_METADATA_BACKEND=postgres
OM_VECTOR_BACKEND=s3
OM_PG_HOST=<rds endpoint>
OM_PG_PORT=5432
OM_PG_DB=openmemory
OM_PG_SSL=require
OPENMEMORY_S3_BUCKET=<bucket>
OPENMEMORY_S3_INDEX_NAME=om-vectors
AWS_REGION=<region>
OM_TIER=hybrid                              # or deep/smart/fast per embedding choice
OM_EMBEDDINGS=openai                        # or gemini/aws/ollama/local/synthetic
NODE_ENV=production
```

**Env (recommended, tune to your load):**

```
OM_RATE_LIMIT_ENABLED=true
OM_RATE_LIMIT_WINDOW_MS=60000
OM_RATE_LIMIT_MAX_REQUESTS=600
OM_COMPRESSION_ENABLED=true
OM_LOG_AUTH=false                           # set true only for debugging
OM_DECAY_REINFORCE_ON_QUERY=true
```

**Secrets (from Secrets Manager — see §4):**

```
OM_API_KEY            → from openmemory/api-key
OM_PG_USER            → from openmemory/db          (key: username)
OM_PG_PASSWORD        → from openmemory/db          (key: password)
OPENAI_API_KEY        → from openmemory/embeddings  (key: openai)
OM_GEMINI_API_KEY     → from openmemory/embeddings  (key: gemini)   # if used
OM_WEBHOOK_SECRETS    → from openmemory/webhook     # if HMAC webhooks are enabled
```

### 3.2 `openmemory-worker` task definition

Same as `openmemory-api` with three differences:

1. `OM_BG_JOBS=worker` instead of `off`
2. **No** ALB target group attachment — worker is not load-balanced
3. **No** rate-limiting env vars needed (worker serves no traffic except `/health`)

The worker still binds port 8080 internally so the Dockerfile's `HEALTHCHECK` (and any ECS task-level healthCheck pointing at `localhost:8080/health`) succeeds. No port mapping to an ALB is required.

---

## 4. Secrets Manager layout

Four secrets, all in the same region as the ECS cluster:

| Secret name | Type | Keys / shape |
|---|---|---|
| `openmemory/api-key` | string | The raw `OM_API_KEY` value (single string secret) |
| `openmemory/db` | JSON | `{username, password, host, port, dbname}` — created by RDS or manually after RDS is up |
| `openmemory/embeddings` | JSON | `{openai: "...", gemini: "...", ...}` — only the provider keys you actually use |
| `openmemory/webhook` | string | `OM_WEBHOOK_SECRETS` value (comma-separated HMAC secrets), only if webhooks are wired |

The task definitions reference these via `secrets[].valueFrom = <secret-arn>:<json-key>::` (the json-key suffix lets ECS extract a single field from a JSON secret into the matching env var name).

---

## 5. IAM

Three roles, narrowly scoped.

### 5.1 Task execution role (one, shared by both services)

Used by ECS itself to pull images, write logs, and inject secrets. Standard policy:

- `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability` on the openmemory ECR repo ARN
- `logs:CreateLogStream`, `logs:PutLogEvents` on the two CloudWatch log groups (`/ecs/openmemory-api`, `/ecs/openmemory-worker`)
- `secretsmanager:GetSecretValue` on the four secret ARNs above
- `kms:Decrypt` on the KMS key used by Secrets Manager (only if you used a customer-managed KMS key)

### 5.2 API task role

Used by the running container. Permissions:

- `s3vectors:PutVector`, `s3vectors:GetVector`, `s3vectors:QueryVectors`, `s3vectors:DeleteVector`, `s3vectors:DescribeVectorIndex` on the S3 Vectors index ARN
- No other AWS API access

### 5.3 Worker task role

Identical to the API task role. The worker hits the same resources.

> **Important:** the API task role and worker task role should be **two separate IAM roles** even though their policies are identical today. This lets you tighten them independently later (e.g., revoke vector writes from the API if you ever route writes through the worker) without coupled changes.

---

## 6. Networking

| Component | Subnet placement | Inbound | Outbound |
|---|---|---|---|
| ALB | Public (one per AZ) | 443 from 0.0.0.0/0 | to API task SG on 8080 |
| API tasks | Private (one per AZ) | 8080 from ALB SG only | to RDS, S3 Vectors, Secrets Manager, CloudWatch |
| Worker task | Private | none | to RDS, S3 Vectors, Secrets Manager, CloudWatch |
| RDS | Private | 5432 from API SG **and** Worker SG | none |

**VPC endpoints (interface or gateway) for:** ECR API, ECR DKR, S3 (gateway), Secrets Manager, CloudWatch Logs, S3 Vectors (if a VPC endpoint exists for the region — check current AWS docs).

Without these endpoints, egress to AWS APIs goes through a NAT gateway, which is the cost driver to watch.

---

## 7. ECS service configuration

### 7.1 `openmemory-api` service

| Field | Value |
|---|---|
| Launch type | Fargate |
| Desired count | 2 |
| Deployment strategy | Rolling (`minimumHealthyPercent=100, maximumPercent=200`) |
| Autoscaling | Target tracking, CPU 60%, min 2, max as needed |
| Load balancer | Attached to ALB target group, healthcheck `GET /health` |
| Health check grace period | 30s (matches the Dockerfile `HEALTHCHECK --start-period=30s`) |

### 7.2 `openmemory-worker` service

| Field | Value |
|---|---|
| Launch type | Fargate |
| Desired count | **1** |
| Deployment strategy | Rolling (`minimumHealthyPercent=0, maximumPercent=100`) |
| Autoscaling | **None** |
| Load balancer | **Not attached** |
| Health check grace period | 60s (worker bootstraps the initial decay 3s after start) |

**Singleton guarantee:** `minimumHealthyPercent=0, maximumPercent=100` forces deploys to stop the old task before starting the new one. There is briefly zero workers during a deploy; there is never two workers simultaneously. This is the safer trade-off because decay is `salience *= exp(-λΔt)` per run — running it twice in the same interval over-decays, while missing a cycle is recovered at the next tick.

---

## 8. Observability

| What | Where |
|---|---|
| Application logs | CloudWatch Logs groups `/ecs/openmemory-api` and `/ecs/openmemory-worker`, retention 30 days |
| ALB access logs | S3 bucket with 30-day lifecycle |
| Container metrics | ECS Container Insights enabled on the cluster |
| Custom metrics | None today; `[DECAY] Completed: N/M` and `[INIT] Initial decay: N/M` are the log signatures to grep |

**Recommended CloudWatch alarms:**

1. **API 5xx rate** > 1% over 5 min → page
2. **API task CPU** > 80% sustained 10 min → page (signals autoscale gap)
3. **Worker `runningCount` != `desiredCount`** for > 10 min → page (singleton health)
4. **RDS connections** > 80% of `max_connections` → page (pool sizing issue)
5. **ALB target unhealthy** any 1 target for > 5 min → page

---

## 9. Health checks

`GET /health` is the universal liveness probe. It is exempt from the auth middleware (see `packages/openmemory-js/src/server/middleware/auth.ts:47-52`).

| Caller | Endpoint | Expected |
|---|---|---|
| ALB target group (api service) | `:8080/health` | 200 with full system body |
| Container HEALTHCHECK (api service) | `localhost:8080/health` | 200 |
| Container HEALTHCHECK (worker) | `localhost:8080/health` | 200 with `{"ok":true,"mode":"worker"}` |

The worker response includes `"mode": "worker"` so an operator can tell the two services apart by hitting the endpoint directly.

---

## 10. Database bootstrap

The Postgres schema is migrated by `npm run migrate` (= `tsx src/core/migrate.ts`). Run it once, before the services start, as a one-shot ECS task using the same task definition with the command overridden:

```
command = ["node", "dist/core/migrate.js"]
```

Run again whenever the schema evolves. The migration is idempotent.

Alternatively, deploy a CI step that runs the migration against the RDS endpoint before the rolling-deploy step.

---

## 11. Decide-at-apply-time

Not blockers for the application code, but blockers for actually provisioning anything:

1. **Region.** Default is `us-east-1`. LATAM traffic may prefer `sa-east-1`. Pick before VPC.
2. **ACM cert ARN.** Provisioned out of band, passed as a Terraform variable.
3. **Route53 zone + hostname.** Same.
4. **RDS sizing.** Suggestion: `db.t4g.small` single-AZ in dev, `db.t4g.medium` Multi-AZ in prod. Tune to actual load.
5. **API min/max replicas.** Dev 2..4, prod 2..10 are reasonable starts.
6. **State backend (S3 + DynamoDB lock).** Must exist before `terraform init`.
7. **Doppler vs Secrets Manager.** This document assumes Secrets Manager. If your Terraform project uses Doppler instead, the OpenMemory app code is agnostic — just inject the same env vars by whatever mechanism.

---

## 12. Rollback

| Scenario | Action |
|---|---|
| Bad API deploy | ECS rolling deploy auto-rolls back on health check failure; if not, redeploy previous image SHA |
| Bad worker deploy | Same — redeploy previous image SHA |
| Bad schema migration | Restore RDS from a point-in-time snapshot, redeploy previous image, re-run migrations |
| Lost vector data | S3 Vectors versioning + bucket policy — out of scope for the app, but consider |
| Total cluster failure | Re-`terraform apply` (infra is declarative); data lives in RDS + S3 Vectors and is unaffected |

---

## 13. Known operational notes

**Auth warning in worker logs.** The auth module runs its `OM_API_KEY` check at import time. The worker imports it (via `index.ts`) even though it never enforces auth. In production where `OM_API_KEY` is set, this is silent. In any environment where `OM_API_KEY` is *not* set, the worker will log:

```
[AUTH] WARNING: OM_API_KEY is not set. Protected endpoints will return 503. ...
```

This is harmless on the worker — it serves no protected endpoints. Set `OM_API_KEY` on the worker task definition (same value as the API) to silence it.

**Telemetry from API only.** `sendTelemetry()` runs once at API startup (`packages/openmemory-js/src/server/index.ts` else branch). The worker does not call it. Don't expect "openmemory installed" pings from worker restarts.

**Rate-limit state is per-replica.** The in-process rate limiter in `auth.ts` tracks counts in a local `Map`. With N API replicas, the effective per-tenant rate limit is `N × OM_RATE_LIMIT_MAX_REQUESTS`. Set the env value accordingly, or set `OM_RATE_LIMIT_ENABLED=false` if you have an ALB-side or WAF-side rate limit.

**Decay catches up after downtime.** If the worker is down for hours, the next decay run computes `Δt` from `last_seen_at` to now — the math is independent of how often the loop fires. No data loss.

---

## 14. Reference

- App code: `packages/openmemory-js/`
- Dockerfile: `packages/openmemory-js/Dockerfile`
- Health endpoint: `packages/openmemory-js/src/server/routes/system.ts:35`
- Auth middleware (`/health` whitelisted): `packages/openmemory-js/src/server/middleware/auth.ts:47-52`
- Background-jobs module: `packages/openmemory-js/src/server/bg_jobs.ts`
- Server bootstrap (where mode branching happens): `packages/openmemory-js/src/server/index.ts`
- Design spec (full rationale): `docs/superpowers/specs/2026-05-16-ecs-horizontal-scaling-design.md`
- CLAUDE.md handbook entry: `### Background-jobs mode (\`OM_BG_JOBS\`)`
