"""Compose a domain overlay onto a base LangPack (e.g. pt + health → pt-health)."""

import re
from typing import Optional, Pattern

from .types import ImportanceScoring, LangPack, SectorPatternBundle
from .domains.health import HealthOverlay


def _merge_regex(a: Pattern, b: Optional[Pattern]) -> Pattern:
    if b is None:
        return a
    # Preserve base flags; overlay regex are written with compatible flags.
    return re.compile(f"{a.pattern}|{b.pattern}", a.flags)


def _merge_importance(
    base: ImportanceScoring,
    overlay: HealthOverlay,
) -> ImportanceScoring:
    return ImportanceScoring(
        action_verbs=_merge_regex(base.action_verbs, overlay.importance.action_verbs),
        wh=base.wh,
        self_refs=base.self_refs,
        months=base.months,
        units=_merge_regex(base.units, overlay.importance.units),
    )


def compose_pack(
    base: LangPack,
    overlay: HealthOverlay,
    lang: str,
    domain: str,
) -> LangPack:
    sectors = ["episodic", "semantic", "procedural", "emotional", "reflective"]
    merged_sector_patterns = SectorPatternBundle(
        **{
            s: [
                *getattr(base.sector_patterns, s),
                *overlay.sector_patterns.get(s, []),
            ]
            for s in sectors
        }
    )

    return LangPack(
        lang=lang,
        domain=domain,
        sector_patterns=merged_sector_patterns,
        temporal_patterns=[*base.temporal_patterns, *overlay.temporal_patterns],
        importance=_merge_importance(base.importance, overlay),
        synonym_groups=[*base.synonym_groups, *overlay.synonym_groups],
        stem=base.stem,
        should_stem=base.should_stem,
    )
