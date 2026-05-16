from typing import Dict, List, TypedDict, Pattern

from .config import env
from ..i18n import get_lang_pack


class SectorCfg(TypedDict):
    model: str
    decay_lambda: float
    weight: float
    patterns: List[Pattern]


_LANG_PACK = get_lang_pack(env.lang, env.domain)

_SECTOR_META: Dict[str, Dict] = {
    "episodic": {"model": "episodic-optimized", "decay_lambda": 0.015, "weight": 1.2},
    "semantic": {"model": "semantic-optimized", "decay_lambda": 0.005, "weight": 1.0},
    "procedural": {"model": "procedural-optimized", "decay_lambda": 0.008, "weight": 1.1},
    "emotional": {"model": "emotional-optimized", "decay_lambda": 0.02, "weight": 1.3},
    "reflective": {"model": "reflective-optimized", "decay_lambda": 0.001, "weight": 0.8},
}


SECTOR_CONFIGS: Dict[str, SectorCfg] = {
    name: {
        **meta,
        "patterns": getattr(_LANG_PACK.sector_patterns, name),
    }
    for name, meta in _SECTOR_META.items()
}

SEC_WTS = {k: v["weight"] for k, v in SECTOR_CONFIGS.items()}
