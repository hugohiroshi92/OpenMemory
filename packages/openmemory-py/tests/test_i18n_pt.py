"""PT language pack tests — mirrors packages/openmemory-js/tests/i18n_pt.test.ts.

Does not depend on spaCy being installed; the stemmer falls back to a no-op.
"""

from openmemory.i18n import get_lang_pack, PT_PACK, EN_PACK


SECTORS = ["episodic", "semantic", "procedural", "emotional", "reflective"]


def _classify(pack, content: str) -> str:
    scores = {s: 0 for s in SECTORS}
    for sector in SECTORS:
        for pattern in getattr(pack.sector_patterns, sector):
            matches = pattern.findall(content)
            scores[sector] += len(matches)
    top = max(scores.items(), key=lambda kv: kv[1])
    return top[0] if top[1] > 0 else "semantic"


def _has_temporal(pack, text: str) -> bool:
    return any(p.search(text) for p in pack.temporal_patterns)


# ---------- registry ----------

def test_registry_resolves_pt():
    assert get_lang_pack("pt").lang == "pt"


def test_registry_falls_back_to_en_for_unknown():
    assert get_lang_pack("xx").lang == "en"


# ---------- sector classification ----------

def test_classifies_episodic_pt():
    assert _classify(PT_PACK, "fui ao mercado ontem à tarde") == "episodic"
    assert _classify(PT_PACK, "lembra quando viajamos juntos?") == "episodic"


def test_classifies_procedural_pt():
    assert _classify(PT_PACK, "como fazer uma boa anamnese passo a passo") == "procedural"


def test_classifies_emotional_pt():
    assert _classify(PT_PACK, "sinto que estou ansioso e estressado") == "emotional"


def test_classifies_semantic_pt():
    assert (
        _classify(PT_PACK, "a hipertensão é uma condição cardiovascular crônica")
        == "semantic"
    )


def test_classifies_reflective_pt():
    assert _classify(PT_PACK, "percebi um padrão na evolução dos pacientes") == "reflective"


# ---------- temporal markers ----------

def test_temporal_relative_pt():
    assert _has_temporal(PT_PACK, "paciente apresenta sintomas há 3 dias")
    assert _has_temporal(PT_PACK, "evolução de faz 2 semanas")
    assert _has_temporal(PT_PACK, "consulta agendada para amanhã")


def test_temporal_absolute_pt():
    assert _has_temporal(PT_PACK, "exame realizado em janeiro 15")
    assert _has_temporal(PT_PACK, "alta hospitalar em 2026-04-12")


def test_temporal_negative_pt():
    assert not _has_temporal(PT_PACK, "diagnóstico de hipertensão arterial")


# ---------- synonyms ----------

def test_synonyms_dark_group_pt():
    group = next((g for g in PT_PACK.synonym_groups if "escuro" in g), None)
    assert group is not None
    assert "noite" in group
    assert "preto" in group


def test_synonyms_patient_group_pt():
    group = next((g for g in PT_PACK.synonym_groups if "paciente" in g), None)
    assert group is not None
    assert "usuário" in group


# ---------- stemmer ----------

def test_pt_stemmer_should_always_attempt():
    # should_stem is always True; the stem function itself decides the fallback
    # path (spaCy lemma when available, raw token otherwise).
    assert PT_PACK.should_stem("hipertensão") is True


def test_pt_stemmer_does_not_crash_on_medical_terms():
    # Either lemma or raw — must return a non-empty string and not raise.
    result = PT_PACK.stem("hipertensão")
    assert isinstance(result, str)
    assert len(result) > 0
