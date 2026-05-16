import { describe, expect, it } from "vitest";
import { getLangPack, pt_pack, en_pack } from "../src/i18n";

// Classifies content via the same scoring logic that hsg.classify_content
// uses internally. Kept here as a tiny helper so we can drive the test
// with a specific lang pack without booting the full module graph.
function classifyWith(pack: typeof en_pack, content: string): string {
    const scores: Record<string, number> = {
        episodic: 0,
        semantic: 0,
        procedural: 0,
        emotional: 0,
        reflective: 0,
    };
    for (const sector of Object.keys(scores) as Array<keyof typeof scores>) {
        for (const pattern of pack.sectorPatterns[sector]) {
            const matches = content.match(pattern);
            if (matches) scores[sector] += matches.length;
        }
    }
    const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
    return sorted[0][1] > 0 ? sorted[0][0] : "semantic";
}

function hasTemporalWith(pack: typeof en_pack, text: string): boolean {
    return pack.temporalPatterns.some((p) => p.test(text));
}

describe("pt language pack — registry", () => {
    it("resolves pt via getLangPack", () => {
        expect(getLangPack("pt").lang).toBe("pt");
    });

    it("falls back to en for unknown lang", () => {
        expect(getLangPack("xx").lang).toBe("en");
    });
});

describe("pt language pack — sector classification", () => {
    it("classifies episodic content with PT temporal markers", () => {
        expect(classifyWith(pt_pack, "fui ao mercado ontem à tarde")).toBe(
            "episodic",
        );
        expect(classifyWith(pt_pack, "lembra quando viajamos juntos?")).toBe(
            "episodic",
        );
    });

    it("classifies procedural content with PT how-to markers", () => {
        expect(
            classifyWith(pt_pack, "como fazer uma boa anamnese passo a passo"),
        ).toBe("procedural");
    });

    it("classifies emotional content with PT feeling markers", () => {
        expect(classifyWith(pt_pack, "sinto que estou ansioso e estressado")).toBe(
            "emotional",
        );
    });

    it("classifies semantic content with PT factual markers", () => {
        expect(
            classifyWith(
                pt_pack,
                "a hipertensão é uma condição cardiovascular crônica",
            ),
        ).toBe("semantic");
    });

    it("classifies reflective content with PT introspective markers", () => {
        expect(
            classifyWith(pt_pack, "percebi um padrão na evolução dos pacientes"),
        ).toBe("reflective");
    });
});

describe("pt language pack — temporal markers", () => {
    it("recognises relative temporal expressions in PT", () => {
        expect(hasTemporalWith(pt_pack, "paciente apresenta sintomas há 3 dias")).toBe(true);
        expect(hasTemporalWith(pt_pack, "evolução de faz 2 semanas")).toBe(true);
        expect(hasTemporalWith(pt_pack, "consulta agendada para amanhã")).toBe(true);
    });

    it("recognises absolute dates and PT month names", () => {
        expect(hasTemporalWith(pt_pack, "exame realizado em janeiro 15")).toBe(true);
        expect(hasTemporalWith(pt_pack, "alta hospitalar em 2026-04-12")).toBe(true);
    });

    it("does not flag a date-free sentence", () => {
        expect(hasTemporalWith(pt_pack, "diagnóstico de hipertensão arterial")).toBe(false);
    });
});

describe("pt language pack — synonym groups (raw lookup)", () => {
    it("groups dark/escuro/noite/preto together", () => {
        const group = pt_pack.synonymGroups.find((g) => g.includes("escuro"));
        expect(group).toBeDefined();
        expect(group).toContain("noite");
        expect(group).toContain("preto");
    });

    it("groups medical-friendly synonyms (usuário/paciente)", () => {
        const group = pt_pack.synonymGroups.find((g) => g.includes("paciente"));
        expect(group).toBeDefined();
        expect(group).toContain("usuário");
    });
});

describe("pt language pack — stemmer", () => {
    it("does not stem PT tokens (preserves medical terms)", () => {
        expect(pt_pack.shouldStem("hipertensão")).toBe(false);
        expect(pt_pack.shouldStem("pneumonia")).toBe(false);
    });
});
