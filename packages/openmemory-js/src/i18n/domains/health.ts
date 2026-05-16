import { SectorName } from "../types";

// Unicode-safe word boundary helper. JS `\b` is ASCII-only and fails after
// accented characters (e.g. "hipertensão" terminating).
const W = (source: string, flags = "i"): RegExp =>
    new RegExp(`(?<![\\p{L}\\d_])(?:${source})(?![\\p{L}\\d_])`, flags + "u");

// Acronyms/codes can sit next to numbers (e.g. "PA 120/80", "DM tipo 2").
// We allow digits adjacent here on purpose.
const A = (source: string, flags = "i"): RegExp =>
    new RegExp(`(?<![\\p{L}_])(?:${source})(?![\\p{L}_])`, flags + "u");

export interface HealthOverlay {
    sectorPatterns: Partial<Record<SectorName, RegExp[]>>;
    temporalPatterns: RegExp[];
    importance: {
        actionVerbs?: RegExp;
        units?: RegExp;
    };
    synonymGroups: string[][];
}

export const health_pt_overlay: HealthOverlay = {
    sectorPatterns: {
        // Symptoms, diagnoses, exams, vital signs — semantic (facts about a patient).
        semantic: [
            // Symptoms / chief complaints
            W("cefaleia|enxaqueca|dor\\s+de\\s+cabe[çc]a"),
            W("febre|hipertermia|estado\\s+febril"),
            W("tosse|expectora[çc][ãa]o|dispn[éeê]ia|falta\\s+de\\s+ar"),
            W("dor\\s+(no\\s+peito|tor[áa]cica|abdominal|lombar|articular|nas\\s+costas)"),
            W("n[áa]usea|v[ôo]mito|diarr[éeê]ia|constipa[çc][ãa]o"),
            W("vertigem|tontura|s[íi]ncope|desmaio"),
            W("fadiga|astenia|cansa[çc]o|prostra[çc][ãa]o"),
            W("edema|incha[çc]o|ascite"),
            W("erup[çc][ãa]o|exantema|prurido|coceira"),
            // Diagnoses / chronic conditions
            W("hipertens[ãa]o(?:\\s+arterial)?(?:\\s+sist[êe]mica)?|HAS|press[ãa]o\\s+alta"),
            W("diabetes(?:\\s+mellitus)?(?:\\s+tipo\\s+[12]|i|ii)?|DM(?:\\s+tipo\\s+[12])?"),
            W("asma|DPOC|bronquite|pneumonia|tuberculose|TB"),
            W("AVC|derrame|acidente\\s+vascular\\s+cerebral|isquemia\\s+cerebral"),
            W("infarto(?:\\s+do\\s+mioc[áa]rdio)?|IAM|s[íi]ndrome\\s+coron[áa]riana"),
            W("c[âa]ncer|neoplasia|tumor(?:\\s+maligno)?|metastase"),
            W("depress[ãa]o|ansiedade|transtorno\\s+(de|do)\\s+(humor|ansiedade)"),
            W("dislipidemia|colesterol\\s+alto|hipercolesterolemia"),
            W("anemia|leucemia|trombocitopenia"),
            // Exams / labs / imaging
            W("hemograma|hemoglobina|leuc[óo]citos|plaquetas"),
            W("creatinina|ur[ée]ia|TGO|TGP|TSH|T4|glicemia|HbA1c"),
            W("raio-x|RX|tomografia|TC|ressonancia|RM|ultrassom|USG|ecocardiograma"),
            // Vital signs (with values)
            A("PA\\s*\\d{2,3}\\s*[xX/]\\s*\\d{2,3}"),
            A("FC\\s*\\d{2,3}"),
            A("FR\\s*\\d{1,2}"),
            A("Tax?\\s*\\d{2}[,.]?\\d?"),
            A("SatO?2?\\s*\\d{2,3}"),
            A("IMC\\s*\\d{1,2}[,.]?\\d?"),
        ],
        // Prescriptions, procedures, exam orders — procedural (clinical actions).
        procedural: [
            W("prescrev(?:er|i|o)|prescri[çc][ãa]o|receitar|receita"),
            W("administrar|administrei|aplicar|apliquei|inje[çc][ãa]o"),
            W("indicar|indicado|contraindicado|prescrito"),
            W("dose|dosagem|posologia"),
            // Drug formulations / units
            A("\\d+\\s*(mg|mcg|µg|g|ml|UI|comp(?:rimidos?)?|c[áa]ps(?:ulas?)?|gotas?|amp(?:olas?)?)"),
            // Frequency / route
            W("\\d+\\s*x\\s*\\/?\\s*dia|de\\s+\\d+\\/\\d+\\s*h(?:oras?)?|a\\s+cada\\s+\\d+\\s*h(?:oras?)?|antes\\s+de\\s+dormir|em\\s+jejum"),
            A("VO|IV|IM|SC|SL|EV|via\\s+oral"),
            // Clinical procedures
            W("an[áa]mnese|consulta|exame\\s+(f[íi]sico|cl[íi]nico|neurol[óo]gico)"),
            W("bi[óo]psia|punc[çc][ãa]o|drenagem"),
            W("cirurgia|opera[çc][ãa]o|interven[çc][ãa]o|procedimento\\s+cir[úu]rgico"),
            W("cesari?ana|cesa?[áa]rea|parto(?:\\s+normal)?"),
            W("intuba[çc][ãa]o|ventila[çc][ãa]o\\s+mec[âa]nica"),
            W("encaminh(?:ar|amento)|referenci(?:ar|amento)"),
        ],
        // Patient encounters / clinical events — episodic.
        episodic: [
            W("paciente(?:\\s+(?:apresenta|relata|refere|nega|admite))"),
            W("hist[óo]ria\\s+(da|de)\\s+(doen[çc]a|queixa)|HDA|HMA|HPP"),
            W("interna[çc][ãa]o|admiss[ãa]o\\s+hospitalar|alta\\s+hospitalar"),
            W("consulta\\s+(de\\s+)?retorno|seguimento|follow-?up"),
            W("crise|exacerba[çc][ãa]o|recidiva"),
        ],
    },
    temporalPatterns: [
        // Clinical evolution markers (more specific than the base pt pack)
        W("h[áa]\\s+\\d+\\s+(dias?|semanas?|meses|anos?|horas?|minutos?)"),
        W("iniciou\\s+(h[áa]|em|com)"),
        W("evolu[çc][ãa]o\\s+(de|h[áa])"),
        W("agudo|cr[ôo]nico|recidivante|recorrente|subagudo|transit[óo]rio"),
        W("preexistente|pr[ée]vio|atual|em\\s+curso"),
        W("epis[óo]dio\\s+(anterior|pr[ée]vio|atual)"),
    ],
    importance: {
        // Clinical action verbs the base pt pack doesn't emphasize.
        actionVerbs: W(
            "prescrevi|administrei|apliquei|diagnostiquei|examinei|auscultei|palpei|inspecionei|encaminhei|orientei|monitorei|internou|recebeu\\s+alta|operou",
        ),
        // Clinical units — additive over the base pt unit pattern.
        units: W(
            "\\d+\\s*(bpm|irpm|mmHg|mg\\/dL|mEq\\/L|UI|mcg|kg|cm|m[ée]tros?)",
        ),
    },
    synonymGroups: [
        // Common clinical aliases — accented + unaccented forms duplicated for
        // literal-string Map lookup.
        ["hipertensão", "hipertensao", "has", "pressão alta", "pressao alta"],
        ["diabetes", "dm", "diabete", "açúcar alto", "acucar alto"],
        ["avc", "derrame", "acidente vascular cerebral", "ictus"],
        ["infarto", "iam", "ataque cardíaco", "ataque cardiaco"],
        ["câncer", "cancer", "neoplasia", "tumor maligno"],
        ["fármaco", "farmaco", "remédio", "remedio", "medicamento", "droga"],
        ["consulta", "atendimento", "visita médica", "visita medica"],
        ["paciente", "enfermo", "doente"],
        ["sintoma", "queixa", "manifestação", "manifestacao"],
        ["dor", "algia", "dolorimento"],
        ["febre", "hipertermia", "estado febril"],
        ["cefaleia", "enxaqueca", "dor de cabeça", "dor de cabeca"],
        ["dispneia", "dispnéia", "falta de ar", "sufoco"],
        ["pressão arterial", "pressao arterial", "pa"],
        ["frequência cardíaca", "frequencia cardiaca", "fc", "pulso"],
        ["temperatura", "tax", "tax axilar", "temperatura axilar"],
        ["exame", "investigação", "investigacao", "avaliação", "avaliacao"],
        ["sangue", "hemograma", "sanguíneo", "sanguineo"],
    ],
};
