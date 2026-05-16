const stem_rules: Array<[RegExp, string]> = [
    [/ies$/, "y"],
    [/ing$/, ""],
    [/ers?$/, "er"],
    [/ed$/, ""],
    [/s$/, ""],
];

export const stem_en = (tok: string): string => {
    if (tok.length <= 3) return tok;
    for (const [pat, rep] of stem_rules) {
        if (pat.test(tok)) {
            const st = tok.replace(pat, rep);
            if (st.length >= 3) return st;
        }
    }
    return tok;
};

export const should_stem_en = (_tok: string): boolean => true;
