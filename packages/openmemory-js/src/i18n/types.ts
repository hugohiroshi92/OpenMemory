export type SectorName =
    | "episodic"
    | "semantic"
    | "procedural"
    | "emotional"
    | "reflective";

export interface SectorPatternBundle {
    episodic: RegExp[];
    semantic: RegExp[];
    procedural: RegExp[];
    emotional: RegExp[];
    reflective: RegExp[];
}

export interface ImportanceScoring {
    actionVerbs: RegExp;
    wh: RegExp;
    selfRefs: RegExp;
    months: RegExp;
    units: RegExp;
}

export interface LangPack {
    lang: string;
    domain: string | null;
    sectorPatterns: SectorPatternBundle;
    temporalPatterns: RegExp[];
    importance: ImportanceScoring;
    synonymGroups: string[][];
    stem: (token: string) => string;
    shouldStem: (token: string) => boolean;
}
