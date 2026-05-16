import { ImportanceScoring, LangPack, SectorName } from "./types";
import { HealthOverlay } from "./domains/health";

type DomainOverlay = HealthOverlay;

function mergeRegex(a: RegExp, b?: RegExp): RegExp {
    if (!b) return a;
    // Preserve the base flags — additions are written with compatible flags.
    return new RegExp(`${a.source}|${b.source}`, a.flags);
}

function mergeImportance(
    base: ImportanceScoring,
    add?: DomainOverlay["importance"],
): ImportanceScoring {
    if (!add) return base;
    return {
        actionVerbs: mergeRegex(base.actionVerbs, add.actionVerbs),
        wh: base.wh,
        selfRefs: base.selfRefs,
        months: base.months,
        units: mergeRegex(base.units, add.units),
    };
}

export function compose_pack(
    base: LangPack,
    overlay: DomainOverlay,
    lang: string,
    domain: string,
): LangPack {
    const sectors: SectorName[] = [
        "episodic",
        "semantic",
        "procedural",
        "emotional",
        "reflective",
    ];
    const mergedSectorPatterns = sectors.reduce(
        (acc, s) => {
            acc[s] = [
                ...base.sectorPatterns[s],
                ...(overlay.sectorPatterns[s] ?? []),
            ];
            return acc;
        },
        {} as LangPack["sectorPatterns"],
    );

    return {
        lang,
        domain,
        sectorPatterns: mergedSectorPatterns,
        temporalPatterns: [...base.temporalPatterns, ...overlay.temporalPatterns],
        importance: mergeImportance(base.importance, overlay.importance),
        synonymGroups: [...base.synonymGroups, ...overlay.synonymGroups],
        stem: base.stem,
        shouldStem: base.shouldStem,
    };
}
