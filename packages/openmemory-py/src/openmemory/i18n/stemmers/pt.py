"""PT stemmer using spaCy lemmatization when available.

Falls back to a no-op (raw token) if spaCy or the `pt_core_news_sm` model is
not installed. The fallback preserves correctness — medical terms like
"hipertensão", "pneumonia", "-ite/-ose/-emia" suffixes are kept intact.

Install with: pip install openmemory-py[pt] && python -m spacy download pt_core_news_sm
"""

import functools
import logging

logger = logging.getLogger("openmemory.i18n.pt")


@functools.lru_cache(maxsize=1)
def _get_nlp():
    try:
        import spacy
    except ImportError:
        logger.info(
            "[i18n/pt] spaCy not installed — falling back to no-op stemmer. "
            "Install with `pip install openmemory-py[pt]` for lemmatization."
        )
        return None
    try:
        return spacy.load("pt_core_news_sm", disable=["parser", "ner"])
    except OSError:
        logger.warning(
            "[i18n/pt] spaCy model `pt_core_news_sm` not found — falling back to no-op. "
            "Download with `python -m spacy download pt_core_news_sm`."
        )
        return None


@functools.lru_cache(maxsize=20000)
def stem_pt(tok: str) -> str:
    nlp = _get_nlp()
    if nlp is None:
        return tok
    doc = nlp(tok)
    if not doc:
        return tok
    lemma = doc[0].lemma_.lower()
    return lemma if lemma else tok


def should_stem_pt(_tok: str) -> bool:
    # Always pass through stem_pt; the function itself handles the no-op fallback.
    # When spaCy + model are loaded, every token gets lemmatized.
    # When unavailable, stem_pt returns the raw token (effectively no-op).
    return True
