import re

from ..types import ImportanceScoring, LangPack, SectorPatternBundle
from ..stemmers.en import stem_en, should_stem_en


EN_PACK = LangPack(
    lang="en",
    domain=None,
    sector_patterns=SectorPatternBundle(
        episodic=[
            re.compile(r"\b(today|yesterday|tomorrow|last\s+(week|month|year)|next\s+(week|month|year))\b", re.I),
            re.compile(r"\b(remember\s+when|recall|that\s+time|when\s+I|I\s+was|we\s+were)\b", re.I),
            re.compile(r"\b(went|saw|met|felt|heard|visited|attended|participated)\b", re.I),
            re.compile(r"\b(at\s+\d{1,2}:\d{2}|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b", re.I),
            re.compile(r"\b(event|moment|experience|incident|occurrence|happened)\b", re.I),
            re.compile(r"\bI\s+'?m\s+going\s+to\b", re.I),
        ],
        semantic=[
            re.compile(r"\b(is\s+a|represents|means|stands\s+for|defined\s+as)\b", re.I),
            re.compile(r"\b(concept|theory|principle|law|hypothesis|theorem|axiom)\b", re.I),
            re.compile(r"\b(fact|statistic|data|evidence|proof|research|study|report)\b", re.I),
            re.compile(r"\b(capital|population|distance|weight|height|width|depth)\b", re.I),
            re.compile(r"\b(history|science|geography|math|physics|biology|chemistry)\b", re.I),
            re.compile(r"\b(know|understand|learn|read|write|speak)\b", re.I),
        ],
        procedural=[
            re.compile(r"\b(how\s+to|step\s+by\s+step|guide|tutorial|manual|instructions)\b", re.I),
            re.compile(r"\b(first|second|then|next|finally|afterwards|lastly)\b", re.I),
            re.compile(r"\b(install|run|execute|compile|build|deploy|configure|setup)\b", re.I),
            re.compile(r"\b(click|press|type|enter|select|drag|drop|scroll)\b", re.I),
            re.compile(r"\b(method|function|class|algorithm|routine|recipie)\b", re.I),
            re.compile(r"\b(to\s+do|to\s+make|to\s+build|to\s+create)\b", re.I),
        ],
        emotional=[
            re.compile(r"\b(feel|feeling|felt|emotions?|mood|vibe)\b", re.I),
            re.compile(r"\b(happy|sad|angry|mad|excited|scared|anxious|nervous|depressed)\b", re.I),
            re.compile(r"\b(love|hate|like|dislike|adore|detest|enjoy|loathe)\b", re.I),
            re.compile(r"\b(amazing|terrible|awesome|awful|wonderful|horrible|great|bad)\b", re.I),
            re.compile(r"\b(frustrated|confused|overwhelmed|stressed|relaxed|calm)\b", re.I),
            re.compile(r"\b(wow|omg|yay|nooo|ugh|sigh)\b", re.I),
            re.compile(r"[!]{2,}", re.I),
        ],
        reflective=[
            re.compile(r"\b(realize|realized|realization|insight|epiphany)\b", re.I),
            re.compile(r"\b(think|thought|thinking|ponder|contemplate|reflect)\b", re.I),
            re.compile(r"\b(understand|understood|understanding|grasp|comprehend)\b", re.I),
            re.compile(r"\b(pattern|trend|connection|link|relationship|correlation)\b", re.I),
            re.compile(r"\b(lesson|moral|takeaway|conclusion|summary|implication)\b", re.I),
            re.compile(r"\b(feedback|review|analysis|evaluation|assessment)\b", re.I),
            re.compile(r"\b(improve|grow|change|adapt|evolve)\b", re.I),
        ],
    ),
    temporal_patterns=[
        re.compile(r"\b(today|yesterday|tomorrow|this\s+week|last\s+week|this\s+morning)\b", re.I),
        re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
        re.compile(r"\b20\d{2}[/-]?(0[1-9]|1[0-2])[/-]?(0[1-9]|[12]\d|3[01])\b"),
        re.compile(r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}", re.I),
        re.compile(r"\bwhat\s+(did|have)\s+(i|we)\s+(do|done)\b", re.I),
    ],
    importance=ImportanceScoring(
        action_verbs=re.compile(
            r"\b(bought|purchased|serviced|visited|went|got|received|paid|earned|learned|discovered|found|saw|met|completed|finished|fixed|implemented|created|updated|added|removed|resolved)\b",
            re.I,
        ),
        wh=re.compile(r"\b(who|what|when|where|why|how)\b", re.I),
        self_refs=re.compile(r"\b(I|my|me)\b"),
        months=re.compile(
            r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+",
            re.I,
        ),
        units=re.compile(r"\$\d+|\d+\s*(miles|dollars|years|months|km)"),
    ),
    synonym_groups=[
        ["prefer", "like", "love", "enjoy", "favor"],
        ["theme", "mode", "style", "layout"],
        ["meeting", "meet", "session", "call", "sync"],
        ["dark", "night", "black"],
        ["light", "bright", "day"],
        ["user", "person", "people", "customer"],
        ["task", "todo", "job"],
        ["note", "memo", "reminder"],
        ["time", "schedule", "when", "date"],
        ["project", "initiative", "plan"],
        ["issue", "problem", "bug"],
        ["document", "doc", "file"],
        ["question", "query", "ask"],
    ],
    stem=stem_en,
    should_stem=should_stem_en,
)
