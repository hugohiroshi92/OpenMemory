from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Pattern


@dataclass
class SectorPatternBundle:
    episodic: List[Pattern]
    semantic: List[Pattern]
    procedural: List[Pattern]
    emotional: List[Pattern]
    reflective: List[Pattern]


@dataclass
class ImportanceScoring:
    action_verbs: Pattern
    wh: Pattern
    self_refs: Pattern
    months: Pattern
    units: Pattern


@dataclass
class LangPack:
    lang: str
    domain: Optional[str]
    sector_patterns: SectorPatternBundle
    temporal_patterns: List[Pattern]
    importance: ImportanceScoring
    synonym_groups: List[List[str]]
    stem: Callable[[str], str]
    should_stem: Callable[[str], bool]
