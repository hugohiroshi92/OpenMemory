from typing import Dict, Optional

from .types import LangPack
from .langs.en import EN_PACK
from .langs.pt import PT_PACK
from .compose import compose_pack
from .domains.health import HEALTH_PT_OVERLAY


PT_HEALTH_PACK = compose_pack(PT_PACK, HEALTH_PT_OVERLAY, "pt", "health")


_packs: Dict[str, LangPack] = {
    "en": EN_PACK,
    "pt": PT_PACK,
    "pt-health": PT_HEALTH_PACK,
}


def register_lang_pack(pack: LangPack) -> None:
    key = f"{pack.lang}-{pack.domain}" if pack.domain else pack.lang
    _packs[key] = pack


def get_lang_pack(lang: Optional[str] = None, domain: Optional[str] = None) -> LangPack:
    l = (lang or "en").lower()
    d = domain.lower() if domain else None
    if d:
        composed = _packs.get(f"{l}-{d}")
        if composed:
            return composed
    return _packs.get(l, _packs["en"])


__all__ = [
    "LangPack",
    "EN_PACK",
    "PT_PACK",
    "PT_HEALTH_PACK",
    "compose_pack",
    "register_lang_pack",
    "get_lang_pack",
]
