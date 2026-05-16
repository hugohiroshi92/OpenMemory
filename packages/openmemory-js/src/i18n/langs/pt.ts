import { LangPack } from "../types";
import { stem_pt, should_stem_pt } from "../stemmers/pt";

// JS regex `\b` is ASCII-only — it fails after letters with accents
// (e.g. `\b(amanh[ãa])\b` does NOT match "amanhã" because `\b` after `ã`
// requires a word/non-word transition and `ã` is not a word char in
// ASCII mode). Use Unicode property lookarounds instead.
const W = (source: string, flags = "i"): RegExp =>
    new RegExp(`(?<![\\p{L}\\d_])(?:${source})(?![\\p{L}\\d_])`, flags + "u");

export const pt_pack: LangPack = {
    lang: "pt",
    domain: null,
    sectorPatterns: {
        episodic: [
            W("hoje|ontem|amanh[ãa]|semana\\s+(passada|que\\s+vem)|m[êe]s\\s+(passado|que\\s+vem)|ano\\s+(passado|que\\s+vem)"),
            W("lembra(?:\\s+(?:quando|de))?|recordo|aquela\\s+vez|quando\\s+eu|eu\\s+estava|est[áa]vamos"),
            W("fui|vi|encontrei|senti|ouvi|visitei|participei|cheguei|sa[íi]|voltei"),
            W("[àa]s\\s+\\d{1,2}[:h]\\d{0,2}|n[ao]\\s+(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)"),
            W("evento|momento|experi[êe]ncia|incidente|ocorr[êe]ncia|aconteceu|sucedeu"),
            W("vou\\s+(fazer|ir|come[çc]ar|tentar)"),
        ],
        semantic: [
            W("[ée]\\s+(um|uma)|representa|significa|definid[oa]\\s+como|trata-se\\s+de"),
            W("conceito|teoria|princ[íi]pio|lei|hip[óo]tese|teorema|axioma"),
            W("fato|estat[íi]stica|dado|evid[êe]ncia|prova|pesquisa|estudo|relat[óo]rio"),
            W("capital|popula[çc][ãa]o|dist[âa]ncia|peso|altura|largura|profundidade"),
            W("hist[óo]ria|ci[êe]ncia|geografia|matem[áa]tica|f[íi]sica|biologia|qu[íi]mica"),
            W("sei|saber|conhe[çc]o|entendo|aprendo|leio|escrevo|falo"),
        ],
        procedural: [
            W("como\\s+(fazer|criar|implementar|usar|instalar)|passo\\s+a\\s+passo|guia|tutorial|manual|instru[çc][õo]es"),
            W("primeiro|segundo|ent[ãa]o|depois|em\\s+seguida|finalmente|por\\s+fim|por\\s+[úu]ltimo"),
            W("instalar|executar|rodar|compilar|construir|implantar|configurar|preparar"),
            W("clicar|pressionar|digitar|selecionar|arrastar|rolar|tocar"),
            W("m[ée]todo|fun[çc][ãa]o|classe|algoritmo|rotina|receita|procedimento"),
            W("para\\s+(fazer|criar|construir|configurar|preparar)"),
        ],
        emotional: [
            W("sinto|sentir|senti|emo[çc][ãa]o|emo[çc][õo]es|humor|sentimento"),
            W("feliz|triste|bravo|irritado|animado|ansioso|nervoso|deprimido|chateado"),
            W("amo|amor|odeio|gosto|desgosto|adoro|detesto|aprecio"),
            W("incr[íi]vel|terr[íi]vel|maravilhoso|horr[íi]vel|[óo]timo|ruim|p[ée]ssimo"),
            W("frustrado|confuso|sobrecarregado|estressado|relaxado|calmo|tranquilo"),
            W("nossa|caramba|oba|uau|argh|ufa|eita|puxa"),
            /[!]{2,}/,
        ],
        reflective: [
            W("percebi|percebido|percep[çc][ãa]o|insight|ep[íi]fania|me\\s+dei\\s+conta"),
            W("penso|pensei|pensando|reflito|reflex[ãa]o|ponderar|contemplar"),
            W("entendo|entendi|entendido|entendimento|compreender|compreens[ãa]o"),
            W("padr[ãa]o|tend[êe]ncia|conex[ãa]o|liga[çc][ãa]o|rela[çc][ãa]o|correla[çc][ãa]o"),
            W("li[çc][ãa]o|moral|conclus[ãa]o|resumo|implica[çc][ãa]o|aprendizado"),
            W("feedback|revis[ãa]o|an[áa]lise|avalia[çc][ãa]o"),
            W("melhorar|crescer|mudar|adaptar|evoluir|aprimorar"),
        ],
    },
    temporalPatterns: [
        W("hoje|ontem|amanh[ãa]|esta\\s+semana|semana\\s+passada|esta\\s+manh[ãa]|esta\\s+noite|este\\s+m[êe]s"),
        /\b\d{4}-\d{2}-\d{2}\b/,
        /\b20\d{2}[/-]?(0[1-9]|1[0-2])[/-]?(0[1-9]|[12]\d|3[01])\b/,
        W("(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\\s+(de\\s+)?\\d{1,2}"),
        W("(h[áa]|faz)\\s+\\d+\\s+(minutos?|horas?|dias?|semanas?|meses|anos?)"),
        W("o\\s+que\\s+(fiz|fizemos|aconteceu|estava\\s+fazendo)"),
    ],
    importance: {
        actionVerbs: W(
            "comprei|comprou|adquiri|visitei|fui|recebi|paguei|ganhei|aprendi|descobri|achei|encontrei|vi|completei|terminei|finalizei|consertei|implementei|criei|atualizei|adicionei|removi|resolvi|prescrevi|administrei|diagnostiquei|examinei",
        ),
        wh: W("quem|o\\s+que|qual|quais|quando|onde|por\\s+que|por\\s+qu[êe]|como"),
        selfRefs: W("eu|meu|minha|me|mim|comigo"),
        months: W(
            "(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\\s+(de\\s+)?\\d+",
        ),
        units: /R\$\s*\d+|\d+\s*(km|m|metros|quilos?|kg|g|gramas?|mg|ml|litros?|reais|anos?|meses|dias|horas?|min)\b/i,
    },
    synonymGroups: [
        ["preferir", "gostar", "amar", "adorar", "favorecer"],
        ["tema", "modo", "estilo", "layout"],
        ["reunião", "reuniao", "encontro", "sessão", "sessao", "ligação", "ligacao", "sync"],
        ["escuro", "noite", "preto"],
        ["claro", "brilhante", "dia"],
        ["usuário", "usuario", "pessoa", "cliente", "paciente"],
        ["tarefa", "afazer", "trabalho", "atividade"],
        ["nota", "memo", "lembrete", "anotação", "anotacao", "observação", "observacao"],
        ["tempo", "horário", "horario", "data", "momento"],
        ["projeto", "iniciativa", "plano"],
        ["problema", "questão", "questao", "bug", "erro", "falha"],
        ["documento", "doc", "arquivo", "ficheiro"],
        ["pergunta", "consulta", "dúvida", "duvida"],
    ],
    stem: stem_pt,
    shouldStem: should_stem_pt,
};
