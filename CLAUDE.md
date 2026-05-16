# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is a **monorepo with two parallel SDK implementations** (TypeScript and Python) of the same cognitive memory engine. The two SDKs are intentionally kept in parity — changes to one usually need the other.

- `packages/openmemory-js/` — TS/Node SDK + REST API server + MCP server + `opm` CLI (port 8080)
- `packages/openmemory-py/` — Python SDK + FastAPI server, mirrors the JS architecture
- `dashboard/` — Next.js web UI, talks to the API over `NEXT_PUBLIC_API_URL`
- `apps/vscode-extension/` — VS Code extension client
- `tools/migrate/` — Mem0/Zep/Supermemory importer (Python, `python -m migrate ...`)
- `tools/ops/` — benchmarking, health viz, and `compose_with_doppler.sh` (Doppler-managed docker compose)
- `examples/`, `docs/`, `ARCHITECTURE.md`, `Why.md` — reference material

> **The root `Makefile` is stale.** It references `backend/`, `sdk-js/`, `sdk-py/` directories that no longer exist (they were renamed to `packages/openmemory-{js,py}`). Do not use `make` targets — use the package-specific commands below. The CI workflow (`.github/workflows/ci.yml`) and `CONTRIBUTING.md` have the correct paths.

## Common commands

### Node/TS SDK + server (`packages/openmemory-js/`)

```bash
cd packages/openmemory-js
npm install
npm run dev              # nodemon + tsx, watches src/, runs src/server/index.ts on :8080
npm run build            # tsc -p tsconfig.json → dist/
npm start                # node dist/server/index.js (after build)
npm run format           # prettier on src/ and test/
npm run migrate          # tsx src/core/migrate.ts (DB schema migration)
npm run typecheck        # tsc --noEmit
npm test                 # vitest run — full suite
npm run test:watch       # vitest in watch mode
npm run test:coverage    # vitest run --coverage
npx vitest run tests/<file>.test.ts            # single file
npx vitest run -t "test name pattern"          # single test by name
npm link                 # exposes the `opm` CLI globally (after build)
```

There is no `npm run lint` script in this package (no ESLint config). Test suites live in `tests/` as `*.test.ts` (vitest discovers them via `vitest.config.ts`); snapshots under `tests/__snapshots__/`. The old `test_omnibus.ts` runner was deleted in favor of vitest — files like `omnibus.test.ts`, `verify.test.ts`, `webhook.test.ts`, `temporal_per_tenant.test.ts`, `multilingual_dedup.test.ts` are the canonical specs.

### Python SDK + server (`packages/openmemory-py/`)

```bash
cd packages/openmemory-py
pip install -e .                 # or `pip install -e .[dev]` if a dev extra exists
python -m pytest tests/test_omnibus.py -v   # canonical test
python -m pytest tests/test_omnibus.py::test_name   # single test
```

CI installs `pytest pytest-asyncio python-dotenv pyyaml` explicitly on top of `pip install -e .[dev]` — replicate that if `pip install -e .[dev]` alone fails locally.

### Dashboard (`dashboard/`)

```bash
cd dashboard
npm install
npm run dev              # next dev on :3000
npm run build            # next build
npm run lint             # eslint .
```

### Docker

```bash
docker compose up --build -d                       # API + MCP only
docker compose --profile ui up --build -d          # adds the dashboard service
tools/ops/compose_with_doppler.sh up -d --build    # Doppler-managed env
docker compose ps && curl -f http://localhost:8080/health
```

The compose file builds from `./packages/openmemory-js` (the JS server is the canonical backend image; the Python SDK is consumed in-process by Python apps, not as a separate server image).

## Architecture — the parts that span files

The engine implements **Hierarchical Sector Graph (HSG) v2** (older docs call it HMD). The shape is the same in TS and Python; mirror-edits are expected.

### Five cognitive sectors

Every memory is classified into a **primary sector** (plus optional additional sectors). Each sector has its own decay rate and scoring weight — they are not just labels.

| Sector       | Decay λ | Weight | Examples                       |
| ------------ | ------- | ------ | ------------------------------ |
| `episodic`   | 0.015   | 1.2    | events, “today/yesterday”      |
| `semantic`   | 0.005   | 1.0    | facts, definitions             |
| `procedural` | 0.008   | 1.1    | how-to, step-by-step           |
| `emotional`  | 0.020   | 1.3    | feelings (decays fastest)      |
| `reflective` | 0.001   | 0.8    | meta-insights (decays slowest) |

Sector classification lives near the top of the memory engine (see `src/memory/hsg.ts` / its Python twin). It's currently regex-pattern based; the roadmap calls for a learned classifier.

### Single-waypoint associative graph

Each memory has **at most one outgoing waypoint** — the single strongest associative link (cosine ≥ 0.75 on mean vectors). On add, the engine searches for the best match and links bidirectionally if cross-sector. On query, waypoint expansion does a 1-hop traversal and reinforces traversed edges (+0.05, capped at 1.0). Background pruning every 7 days drops weights < 0.05.

This is the key thing that makes OpenMemory **not** a vector DB. If you find yourself adding multi-edge graph traversal, that's a design departure — check with the architecture docs first.

### Composite retrieval score

```
score = 0.6 * cosine_similarity
      + 0.2 * salience
      + 0.1 * recency
      + 0.1 * waypoint_strength
```

`salience` is a 0–1 importance score that **decays exponentially** per sector λ and is **reinforced on recall** (+0.1). `last_seen_at` drives both decay and recency. Decay runs as a background task every 24 hours; do not call it inline from request handlers.

### Add and query flows (the part that touches every layer)

**Add:** classify → `embedMultiSector()` produces one vector per sector → compute mean vector → transactional insert into `memories` + `vectors` → `createSingleWaypoint()` finds best match and inserts into `waypoints` → commit.

**Query:** classify query → embed only for candidate sectors → cosine search per sector → merge top-K → `expandViaWaypoints()` for 1-hop neighbors → composite score → return top-K → reinforce (boost salience, strengthen traversed waypoints, update `last_seen_at`).

When changing either flow, expect to touch: the engine (`memory/hsg.ts`), embeddings (`memory/embed.ts`), DB (`core/db.ts` and the vector backend in `core/vector/`), and the route handlers (`server/routes/memory.ts`).

### Pluggable embeddings

Provider selected via `OM_EMBEDDINGS` (`openai | gemini | aws | ollama | local | synthetic | minimax`). `synthetic` is the hash-based fallback used in CI (`OM_VEC_DIM=1536` in CI for the Node tests). Gemini uses `gemini-embedding-001` (the older `text-embedding-004`/`embedding-001` IDs are deprecated). Two modes:

- `simple` (default): one batch call per memory, all sectors at once.
- `advanced`: per-sector model selection, optional parallel embedding, chunking for long text.

If you add a provider, wire it into both `packages/openmemory-js/src/memory/embed.ts` and the Python equivalent — parity is enforced by the omnibus test.

### Pluggable vector + metadata backends

Metadata: SQLite (default) or Postgres (`OM_METADATA_BACKEND`).
Vectors: SQLite, Postgres, Valkey, Weaviate, or **S3 Vectors** (`OM_VECTOR_BACKEND=s3`). Implementations under `src/core/vector/` (JS) and `src/openmemory/core/vector/` (Py).

**S3 Vectors is the active backend for this fork.** Configure with:
- `OPENMEMORY_S3_BUCKET` (required)
- `OPENMEMORY_S3_INDEX_NAME` (default `om-vectors`)
- AWS credentials via standard env (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`/`AWS_REGION`) or ambient IAM role.

The JS `S3VectorStore.storeVector` and `searchSimilar` propagate `user_id` and `project_id` into S3 Vectors metadata; post-filtering by sector/tenant happens client-side after over-fetching (`topK * 5`). The Py interface does not yet have `project_id` (it lags the JS PR #171) — keep that in mind when porting.

### Internationalization (i18n / language packs)

Memory classification, temporal detection, stemming, and synonym lookup are all driven by **language packs** at `src/i18n/` (JS) and `src/openmemory/i18n/` (Py). Packs ship for `en` (default) and `pt`; resolution is `getLangPack(env.lang, env.domain)` / `get_lang_pack(env.lang, env.domain)`.

Configure per instance:
- `OM_LANG=pt` (default `en`)
- `OM_DOMAIN=health` (optional overlay; not yet implemented — Fase 3)

**Important divergences between JS and Py packs:**

| Aspect | JS pack | Py pack |
|---|---|---|
| Stemmer for `pt` | **No-op** — preserves medical terms (`hipertensão`, `pneumonia`, suffixes `-ite/-ose/-emia`). JS has no maintained Snowball-PT we trust for this domain. | **spaCy lemmatization** via `pt_core_news_sm` (lazy load, lru-cached). Falls back to no-op if spaCy/model not installed. |
| Word-boundary regex | Uses `(?<![\p{L}\d_])…(?![\p{L}\d_])` with `iu` flags — `\b` is ASCII-only in JS and fails after accented characters (e.g. `\b…\b` on "amanhã"). | Uses `\b` directly — Python's `re` is Unicode-aware by default. |

To install the Py PT stemmer locally:
```bash
cd packages/openmemory-py
pip install -e .[pt]
python -m spacy download pt_core_news_sm
```
Skipping that install is supported — `stem_pt()` returns the raw token and a single log line warns at first use.

**Adding a new language pack**: drop `langs/<lang>.{ts,py}` mirroring the EN one, register it in `i18n/index.ts` / `i18n/__init__.py`. The 5-sector pattern bundle, temporal patterns, importance regex, and synonym groups must all be present. Test scaffolding: copy `tests/i18n_pt.test.ts` / `tests/test_i18n_pt.py`.

**Domain overlays** (`OM_DOMAIN=health`): a domain adds patterns/synonyms *on top of* a base language pack. The composed pack is registered under the key `<lang>-<domain>` (e.g. `pt-health`). `getLangPack("pt", "health")` returns the composed pack; `getLangPack("pt", "unknown")` falls back to base `pt`.

The current `health` overlay covers PT-BR clinical content: symptoms (cefaleia, febre, tosse), diagnoses (HAS, DM, AVC, IAM), prescriptions (`Nmg VO Nx/dia`), vital signs (`PA 120/80`, `FC 88`, `SatO2 95`), clinical temporal markers (`há N dias`, `evolução de`, `agudo|crônico`), and ~18 medical synonym groups (hipertensão↔HAS↔pressão alta, AVC↔derrame, etc).

**Adding a new domain overlay** (e.g. `legal`, `finance`):
1. Create `i18n/domains/<domain>.{ts,py}` with `sectorPatterns`, `temporalPatterns`, `importance` (optional `actionVerbs`/`units`), and `synonymGroups` — all additions, not replacements
2. In `i18n/index.ts` / `__init__.py`, call `compose_pack(base, overlay, lang, domain)` and add to the `_packs` registry under `<lang>-<domain>`
3. The `compose_pack` helper concatenates pattern arrays, OR-merges importance regex via `new RegExp(`${a.source}|${b.source}`, a.flags)`, and concatenates synonym groups

**DeCS (Descritores em Ciências da Saúde)** integration is **deferred** — the current health overlay uses ~50 manually-curated patterns. The full DeCS vocabulary (~35k trilingual terms) is the planned upgrade path but not yet implemented.

### JS↔Py classification scoring divergence (known)

The two SDKs count regex matches slightly differently for sector scoring:
- **JS** uses `content.match(pattern)` (no `/g` flag) → returns first match + capture groups → `matches.length` ≈ 1 per regex
- **Py** uses `pattern.findall(content)` → returns *all* matches → counts every occurrence

For most content the dominant sector agrees across SDKs. For texts with multiple keyword hits in the same regex (e.g. "paciente apresenta tontura e vertigem" has 2 semantic hits), Py and JS may rank sectors differently. The omnibus tests and the existing classifier snapshot pin behavior per-SDK; cross-SDK parity at the *first-place sector* level is the target, not numeric score equality.

### Multi-tenant identity (JS)

The Node server pulls a tenant identity via `src/server/middleware/tenant.ts` and attaches it to `req.tenant` (so route handlers don't read raw headers). Inputs are validated by `middleware/validate.ts`; source webhooks are HMAC-verified by `middleware/webhook.ts`. SQL identifiers are validated in `core/identifiers.ts` (any new dynamic table/column name must go through `assertSafeIdentifier`); PG TLS is resolved by `core/pg_ssl.ts`. `DbInitError` is fatal — the server exits on init failure rather than running degraded.

**Project isolation (JS only, PR #171):** memories carry a `project_id` alongside `user_id`. Project-scoped queries get a +0.2 boost over global memories at scoring time, and there's a dedicated MCP tool for project-specific operations. The Python SDK has not picked this up yet.

### LangGraph mode (`OM_MODE=langgraph`)

Switches the server to expose `/lgm/store`, `/lgm/retrieve`, `/lgm/context`, `/lgm/reflection` with node-to-sector mapping (`observe→episodic`, `plan→semantic`, `reflect→reflective`, `act→procedural`, `emotion→emotional`). Standard `/memory/*` routes still work. Implementation: `src/ai/graph.ts` + `src/server/routes/langgraph.ts`.

### MCP server

The server mounts an MCP endpoint at `/mcp` (HTTP transport). Tool definitions live in `src/ai/mcp_tools.ts` and the MCP plumbing in `src/ai/mcp.ts`. Adding a tool means: define it in `mcp_tools.ts`, ensure the underlying memory op exists, and the route auto-picks it up.

### Test strategy

The JS side migrated from a single `test_omnibus.ts` runner to **Vitest**. Specs live in `packages/openmemory-js/tests/` as `*.test.ts` and run under the synthetic embedding provider. Key specs: `omnibus.test.ts` (end-to-end parity check), `verify.test.ts` (with `__snapshots__/`), `webhook.test.ts` (HMAC verifier behavior), `temporal_per_tenant.test.ts` (tenant scoping), `multilingual_dedup.test.ts` (CJK tokenization).

The Python side still uses a single `tests/test_omnibus.py` as the canonical parity check. Both omnibus equivalents cover add/query/reinforce/decay/waypoint flows end-to-end and must stay green.

> **CI is currently broken on the Node side.** `.github/workflows/ci.yml` still runs `npx tsx tests/test_omnibus.ts`, but that file was deleted during the Phase-4 hardening migration to vitest. The replacement spec is `tests/omnibus.test.ts` — when fixing CI, swap the step to `npm test` (or `npx vitest run tests/omnibus.test.ts`). The Python job (`python -m pytest tests/test_omnibus.py -v`) is still correct.

## Conventions

- **TypeScript:** 2-space indent, semicolons, Prettier (`npm run format`). No ESLint config in the SDK package (the dashboard has its own).
- **Python:** PEP 8, type hints on public functions, docstrings on modules/classes/functions. Black is mentioned in CONTRIBUTING but not wired into CI.
- **Commits:** conventional commits (`feat(scope): …`, `fix(scope): …`, `docs(scope): …`). Scopes seen in history: `ci`, `embedding`, `database`, `api`, etc.
- **Parity:** behavior-affecting changes to one SDK should be mirrored in the other before merge.
