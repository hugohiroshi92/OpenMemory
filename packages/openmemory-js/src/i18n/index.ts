import { LangPack } from "./types";
import { en_pack } from "./langs/en";
import { pt_pack } from "./langs/pt";
import { compose_pack } from "./compose";
import { health_pt_overlay } from "./domains/health";

const pt_health_pack = compose_pack(pt_pack, health_pt_overlay, "pt", "health");

const packs: Record<string, LangPack> = {
    en: en_pack,
    pt: pt_pack,
    "pt-health": pt_health_pack,
};

export function registerLangPack(pack: LangPack): void {
    const key = pack.domain ? `${pack.lang}-${pack.domain}` : pack.lang;
    packs[key] = pack;
}

export function getLangPack(lang?: string | null, domain?: string | null): LangPack {
    const l = (lang || "en").toLowerCase();
    const d = domain ? domain.toLowerCase() : null;
    if (d) {
        const composed = packs[`${l}-${d}`];
        if (composed) return composed;
    }
    return packs[l] || packs.en;
}

export { en_pack, pt_pack, pt_health_pack, compose_pack };
export * from "./types";
