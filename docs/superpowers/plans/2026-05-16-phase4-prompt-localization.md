# Phase 4 — Prompt Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Localize the hard-coded English context prefix `"relevant context from memory:"` injected into LLM chat completions by the Python `openai_handler.py`, so users with `OM_LANG=pt` receive a Portuguese label instead.

**Architecture:** Add a module-level `_CONTEXT_PREFIX` dict and a `_ctx_prefix()` helper to `openai_handler.py`. The helper reads `env.lang` (already populated from `OM_LANG`) and returns the appropriate string with an English fallback. Both call sites in the file (lines 34 and 69) use the helper, so the two stay coupled to a single source of truth. No changes to the JS SDK, MCP descriptions, reflect, or user_summary.

**Tech Stack:** Python 3.12, pytest 9, pytest's `monkeypatch` fixture for testing.

**Spec:** `docs/superpowers/specs/2026-05-16-phase4-prompt-localization-design.md`

**Branch:** `feat/i18n-multilingual` on the fork `hugohiroshi92/OpenMemory`.

---

## File Structure

- **Modify:** `packages/openmemory-py/src/openmemory/openai_handler.py`
  - Add `from .core.config import env` to imports (currently absent)
  - Add module-level `_CONTEXT_PREFIX` dict and `_ctx_prefix()` helper (between imports and the `OpenAIRegistrar` class)
  - Replace literal `"relevant context from memory:"` inside f-strings on lines 34 and 69 with `{_ctx_prefix()}`
- **Create:** `packages/openmemory-py/tests/test_i18n_context_prefix.py`
  - 3 test cases (pt, en, unknown fallback)
  - Uses `monkeypatch.setattr` on `env.lang` — no real OpenAI calls

The file is small and focused. No restructuring needed.

---

## Task 1: Add the localization helper with TDD

**Files:**
- Create: `packages/openmemory-py/tests/test_i18n_context_prefix.py`
- Modify: `packages/openmemory-py/src/openmemory/openai_handler.py` (imports + new helper)

- [ ] **Step 1: Write the failing test**

Create `packages/openmemory-py/tests/test_i18n_context_prefix.py` with this content:

```python
"""Phase 4: context prefix localization tests.

Validates the `_ctx_prefix()` helper in `openai_handler.py` returns the right
string based on `env.lang`, with an English fallback for unknown values.
"""

import pytest

from openmemory import openai_handler
from openmemory.core import config as cfg_mod


def test_ctx_prefix_returns_pt_for_pt_lang(monkeypatch):
    monkeypatch.setattr(cfg_mod.env, "lang", "pt")
    assert openai_handler._ctx_prefix() == "Contexto relevante da memória:"


def test_ctx_prefix_returns_en_for_en_lang(monkeypatch):
    monkeypatch.setattr(cfg_mod.env, "lang", "en")
    assert openai_handler._ctx_prefix() == "Relevant context from memory:"


def test_ctx_prefix_falls_back_to_en_for_unknown_lang(monkeypatch):
    monkeypatch.setattr(cfg_mod.env, "lang", "es")
    assert openai_handler._ctx_prefix() == "Relevant context from memory:"
```

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
cd /home/hhiroshi92/github/OpenMemory/packages/openmemory-py
.venv/bin/python -m pytest tests/test_i18n_context_prefix.py -v
```

Expected: 3 FAILED with `AttributeError: module 'openmemory.openai_handler' has no attribute '_ctx_prefix'`.

- [ ] **Step 3: Add the import and helper to `openai_handler.py`**

Open `packages/openmemory-py/src/openmemory/openai_handler.py`. The current first 7 lines are:

```python
from typing import Any, List, Dict, Optional, Union
import logging
import asyncio
import json

logger = logging.getLogger("openmemory.client")
```

Replace those lines with:

```python
from typing import Any, List, Dict, Optional, Union
import logging
import asyncio
import json

from .core.config import env

logger = logging.getLogger("openmemory.client")

_CONTEXT_PREFIX = {
    "pt": "Contexto relevante da memória:",
    "en": "Relevant context from memory:",
}


def _ctx_prefix() -> str:
    """Return the localized context prefix label based on `env.lang`.

    Falls back to English for any `env.lang` value not in `_CONTEXT_PREFIX`.
    """
    return _CONTEXT_PREFIX.get(env.lang, _CONTEXT_PREFIX["en"])
```

- [ ] **Step 4: Run the test, verify it passes**

Run:
```bash
cd /home/hhiroshi92/github/OpenMemory/packages/openmemory-py
.venv/bin/python -m pytest tests/test_i18n_context_prefix.py -v
```

Expected: `3 passed`.

---

## Task 2: Wire the helper into both call sites

**Files:**
- Modify: `packages/openmemory-py/src/openmemory/openai_handler.py` (lines 34 and 69 of the current file)

- [ ] **Step 1: Replace the literal on line 34 (async branch)**

In `packages/openmemory-py/src/openmemory/openai_handler.py`, find the line (inside the `async def wrapped_create` branch):

```python
                                    instr = f"\n\nrelevant context from memory:\n{ctx_text}"
```

Replace it with:

```python
                                    instr = f"\n\n{_ctx_prefix()}\n{ctx_text}"
```

- [ ] **Step 2: Replace the literal on line 69 (sync branch)**

In the same file, find the second occurrence (inside the `def wrapped_create` sync branch):

```python
                                        instr = f"\n\nrelevant context from memory:\n{ctx_text}"
```

Replace it with:

```python
                                        instr = f"\n\n{_ctx_prefix()}\n{ctx_text}"
```

- [ ] **Step 3: Verify no hard-coded English remains in the file**

Run:
```bash
cd /home/hhiroshi92/github/OpenMemory
grep -n "relevant context from memory" packages/openmemory-py/src/openmemory/openai_handler.py
```

Expected: no output (zero matches in the source — the literal now lives only in `_CONTEXT_PREFIX["en"]` higher up).

Sanity check — confirm the helper is used at both call sites:
```bash
grep -n "_ctx_prefix" packages/openmemory-py/src/openmemory/openai_handler.py
```

Expected: 4 lines — 1 from the `def _ctx_prefix` definition, 1 from the docstring/return, and 2 from the f-strings on the (now updated) lines 34 and 69 area.

- [ ] **Step 4: Run the new test plus the full Py i18n + omnibus suite to verify no regression**

Run:
```bash
cd /home/hhiroshi92/github/OpenMemory/packages/openmemory-py
.venv/bin/python -m pytest tests/test_i18n_context_prefix.py tests/test_i18n_pt.py tests/test_i18n_pt_health.py tests/test_omnibus.py -v
```

Expected: `34 passed` (3 new + 14 pt + 14 pt-health + 3 omnibus).

---

## Task 3: Cross-SDK regression check + commit

**Files:**
- No file changes in this task; this is verification + commit.

- [ ] **Step 1: Verify the JS suite is untouched**

Run:
```bash
cd /home/hhiroshi92/github/OpenMemory/packages/openmemory-js
npm test
```

Expected: `Tests  54 passed (54)` — Phase 4 should not affect the JS SDK at all.

- [ ] **Step 2: Stage the Phase 4 changes**

From the repo root:
```bash
cd /home/hhiroshi92/github/OpenMemory
git add packages/openmemory-py/src/openmemory/openai_handler.py packages/openmemory-py/tests/test_i18n_context_prefix.py docs/superpowers/specs/2026-05-16-phase4-prompt-localization-design.md docs/superpowers/plans/2026-05-16-phase4-prompt-localization.md
```

- [ ] **Step 3: Commit atomically**

```bash
git commit -m "$(cat <<'EOF'
feat(i18n): localize chat-completion context prefix in openai_handler

Adds `_CONTEXT_PREFIX` dict + `_ctx_prefix()` helper to openai_handler.py
keyed by `env.lang` with an English fallback. Both injection sites (async
and sync `wrapped_create` branches) use the helper, so they stay coupled
to a single source of truth.

- pt: "Contexto relevante da memória:"
- en: "Relevant context from memory:"
- unknown lang: falls back to English

No JS changes (no equivalent handler). MCP tool descriptions intentionally
left in English — see spec for rationale.

Tests: 3 new cases via monkeypatch on env.lang; full 31-test Py suite
still green; 54-test JS suite untouched.

Spec: docs/superpowers/specs/2026-05-16-phase4-prompt-localization-design.md
Plan: docs/superpowers/plans/2026-05-16-phase4-prompt-localization.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Confirm clean status**

Run:
```bash
git status
git log --oneline -1
```

Expected: working tree shows all the other (pre-Phase-4) WIP files still uncommitted, and the most recent commit is the Phase 4 commit you just made.

---

## Self-review notes (already applied)

- **Spec coverage:** Every spec section maps to a task — translation table → Task 1 step 3; call-site replacement → Task 2; testing strategy → Task 1 step 1 + Task 2 step 4; verification → Task 2 step 4 + Task 3 step 1.
- **No placeholders:** All steps contain exact file paths, full code blocks, exact commands, and expected output.
- **Type consistency:** `_ctx_prefix()` name is used identically in the test file, the implementation, and both call sites. The dict key naming (`"pt"`, `"en"`) matches `env.lang` values produced by `cfg.py`.

---

## Out-of-scope reminder (do not implement)

- MCP tool descriptions localization (per spec non-goals)
- JS-side changes (no equivalent handler)
- reflect.py / user_summary.py changes (algorithmic, no prompts)
- Lifting `_CONTEXT_PREFIX` into the LangPack (deferred until more strings warrant it)
