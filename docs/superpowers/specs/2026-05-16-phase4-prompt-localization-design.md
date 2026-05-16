# Phase 4 — Prompt localization (minimal scope)

**Date:** 2026-05-16
**Branch:** `feat/i18n-multilingual`
**Author:** brainstormed with the user (Brazilian doctor building a medical memory engine)

## Context

Phases 1–3 of the i18n initiative localized OpenMemory's regex-based classifier and synonym layer for Portuguese with a `pt-health` domain overlay. Audit of remaining English-language surfaces (read-only inspection by the Explore subagent) found that:

- `reflect.ts` / `reflect.py` and `user_summary.ts` / `user_summary.py` are **fully algorithmic** (clustering and metadata extraction). They do not send prompts to LLMs. No localization needed.
- MCP tool descriptions in `packages/openmemory-js/src/ai/mcp.ts` (7 tools) and `packages/openmemory-py/src/openmemory/ai/mcp.py` (~6 tools) contain ~70 short English description strings consumed by client LLMs for tool routing. The user chose to leave these in English — LLMs handle EN tool descriptions well and the user-facing impact is small.
- `packages/openmemory-py/src/openmemory/openai_handler.py` injects a hard-coded English context prefix `"relevant context from memory:"` into chat completions at lines 34 and 69. This single string leaks into every LLM call routed through the Python OpenAI handler. The JS SDK has no equivalent handler.

## Scope

Localize the single string `"relevant context from memory:"` in `openai_handler.py` so that PT users receive a Portuguese prefix in their LLM context. Everything else is out of scope for this phase.

## Non-goals

- **MCP tool descriptions** (Py and JS) — left in English. The user accepted this trade-off; revisit only if a concrete UX regression appears.
- **reflect / user_summary localization** — these are not LLM-driven and do not need prompt work.
- **JS-side changes** — no equivalent handler exists.
- **Building a generic `contextPrefixes` field on the LangPack** — a single string does not justify the abstraction. If the family of strings grows, revisit and lift to LangPack.

## Design

Introduce a small module-level dictionary in `openai_handler.py` and replace the two hard-coded occurrences with a `dict.get(...)` lookup keyed by `env.lang`.

```python
# packages/openmemory-py/src/openmemory/openai_handler.py

# Add to imports (env is not currently imported in this file):
from .core.config import env

# Module-level constants, defined once after imports and before the class:
_CONTEXT_PREFIX = {
    "pt": "Contexto relevante da memória:",
    "en": "Relevant context from memory:",
}

def _ctx_prefix() -> str:
    return _CONTEXT_PREFIX.get(env.lang, _CONTEXT_PREFIX["en"])
```

At both call sites (lines 34 and 69 of the current file), replace the literal
`"relevant context from memory:"` inside the f-string with `{_ctx_prefix()}`.
Both call sites must use the helper — do not inline the dict lookup, so the
two sites stay coupled to a single source of truth.

### Why this shape

- **Dictionary, not if/elif chain:** trivially extensible to `es`, `fr`, etc. without editing branching logic. Future contributors add one row.
- **Helper function over inline dict access:** clearer intent at the call site and makes the lookup mockable in tests without monkey-patching the dict directly.
- **Explicit `en` fallback:** `dict.get(env.lang, _CONTEXT_PREFIX["en"])` means an unknown `env.lang` value (e.g. `OM_LANG=es` before we add an `es` entry) silently falls back to English instead of raising — preserves existing behavior.
- **Module-level constant:** the dictionary is immutable for the lifetime of the process; no point reconstructing on each call.

### Translation

- Original: `"relevant context from memory:"` (lowercase, trailing colon)
- PT: `"Contexto relevante da memória:"`
  - Capitalized initial — PT-BR convention is to capitalize the opening of a labeled context section, even when the EN original uses lowercase. This matches the register the user (a Brazilian doctor) expects in clinical text.
  - Direct, register-neutral translation. No idiomatic substitution needed.

### Testing

Add `packages/openmemory-py/tests/test_i18n_context_prefix.py` with three cases:

1. `env.lang = "pt"` → returns `"Contexto relevante da memória:"`
2. `env.lang = "en"` → returns `"Relevant context from memory:"`
3. `env.lang = "es"` (or any unknown value) → returns the EN fallback `"Relevant context from memory:"`

Test strategy: monkey-patch `env.lang` via `monkeypatch.setattr` (pytest fixture) since `env` is a module singleton built at import. Avoid hitting the real OpenAI API — the test only validates the prefix lookup, not the chat completion flow.

The test must not interfere with the existing omnibus or `test_i18n_*` suites — `monkeypatch` auto-reverts between tests.

## Risk

Minimal. Worst case is the lookup falls back to English (current behavior). The two call sites in `openai_handler.py` are guarded by the same lookup, so they cannot drift apart.

## Verification before completion

1. `python -m pytest tests/test_i18n_context_prefix.py -v` passes (3 tests)
2. `python -m pytest tests/test_omnibus.py tests/test_i18n_pt.py tests/test_i18n_pt_health.py -v` still passes (31 tests, no regression)
3. JS suite untouched: `npm test` still passes (54 tests)

## Out-of-scope follow-ups (not in this phase)

- If MCP descriptions become a UX problem, revisit and consider a `mcpToolDescriptions` field on the LangPack with per-tool translation maps.
- If the family of UI/handler strings grows beyond ~3, lift them into a single `contextStrings` dictionary on the LangPack to keep them co-located with the rest of the i18n surface.
- Mirror the prefix in JS only if a JS-side `openai_handler` equivalent is ever introduced.
