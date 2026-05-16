// PT stemmer is a no-op by design: aggressive stemming destroys medical
// terminology (e.g. "hipertensão", "pneumonia", "-ite/-ose/-emia" suffixes).
// JS lacks a maintained Snowball-PT we trust for this domain. The Python
// SDK gets proper lemmatization via spaCy; JS leans on raw tokens plus
// embedding similarity.

export const stem_pt = (tok: string): string => tok;

export const should_stem_pt = (_tok: string): boolean => false;
