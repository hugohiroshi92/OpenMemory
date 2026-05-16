"""PT-health overlay tests — mirrors packages/openmemory-js/tests/i18n_pt_health.test.ts."""

from openmemory.i18n import get_lang_pack, PT_PACK, PT_HEALTH_PACK


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

def test_registry_resolves_pt_health():
    pack = get_lang_pack("pt", "health")
    assert pack.lang == "pt"
    assert pack.domain == "health"


def test_registry_unknown_domain_falls_back_to_pt():
    pack = get_lang_pack("pt", "legal")
    assert pack.lang == "pt"
    assert pack.domain is None


def test_registry_unknown_both_falls_back_to_en():
    assert get_lang_pack("xx", "yy").lang == "en"


# ---------- clinical classification ----------

def test_symptoms_are_semantic():
    assert _classify(PT_HEALTH_PACK, "paciente com cefaleia e febre há 3 dias") == "semantic"
    assert _classify(PT_HEALTH_PACK, "queixa principal: dor no peito e dispneia") == "semantic"


def test_diagnoses_are_semantic():
    assert _classify(PT_HEALTH_PACK, "paciente é portador de hipertensão arterial sistêmica") == "semantic"
    assert _classify(PT_HEALTH_PACK, "DM tipo 2 descompensado, HbA1c 9.5") == "semantic"


def test_prescriptions_are_procedural():
    assert _classify(PT_HEALTH_PACK, "prescrevi losartana 50mg VO 1x/dia para hipertensão") == "procedural"
    assert _classify(PT_HEALTH_PACK, "administrar dipirona 500mg de 6/6h via oral") == "procedural"


def test_patient_encounters_are_episodic():
    # Two episodic markers: "consulta de retorno" + "HDA". No competing
    # symptom keywords, so this is unambiguous across both SDKs.
    assert _classify(PT_HEALTH_PACK, "consulta de retorno: HDA inalterada") == "episodic"
    # "paciente apresenta" + "HMA" — pure episodic markers.
    assert _classify(PT_HEALTH_PACK, "paciente apresenta HMA inalterada hoje") == "episodic"


def test_patient_apresenta_pattern_matches():
    # Verify the episodic pattern fires for "paciente apresenta", independent
    # of dominant-sector outcome (which depends on competing keywords).
    episodic_match = any(
        p.search("paciente apresenta sintomas")
        for p in PT_HEALTH_PACK.sector_patterns.episodic
    )
    assert episodic_match


# ---------- clinical temporal markers ----------

def test_evolution_markers():
    assert _has_temporal(PT_HEALTH_PACK, "quadro com evolução de 2 semanas")
    assert _has_temporal(PT_HEALTH_PACK, "sintoma agudo, iniciou há 24 horas")
    assert _has_temporal(PT_HEALTH_PACK, "condição crônica preexistente")


def test_base_pt_temporal_markers_still_work():
    assert _has_temporal(PT_HEALTH_PACK, "consulta agendada para amanhã")
    assert _has_temporal(PT_HEALTH_PACK, "exame em 2026-04-12")


# ---------- medical synonyms ----------

def test_hipertensao_group():
    group = next((g for g in PT_HEALTH_PACK.synonym_groups if "hipertensão" in g), None)
    assert group is not None
    assert "has" in group
    assert "pressão alta" in group


def test_avc_group():
    group = next((g for g in PT_HEALTH_PACK.synonym_groups if "avc" in g), None)
    assert group is not None
    assert "derrame" in group


def test_base_pt_synonyms_preserved():
    group = next((g for g in PT_HEALTH_PACK.synonym_groups if "escuro" in g), None)
    assert group is not None
    assert "noite" in group


# ---------- regression: base pt still works ----------

def test_base_pt_pack_unchanged():
    def classify_base(content: str) -> str:
        scores = {s: 0 for s in SECTORS}
        for sector in SECTORS:
            for pattern in getattr(PT_PACK.sector_patterns, sector):
                scores[sector] += len(pattern.findall(content))
        top = max(scores.items(), key=lambda kv: kv[1])
        return top[0] if top[1] > 0 else "semantic"

    assert classify_base("fui ao mercado ontem") == "episodic"
    assert classify_base("sinto que estou ansioso") == "emotional"
