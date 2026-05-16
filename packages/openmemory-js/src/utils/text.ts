import crypto from "node:crypto";
import { env } from "../core/cfg";
import { getLangPack } from "../i18n";

const lang_pack = getLangPack(env.lang, env.domain);

const cmap = new Map<string, string>();
const slook = new Map<string, Set<string>>();

for (const grp of lang_pack.synonymGroups) {
    const can = grp[0];
    const sset = new Set(grp);
    for (const w of grp) {
        cmap.set(w, can);
        slook.set(can, sset);
    }
}

const cjk_pat =
    /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]+/u;
const tok_pat =
    /[a-z0-9]+|[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]+/giu;

const expand_cjk_token = (tok: string): string[] => {
    if (tok.length <= 1) return [tok];
    const expanded: string[] = [];
    for (let i = 0; i < tok.length - 1; i++) {
        expanded.push(tok.slice(i, i + 2));
    }
    return expanded;
};

export const tokenize = (text: string): string[] => {
    const toks: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = tok_pat.exec(text))) {
        const tok = m[0];
        if (cjk_pat.test(tok)) {
            toks.push(...expand_cjk_token(tok));
            continue;
        }
        toks.push(tok.toLowerCase());
    }
    return toks;
};

const stem = (tok: string): string => {
    if (!lang_pack.shouldStem(tok)) return tok;
    return lang_pack.stem(tok);
};

export const canonicalize_token = (tok: string): string => {
    if (!tok) return "";
    const low = tok.toLowerCase();
    if (cmap.has(low)) return cmap.get(low)!;
    const st = stem(low);
    return cmap.get(st) || st;
};

export const canonical_tokens_from_text = (text: string): string[] => {
    const res: string[] = [];
    for (const tok of tokenize(text)) {
        const can = canonicalize_token(tok);
        if (can && can.length > 1) {
            res.push(can);
        }
    }
    return res;
};

export const synonyms_for = (tok: string): Set<string> => {
    const can = canonicalize_token(tok);
    return slook.get(can) || new Set([can]);
};

export const build_search_doc = (text: string): string => {
    const can = canonical_tokens_from_text(text);
    const exp = new Set<string>();
    for (const tok of can) {
        exp.add(tok);
        const syns = slook.get(tok);
        if (syns) {
            syns.forEach((s) => exp.add(s));
        }
    }
    return Array.from(exp).join(" ");
};

export const build_fts_query = (text: string): string => {
    const can = canonical_tokens_from_text(text);
    if (!can.length) return "";
    const uniq = Array.from(new Set(can.filter((t) => t.length > 1)));
    return uniq.map((t) => `"${t}"`).join(" OR ");
};

export const canonical_token_set = (text: string): Set<string> => {
    return new Set(canonical_tokens_from_text(text));
};

export const stable_text_fallback_hash = (text: string): string => {
    return crypto
        .createHash("blake2b512")
        .update(text, "utf8")
        .digest("hex")
        .slice(0, 16);
};

export const add_synonym_tokens = (toks: Iterable<string>): Set<string> => {
    const res = new Set<string>();
    for (const tok of toks) {
        res.add(tok);
        const syns = slook.get(tok);
        if (syns) {
            syns.forEach((s) => res.add(canonicalize_token(s)));
        }
    }
    return res;
};
