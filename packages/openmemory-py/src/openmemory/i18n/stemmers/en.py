import re

STEM_RULES = [
    (re.compile(r"ies$"), "y"),
    (re.compile(r"ing$"), ""),
    (re.compile(r"ers?$"), "er"),
    (re.compile(r"ed$"), ""),
    (re.compile(r"s$"), ""),
]


def stem_en(tok: str) -> str:
    if len(tok) <= 3:
        return tok
    for pat, rep in STEM_RULES:
        if pat.search(tok):
            st = pat.sub(rep, tok)
            if len(st) >= 3:
                return st
    return tok


def should_stem_en(_tok: str) -> bool:
    return True
