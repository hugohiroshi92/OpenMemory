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


# TODO: integration test for `wrapped_create` injection.
# The unit tests above verify `_ctx_prefix()` in isolation. They do NOT verify
# that the localized prefix actually appears in `messages[0]["content"]` when
# `wrapped_create` runs. A future test should mock `memory.search` and
# `original_create` (no real OpenAI calls) and assert the assembled `instr`
# contains the expected prefix for `env.lang="pt"`.
