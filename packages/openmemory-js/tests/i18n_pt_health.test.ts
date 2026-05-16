import { describe, expect, it } from "vitest";
import { getLangPack, pt_pack, pt_health_pack } from "../src/i18n";

function classifyWith(pack: typeof pt_health_pack, content: string): string {
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

function hasTemporalWith(pack: typeof pt_health_pack, text: string): boolean {
    return pack.temporalPatterns.some((p) => p.test(text));
}

describe("pt-health overlay — registry", () => {
    it("resolves pt+health via getLangPack", () => {
        const pack = getLangPack("pt", "health");
        expect(pack.lang).toBe("pt");
        expect(pack.domain).toBe("health");
    });

    it("falls back to base pt when domain is unknown", () => {
        const pack = getLangPack("pt", "legal");
        expect(pack.lang).toBe("pt");
        expect(pack.domain).toBe(null);
    });

    it("falls back to en when both lang and domain are unknown", () => {
        const pack = getLangPack("xx", "yy");
        expect(pack.lang).toBe("en");
    });
});

describe("pt-health overlay — clinical classification", () => {
    it("classifies symptom complaints as semantic", () => {
        expect(
            classifyWith(pt_health_pack, "paciente com cefaleia e febre há 3 dias"),
        ).toBe("semantic");
        expect(
            classifyWith(
                pt_health_pack,
                "queixa principal: dor no peito e dispneia",
            ),
        ).toBe("semantic");
    });

    it("classifies diagnoses as semantic", () => {
        expect(
            classifyWith(
                pt_health_pack,
                "paciente é portador de hipertensão arterial sistêmica",
            ),
        ).toBe("semantic");
        expect(
            classifyWith(pt_health_pack, "DM tipo 2 descompensado, HbA1c 9.5"),
        ).toBe("semantic");
    });

    it("classifies prescriptions as procedural", () => {
        expect(
            classifyWith(
                pt_health_pack,
                "prescrevi losartana 50mg VO 1x/dia para hipertensão",
            ),
        ).toBe("procedural");
        expect(
            classifyWith(
                pt_health_pack,
                "administrar dipirona 500mg de 6/6h via oral",
            ),
        ).toBe("procedural");
    });

    it("classifies patient encounters as episodic", () => {
        expect(
            classifyWith(pt_health_pack, "paciente apresenta tontura e vertigem"),
        ).toBe("episodic");
        expect(
            classifyWith(
                pt_health_pack,
                "consulta de retorno: HDA inalterada, segue medicação",
            ),
        ).toBe("episodic");
    });
});

describe("pt-health overlay — clinical temporal markers", () => {
    it("recognises evolution-style markers", () => {
        expect(hasTemporalWith(pt_health_pack, "quadro com evolução de 2 semanas")).toBe(true);
        expect(hasTemporalWith(pt_health_pack, "sintoma agudo, iniciou há 24 horas")).toBe(true);
        expect(hasTemporalWith(pt_health_pack, "condição crônica preexistente")).toBe(true);
    });

    it("inherits base pt temporal markers", () => {
        expect(hasTemporalWith(pt_health_pack, "consulta agendada para amanhã")).toBe(true);
        expect(hasTemporalWith(pt_health_pack, "exame em 2026-04-12")).toBe(true);
    });
});

describe("pt-health overlay — medical synonyms", () => {
    it("groups hipertensão / HAS / pressão alta", () => {
        const group = pt_health_pack.synonymGroups.find((g) =>
            g.includes("hipertensão"),
        );
        expect(group).toBeDefined();
        expect(group).toContain("has");
        expect(group).toContain("pressão alta");
    });

    it("groups AVC / derrame / acidente vascular cerebral", () => {
        const group = pt_health_pack.synonymGroups.find((g) => g.includes("avc"));
        expect(group).toBeDefined();
        expect(group).toContain("derrame");
    });

    it("preserves base pt synonyms (escuro/noite/preto still there)", () => {
        const group = pt_health_pack.synonymGroups.find((g) => g.includes("escuro"));
        expect(group).toBeDefined();
        expect(group).toContain("noite");
    });
});

describe("pt-health overlay — does not break base pt", () => {
    it("base pt pack still classifies general PT content", () => {
        function classifyBase(content: string): string {
            const scores: Record<string, number> = {
                episodic: 0, semantic: 0, procedural: 0, emotional: 0, reflective: 0,
            };
            for (const sector of Object.keys(scores) as Array<keyof typeof scores>) {
                for (const pattern of pt_pack.sectorPatterns[sector]) {
                    const m = content.match(pattern);
                    if (m) scores[sector] += m.length;
                }
            }
            const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
            return sorted[0][1] > 0 ? sorted[0][0] : "semantic";
        }
        expect(classifyBase("fui ao mercado ontem")).toBe("episodic");
        expect(classifyBase("sinto que estou ansioso")).toBe("emotional");
    });
});
