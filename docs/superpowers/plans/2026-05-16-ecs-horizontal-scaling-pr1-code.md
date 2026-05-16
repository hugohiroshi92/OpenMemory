# ECS Horizontal Scaling — PR 1 (Code Changes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the OpenMemory JS server into three startup modes (`api` / `off` / `worker`) gated by a new `OM_BG_JOBS` env var, so a future ECS deployment can run stateless API replicas alongside a singleton worker container without changing any other product code.

**Architecture:** Add one new env field (`bg_jobs`) to `src/core/cfg.ts`. Extract the four existing background loops in `src/server/index.ts` (decay setInterval, prune setInterval, initial-decay setTimeout, two reflection starters) into a single `src/server/bg_jobs.ts` module. Gate the bg-jobs call and the full HTTP route tree in `index.ts` based on `env.bg_jobs`. Default behavior (`api`) is unchanged.

**Tech Stack:** TypeScript, Node 20, Vitest. No new dependencies. No infra in this PR.

**Spec reference:** `docs/superpowers/specs/2026-05-16-ecs-horizontal-scaling-design.md` §3, §4, §5.

**Out of scope for this PR (covered by later PRs):** Terraform, Dockerfile changes, prod env config, CLAUDE.md doc updates beyond a short pointer.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/openmemory-js/src/core/cfg.ts` | Add `bg_jobs` field to the exported `env` object with default `"api"` and validation against the allowed set. |
| Create | `packages/openmemory-js/src/server/bg_jobs.ts` | Single entry point `start_background_jobs()` that schedules decay, prune, initial-decay, reflection, and user-summary reflection. Pure extraction from `index.ts` — no behavior change. |
| Modify | `packages/openmemory-js/src/server/index.ts` | Replace the inline setInterval/setTimeout/start_reflection blocks with a single call to `start_background_jobs()` gated on `env.bg_jobs !== "off"`. Add a worker-mode branch that registers only `/health` and skips the full middleware/route/MCP wiring. |
| Modify | `docker-compose.yml` (repo root) | Add `OM_BG_JOBS=${OM_BG_JOBS:-api}` to the `openmemory` service env block. Add a commented-out `openmemory-worker` service that demonstrates the split locally. |
| Create | `packages/openmemory-js/tests/bg_jobs_mode.test.ts` | Vitest spec exercising cfg parsing for the three valid values + one invalid value (falls back to `api`). |

**Why this split:** `bg_jobs.ts` isolates the periodic-work concerns so the gating logic in `index.ts` becomes a one-line conditional. It also gives the engineer a clear surface to extend later (e.g., add a Postgres advisory lock without touching `index.ts`).

**Files explicitly NOT touched:** `src/memory/hsg.ts`, `src/memory/reflect.ts`, `src/memory/user_summary.ts`, any route handler, the MCP plumbing, the auth middleware, the Dockerfile. The rate-limit cleanup `setInterval` in `src/server/middleware/auth.ts:191` is per-replica in-memory state and stays running on every container — it is NOT a background job in the decay/prune sense.

---

## Task 0: Branch setup

**Files:**
- None modified yet.

- [ ] **Step 1: Create the feature branch**

Run from repo root (`/home/hhiroshi92/github/OpenMemory`):

```bash
git checkout main && git pull origin main && git checkout -b feat/ecs-bg-jobs
```

Expected: `Switched to a new branch 'feat/ecs-bg-jobs'`.

- [ ] **Step 2: Confirm the working tree is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Task 1: Add `bg_jobs` field to `env` parsing (TDD)

**Files:**
- Create: `packages/openmemory-js/tests/bg_jobs_mode.test.ts`
- Modify: `packages/openmemory-js/src/core/cfg.ts`

### Why

`env` is computed once at module load. To test it under different `OM_BG_JOBS` values we mutate `process.env`, call `vi.resetModules()`, then dynamically import `cfg`. This pattern is standard in Vitest.

### Allowed values

`"api"` (default), `"off"`, `"worker"`. Any other value (including empty string) falls back to `"api"` and logs a warning. Lowercase normalization for robustness.

- [ ] **Step 1: Write the failing test**

Create `packages/openmemory-js/tests/bg_jobs_mode.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("cfg.bg_jobs parsing", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        delete process.env.OM_BG_JOBS;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('defaults to "api" when OM_BG_JOBS is unset', async () => {
        const { env } = await import("../src/core/cfg");
        expect(env.bg_jobs).toBe("api");
    });

    it.each(["api", "off", "worker"] as const)(
        'accepts %s as a valid mode',
        async (value) => {
            process.env.OM_BG_JOBS = value;
            const { env } = await import("../src/core/cfg");
            expect(env.bg_jobs).toBe(value);
        },
    );

    it('normalizes uppercase to lowercase', async () => {
        process.env.OM_BG_JOBS = "WORKER";
        const { env } = await import("../src/core/cfg");
        expect(env.bg_jobs).toBe("worker");
    });

    it('falls back to "api" on invalid value and warns', async () => {
        process.env.OM_BG_JOBS = "garbage";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { env } = await import("../src/core/cfg");
        expect(env.bg_jobs).toBe("api");
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("OM_BG_JOBS"),
        );
        warn.mockRestore();
    });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/openmemory-js
npx vitest run tests/bg_jobs_mode.test.ts
```

Expected: All five tests FAIL with `env.bg_jobs` is undefined.

- [ ] **Step 3: Implement `bg_jobs` parsing in `cfg.ts`**

Open `packages/openmemory-js/src/core/cfg.ts`. After the existing helper definitions (`num`, `str`, `bool` — around line 7) and before the `tier` type definition, add a typed helper for the bg-jobs enum:

```ts
type BgJobsMode = "api" | "off" | "worker";
const BG_JOBS_VALUES: readonly BgJobsMode[] = ["api", "off", "worker"];
const parse_bg_jobs = (v: string | undefined): BgJobsMode => {
    if (!v) return "api";
    const normalized = v.toLowerCase();
    if ((BG_JOBS_VALUES as readonly string[]).includes(normalized)) {
        return normalized as BgJobsMode;
    }
    console.warn(
        `[OpenMemory] Invalid OM_BG_JOBS="${v}". ` +
            `Expected one of: ${BG_JOBS_VALUES.join(", ")}. Falling back to "api".`,
    );
    return "api";
};
```

Then inside the `env` object literal (between `port` and `db_path` is fine — keep it alphabetical-ish near `port` so it's easy to find):

```ts
bg_jobs: parse_bg_jobs(process.env.OM_BG_JOBS),
```

- [ ] **Step 4: Re-run the test and confirm it passes**

```bash
npx vitest run tests/bg_jobs_mode.test.ts
```

Expected: All five tests PASS.

- [ ] **Step 5: Run typecheck and the full test suite**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean, all tests pass (no regressions in `omnibus.test.ts`, `verify.test.ts`, etc.).

- [ ] **Step 6: Commit**

```bash
git add packages/openmemory-js/src/core/cfg.ts \
        packages/openmemory-js/tests/bg_jobs_mode.test.ts
git commit -m "$(cat <<'EOF'
feat(cfg): add OM_BG_JOBS env var (api|off|worker)

Lets a future ECS deployment split the JS server into stateless API
replicas (OM_BG_JOBS=off) and a singleton worker (OM_BG_JOBS=worker).
Default "api" preserves single-container behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract background jobs into `src/server/bg_jobs.ts` (pure refactor)

**Files:**
- Create: `packages/openmemory-js/src/server/bg_jobs.ts`
- Modify: `packages/openmemory-js/src/server/index.ts:96-135`

### Why

Today `index.ts:96-135` holds four scheduled blocks plus two reflection starters. Pulling them into one module gives a single function to gate and a clean place to grow later (e.g., advisory-lock wrappers). No behavior change in this task — we just move code.

- [ ] **Step 1: Create the new module**

Write `packages/openmemory-js/src/server/bg_jobs.ts`:

```ts
import { env } from "../core/cfg";
import { run_decay_process, prune_weak_waypoints } from "../memory/hsg";
import { start_reflection } from "../memory/reflect";
import { start_user_summary_reflection } from "../memory/user_summary";

/**
 * Schedule all periodic background work: HSG decay, weak-waypoint
 * pruning, the initial bootstrap decay, and the two reflection loops.
 *
 * Called once at process start when env.bg_jobs !== "off".
 */
export function start_background_jobs(): void {
    const decayIntervalMs = env.decay_interval_minutes * 60 * 1000;
    console.log(
        `[DECAY] Interval: ${env.decay_interval_minutes} minutes (${decayIntervalMs / 1000}s)`,
    );

    setInterval(async () => {
        console.log("[DECAY] Running HSG decay process...");
        try {
            const result = await run_decay_process();
            console.log(
                `[DECAY] Completed: ${result.decayed}/${result.processed} memories updated`,
            );
        } catch (error) {
            console.error("[DECAY] Process failed:", error);
        }
    }, decayIntervalMs);

    setInterval(
        async () => {
            console.log("[PRUNE] Pruning weak waypoints...");
            try {
                const pruned = await prune_weak_waypoints();
                console.log(`[PRUNE] Completed: ${pruned} waypoints removed`);
            } catch (error) {
                console.error("[PRUNE] Failed:", error);
            }
        },
        7 * 24 * 60 * 60 * 1000,
    );

    setTimeout(() => {
        run_decay_process()
            .then((result: any) => {
                console.log(
                    `[INIT] Initial decay: ${result.decayed}/${result.processed} memories updated`,
                );
            })
            .catch(console.error);
    }, 3000);

    start_reflection();
    start_user_summary_reflection();
}
```

- [ ] **Step 2: Delete the moved blocks from `index.ts`**

Open `packages/openmemory-js/src/server/index.ts`. Delete lines `96-135` (the `decayIntervalMs` log, the two `setInterval` blocks, the `setTimeout` block, `start_reflection()`, `start_user_summary_reflection()`).

Also remove these now-unused imports from the top of the file:
- `import { run_decay_process, prune_weak_waypoints } from "../memory/hsg";`
- `import { start_reflection } from "../memory/reflect";`
- `import { start_user_summary_reflection } from "../memory/user_summary";`

In the same import area, add:
- `import { start_background_jobs } from "./bg_jobs";`

- [ ] **Step 3: Re-insert a single call where the deleted block was**

Where you deleted `96-135`, insert (still **unconditional** in this task — the gate comes in Task 3):

```ts
start_background_jobs();
```

- [ ] **Step 4: Typecheck and run the full suite**

```bash
cd packages/openmemory-js
npm run typecheck && npm test
```

Expected: typecheck clean, all tests pass. Behavior is identical to before this task — only file layout changed.

- [ ] **Step 5: Smoke-run the dev server**

```bash
npm run dev
```

Wait ~5 seconds. Expected log lines (same as before this task):
- `[DECAY] Interval: 1440 minutes (86400s)`
- `[SERVER] Starting on port 8080`
- `[SERVER] Running on http://localhost:8080`
- After ~3s: `[INIT] Initial decay: ...`

Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add packages/openmemory-js/src/server/bg_jobs.ts \
        packages/openmemory-js/src/server/index.ts
git commit -m "$(cat <<'EOF'
refactor(server): extract background loops into bg_jobs module

Pure code movement — no behavior change. Decay, prune, initial decay,
and the two reflection starters now live behind one start_background_jobs()
entry point. Prepares the gating change in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Gate `start_background_jobs()` on `env.bg_jobs`

**Files:**
- Modify: `packages/openmemory-js/src/server/index.ts`

### Why

This is the smallest possible behavior change to make the JS server safe to run as multiple stateless replicas: skip the periodic work when `OM_BG_JOBS=off`.

- [ ] **Step 1: Wrap the call with a conditional**

In `packages/openmemory-js/src/server/index.ts`, find the line you added in Task 2:

```ts
start_background_jobs();
```

Replace it with:

```ts
if (env.bg_jobs !== "off") {
    console.log(`[BG_JOBS] Mode=${env.bg_jobs} — starting background jobs`);
    start_background_jobs();
} else {
    console.log(`[BG_JOBS] Mode=off — skipping background jobs (API replica)`);
}
```

- [ ] **Step 2: Typecheck and full test suite**

```bash
cd packages/openmemory-js
npm run typecheck && npm test
```

Expected: typecheck clean, all tests pass. The test suite runs with `OM_BG_JOBS` unset, so `env.bg_jobs === "api"` and the existing code path is exercised.

- [ ] **Step 3: Manual verification — API mode (default)**

```bash
npm run dev
```

Expected log (within ~3s): `[BG_JOBS] Mode=api — starting background jobs`, followed by the `[DECAY] Interval: ...` line and eventually `[INIT] Initial decay: ...`.

Stop with Ctrl+C.

- [ ] **Step 4: Manual verification — off mode**

```bash
OM_BG_JOBS=off npm run dev
```

Expected log: `[BG_JOBS] Mode=off — skipping background jobs (API replica)`. The `[DECAY] Interval` line and `[INIT] Initial decay` line must **NOT** appear. The server should still bind to port 8080 and serve `GET /health` (test in another terminal: `curl -s http://localhost:8080/health` returns a 200 JSON payload).

Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add packages/openmemory-js/src/server/index.ts
git commit -m "$(cat <<'EOF'
feat(server): gate background jobs on OM_BG_JOBS env var

OM_BG_JOBS=off skips decay/prune/reflection so multiple stateless API
replicas can run safely behind a load balancer. Default "api" preserves
single-container behavior. The "worker" mode (HTTP-stripped) is added
in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Worker mode — minimal HTTP server (`/health` only)

**Files:**
- Modify: `packages/openmemory-js/src/server/index.ts`

### Why

In ECS, the worker task runs only the background jobs. We still bind port 8080 so the existing Dockerfile `HEALTHCHECK` (which probes `http://localhost:8080/health`) keeps working with zero Dockerfile changes. We skip the full middleware/route/MCP wiring in worker mode to keep the surface area small — the worker should NOT serve memory reads or writes.

The auth middleware whitelists `/health` (see `src/server/middleware/auth.ts:48`), so registering `/health` either before or after auth is fine. We register it directly and skip the auth middleware entirely in worker mode.

- [ ] **Step 1: Locate the existing wiring block**

Open `packages/openmemory-js/src/server/index.ts`. The current shape (after Task 3) is roughly:

```ts
const app = server({ max_payload_size: env.max_payload_size });
console.log(ASC);
// ... config logs ...

app.use(req_tracker_mw());
app.use((req, res, next) => { /* CORS */ });
app.use(authenticate_api_request);
if (process.env.OM_LOG_AUTH === "true") { app.use(log_authenticated_request); }

routes(app);
mcp(app);
if (env.mode === "langgraph") { console.log("[MODE] LangGraph integration enabled"); }

if (env.bg_jobs !== "off") {
    console.log(`[BG_JOBS] Mode=${env.bg_jobs} — starting background jobs`);
    start_background_jobs();
} else {
    console.log(`[BG_JOBS] Mode=off — skipping background jobs (API replica)`);
}

console.log(`[SERVER] Starting on port ${env.port}`);
app.listen(env.port, () => {
    console.log(`[SERVER] Running on http://localhost:${env.port}`);
    sendTelemetry().catch((err: any) => { /* ... */ });
});
```

- [ ] **Step 2: Add a worker-mode early branch**

Right after the `const app = server(...)` line and the initial config logs, but **before** the `app.use(req_tracker_mw())` call, insert:

```ts
if (env.bg_jobs === "worker") {
    console.log(`[BG_JOBS] Mode=worker — HTTP stripped to /health only`);

    // Minimal /health for the container healthcheck. No auth, no CORS,
    // no routes, no MCP. Worker exists to run background jobs.
    app.get("/health", (_req: any, res: any) => {
        res.status(200).json({ ok: true, mode: "worker" });
    });

    console.log(`[BG_JOBS] Starting background jobs`);
    start_background_jobs();

    console.log(`[SERVER] Starting on port ${env.port} (worker)`);
    app.listen(env.port, () => {
        console.log(
            `[SERVER] Worker running on http://localhost:${env.port}`,
        );
    });
} else {
    // existing full-server wiring goes here — see Step 3
}
```

- [ ] **Step 3: Move the existing wiring into the `else` branch**

Take everything from `app.use(req_tracker_mw())` down through the final `app.listen(...)` block (including the `sendTelemetry()` call) and place it inside the `else { ... }` body of the conditional you just added.

The end result is one top-level `if (env.bg_jobs === "worker") { ... } else { ... }` block. The else branch is exactly the previous behavior unchanged.

- [ ] **Step 4: Typecheck and full test suite**

```bash
cd packages/openmemory-js
npm run typecheck && npm test
```

Expected: typecheck clean, all tests pass. The vitest env has `OM_BG_JOBS` unset so the else branch is exercised.

- [ ] **Step 5: Manual verification — worker mode**

```bash
OM_BG_JOBS=worker npm run dev
```

Expected logs (in order):
1. `[BG_JOBS] Mode=worker — HTTP stripped to /health only`
2. `[BG_JOBS] Starting background jobs`
3. `[DECAY] Interval: 1440 minutes (86400s)`
4. `[SERVER] Starting on port 8080 (worker)`
5. `[SERVER] Worker running on http://localhost:8080`
6. After ~3s: `[INIT] Initial decay: ...`

In another terminal:

```bash
# /health should succeed
curl -i http://localhost:8080/health
# expected: HTTP 200, body {"ok":true,"mode":"worker"}

# Other registered routes should NOT be reachable in worker mode (404)
# /api/system/health and /mcp both exist in API mode (whitelisted in auth)
# — they must 404 in worker mode because we skipped routes(app) and mcp(app).
curl -i http://localhost:8080/api/system/health
# expected: HTTP 404
curl -i http://localhost:8080/mcp
# expected: HTTP 404
```

Stop with Ctrl+C.

- [ ] **Step 6: Manual verification — API mode still works**

```bash
npm run dev
```

Expected: same logs as before this PR. `curl -s http://localhost:8080/health` returns 200. Routes like `/api/memory/...` are registered (auth-gated, but registered).

Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add packages/openmemory-js/src/server/index.ts
git commit -m "$(cat <<'EOF'
feat(server): add worker mode (HTTP-stripped, /health only)

OM_BG_JOBS=worker registers only /health and runs the background jobs.
Auth middleware, CORS, the full route tree, and MCP are all skipped —
the worker exists to run decay/prune/reflection, not to serve traffic.
Binding port 8080 keeps the existing Dockerfile HEALTHCHECK working.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Document `OM_BG_JOBS` in `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml` (repo root)

### Why

Two things: (1) make the new env var visible to anyone running compose locally, and (2) give a working example of the API+Worker split as a commented-out service so local testing of the production shape is one uncomment away.

- [ ] **Step 1: Add `OM_BG_JOBS` to the `openmemory` service env block**

Open `docker-compose.yml` at the repo root. Find the `environment:` block under the `openmemory` service (around line 9, immediately under `env_file: .env`). Just after the `OM_MODE` line (`docker-compose.yml:12`) add:

```yaml
      - OM_BG_JOBS=${OM_BG_JOBS:-api}
```

- [ ] **Step 2: Add a commented-out worker service**

At the end of the `services:` section (after the existing `dashboard:` service block and the optional `valkey` block, before the top-level `volumes:` key around line 185), append:

```yaml
  # Optional: dedicated background-jobs worker — mirrors the planned
  # ECS split (one API service + one worker singleton). Uncomment to
  # run decay/prune/reflection in a separate container locally.
  # Set OM_BG_JOBS=off on the openmemory service when using this.
  #
  # openmemory-worker:
  #   build:
  #     context: ./packages/openmemory-js
  #     dockerfile: Dockerfile
  #   env_file: .env
  #   environment:
  #     - OM_BG_JOBS=worker
  #     - OM_PORT=8080
  #     - OM_METADATA_BACKEND=${OM_METADATA_BACKEND:-sqlite}
  #     - OM_VECTOR_BACKEND=${OM_VECTOR_BACKEND:-sqlite}
  #     - OM_DB_PATH=${OM_DB_PATH:-/data/openmemory.sqlite}
  #     # Mirror any provider keys the API service uses
  #     - OPENAI_API_KEY=${OPENAI_API_KEY:-}
  #     - GEMINI_API_KEY=${GEMINI_API_KEY:-}
  #   volumes:
  #     - openmemory_data:/data
  #   restart: unless-stopped
  #   healthcheck:
  #     test:
  #       [
  #         'CMD',
  #         'node',
  #         '-e',
  #         'require("http").get("http://localhost:8080/health",(res)=>process.exit(res.statusCode===200?0:1)).on("error",()=>process.exit(1))',
  #       ]
  #     interval: 30s
  #     timeout: 10s
  #     retries: 3
  #     start_period: 30s
```

- [ ] **Step 3: Validate compose syntax**

From the repo root:

```bash
docker compose config > /dev/null && echo "compose OK"
```

Expected: `compose OK`. If parsing fails, fix the indentation and re-run.

- [ ] **Step 4: Smoke-run default mode**

```bash
docker compose up --build -d
sleep 10
docker compose logs openmemory | tail -30
curl -s http://localhost:8080/health
docker compose down
```

Expected: logs show `[BG_JOBS] Mode=api — starting background jobs`. `/health` returns 200 JSON.

- [ ] **Step 5: Smoke-run with off mode**

```bash
OM_BG_JOBS=off docker compose up --build -d
sleep 10
docker compose logs openmemory | tail -30
curl -s http://localhost:8080/health
docker compose down
```

Expected: logs show `[BG_JOBS] Mode=off — skipping background jobs (API replica)`. No `[DECAY] Interval` or `[INIT] Initial decay` lines. `/health` still returns 200.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "$(cat <<'EOF'
chore(compose): expose OM_BG_JOBS and document worker split

Adds OM_BG_JOBS=${OM_BG_JOBS:-api} to the openmemory service so the
new mode flag is reachable from a .env file, and ships a commented-out
openmemory-worker service that demonstrates the API+worker split
locally. Default behavior unchanged for existing users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Short CLAUDE.md pointer (one paragraph)

**Files:**
- Modify: `CLAUDE.md` (repo root)

### Why

`CLAUDE.md` is the canonical handbook for working in this repo. Adding a one-paragraph pointer to the new env var makes the deployment model discoverable without bloating the doc.

- [ ] **Step 1: Add a subsection under "Architecture — the parts that span files"**

Open `CLAUDE.md`. Find the section header `## Architecture — the parts that span files`. After the section's existing subsections (it currently ends with `### Test strategy`), append a new subsection:

```markdown
### Background-jobs mode (`OM_BG_JOBS`)

The JS server has three startup modes selected by `OM_BG_JOBS`:

- `api` *(default)* — full HTTP server + background loops (decay, prune,
  reflection, user-summary). Matches the single-container behavior used
  by `docker compose up` and local dev.
- `off` — full HTTP server, no background loops. Used by stateless API
  replicas behind a load balancer; safe to scale horizontally.
- `worker` — only `/health` is served, all background loops run. Used by
  the singleton worker container in production.

The split is implemented in `packages/openmemory-js/src/server/bg_jobs.ts`
(job startup) and gated in `src/server/index.ts`. The
`docker-compose.yml` ships a commented-out `openmemory-worker` service
that mirrors the production shape locally.
```

- [ ] **Step 2: Verify the markdown still renders cleanly**

Eyeball the file or run any local markdown linter you have configured. The new subsection should sit at the same heading depth as the surrounding `### ...` blocks.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude): document OM_BG_JOBS modes in repo handbook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step 1: Confirm all six commits are on the branch**

```bash
git log --oneline main..feat/ecs-bg-jobs
```

Expected output (one line per commit, in order):

```
<sha> docs(claude): document OM_BG_JOBS modes in repo handbook
<sha> chore(compose): expose OM_BG_JOBS and document worker split
<sha> feat(server): add worker mode (HTTP-stripped, /health only)
<sha> feat(server): gate background jobs on OM_BG_JOBS env var
<sha> refactor(server): extract background loops into bg_jobs module
<sha> feat(cfg): add OM_BG_JOBS env var (api|off|worker)
```

- [ ] **Step 2: Full test suite + typecheck on the branch tip**

```bash
cd packages/openmemory-js
npm run typecheck && npm test
```

Expected: typecheck clean, all tests pass.

- [ ] **Step 3: Three-mode docker smoke (final)**

```bash
# api (default)
docker compose up --build -d && sleep 8 && \
  docker compose logs openmemory | grep BG_JOBS && \
  curl -s http://localhost:8080/health && docker compose down

# off
OM_BG_JOBS=off docker compose up --build -d && sleep 8 && \
  docker compose logs openmemory | grep -E "BG_JOBS|DECAY" && \
  curl -s http://localhost:8080/health && docker compose down

# worker — note: bring this up standalone (no API service routes available)
OM_BG_JOBS=worker docker compose up --build -d openmemory && sleep 8 && \
  docker compose logs openmemory | grep -E "BG_JOBS|SERVER" && \
  curl -s http://localhost:8080/health && \
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/system/health && \
  docker compose down
```

Expected:
- api mode: `[BG_JOBS] Mode=api`, `/health` returns 200 JSON.
- off mode: `[BG_JOBS] Mode=off`, no `[DECAY] Interval` line, `/health` returns 200.
- worker mode: `[BG_JOBS] Mode=worker`, `/health` returns 200 with `mode: "worker"`, `/api/system/health` returns 404 (full route tree not registered).

- [ ] **Step 4: Push the branch (do NOT open a PR yet — wait for human review)**

```bash
git push -u origin feat/ecs-bg-jobs
```

Expected: branch published to the fork (`origin`, per the project memory note).

The PR description (when the human opens it) should reference `docs/superpowers/specs/2026-05-16-ecs-horizontal-scaling-design.md` and call out that this is PR 1 of 5 toward ECS readiness.

---

## What this plan does NOT do (deferred to later PRs)

- `infra/terraform/` — entirely a later set of PRs
- Dockerfile changes — none required; the worker mode keeps the existing HEALTHCHECK working
- Forcing `OM_METADATA_BACKEND=postgres` — that decision happens in the task definition Terraform, not in product code defaults
- `tools/ops/compose_with_doppler.sh` — no changes needed; it just wraps `docker compose`
- Python SDK — out of scope (server is Node-only)
