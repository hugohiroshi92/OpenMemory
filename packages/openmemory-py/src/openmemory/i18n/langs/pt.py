"""PT-BR language pack.

Mirrors `packages/openmemory-js/src/i18n/langs/pt.ts`. Use Python's `re`
with the default Unicode-aware mode (Python 3 `re.search` treats `\\w` and
`\\b` as Unicode by default), so we can rely on `\\b` here — unlike the JS
side which had to fall back to `\\p{L}` lookarounds.
"""

import re

from ..types import ImportanceScoring, LangPack, SectorPatternBundle
from ..stemmers.pt import stem_pt, should_stem_pt


PT_PACK = LangPack(
    lang="pt",
    domain=None,
    sector_patterns=SectorPatternBundle(
        episodic=[
            re.compile(r"\b(hoje|ontem|amanh[ãa]|semana\s+(passada|que\s+vem)|m[êe]s\s+(passado|que\s+vem)|ano\s+(passado|que\s+vem))\b", re.I),
            re.compile(r"\b(lembra(?:\s+(?:quando|de))?|recordo|aquela\s+vez|quando\s+eu|eu\s+estava|est[áa]vamos)\b", re.I),
            re.compile(r"\b(fui|vi|encontrei|senti|ouvi|visitei|participei|cheguei|sa[íi]|voltei)\b", re.I),
            re.compile(r"\b([àa]s\s+\d{1,2}[:h]\d{0,2}|n[ao]\s+(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo))\b", re.I),
            re.compile(r"\b(evento|momento|experi[êe]ncia|incidente|ocorr[êe]ncia|aconteceu|sucedeu)\b", re.I),
            re.compile(r"\b(vou\s+(fazer|ir|come[çc]ar|tentar))\b", re.I),
        ],
        semantic=[
            re.compile(r"\b([ée]\s+(um|uma)|representa|significa|definid[oa]\s+como|trata-se\s+de)\b", re.I),
            re.compile(r"\b(conceito|teoria|princ[íi]pio|lei|hip[óo]tese|teorema|axioma)\b", re.I),
            re.compile(r"\b(fato|estat[íi]stica|dado|evid[êe]ncia|prova|pesquisa|estudo|relat[óo]rio)\b", re.I),
            re.compile(r"\b(capital|popula[çc][ãa]o|dist[âa]ncia|peso|altura|largura|profundidade)\b", re.I),
            re.compile(r"\b(hist[óo]ria|ci[êe]ncia|geografia|matem[áa]tica|f[íi]sica|biologia|qu[íi]mica)\b", re.I),
            re.compile(r"\b(sei|saber|conhe[çc]o|entendo|aprendo|leio|escrevo|falo)\b", re.I),
        ],
        procedural=[
            re.compile(r"\b(como\s+(fazer|criar|implementar|usar|instalar)|passo\s+a\s+passo|guia|tutorial|manual|instru[çc][õo]es)\b", re.I),
            re.compile(r"\b(primeiro|segundo|ent[ãa]o|depois|em\s+seguida|finalmente|por\s+fim|por\s+[úu]ltimo)\b", re.I),
            re.compile(r"\b(instalar|executar|rodar|compilar|construir|implantar|configurar|preparar)\b", re.I),
            re.compile(r"\b(clicar|pressionar|digitar|selecionar|arrastar|rolar|tocar)\b", re.I),
            re.compile(r"\b(m[ée]todo|fun[çc][ãa]o|classe|algoritmo|rotina|receita|procedimento)\b", re.I),
            re.compile(r"\b(para\s+(fazer|criar|construir|configurar|preparar))\b", re.I),
        ],
        emotional=[
            re.compile(r"\b(sinto|sentir|senti|emo[çc][ãa]o|emo[çc][õo]es|humor|sentimento)\b", re.I),
            re.compile(r"\b(feliz|triste|bravo|irritado|animado|ansioso|nervoso|deprimido|chateado)\b", re.I),
            re.compile(r"\b(amo|amor|odeio|gosto|desgosto|adoro|detesto|aprecio)\b", re.I),
            re.compile(r"\b(incr[íi]vel|terr[íi]vel|maravilhoso|horr[íi]vel|[óo]timo|ruim|p[ée]ssimo)\b", re.I),
            re.compile(r"\b(frustrado|confuso|sobrecarregado|estressado|relaxado|calmo|tranquilo)\b", re.I),
            re.compile(r"\b(nossa|caramba|oba|uau|argh|ufa|eita|puxa)\b", re.I),
            re.compile(r"[!]{2,}"),
        ],
        reflective=[
            re.compile(r"\b(percebi|percebido|percep[çc][ãa]o|insight|ep[íi]fania|me\s+dei\s+conta)\b", re.I),
            re.compile(r"\b(penso|pensei|pensando|reflito|reflex[ãa]o|ponderar|contemplar)\b", re.I),
            re.compile(r"\b(entendo|entendi|entendido|entendimento|compreender|compreens[ãa]o)\b", re.I),
            re.compile(r"\b(padr[ãa]o|tend[êe]ncia|conex[ãa]o|liga[çc][ãa]o|rela[çc][ãa]o|correla[çc][ãa]o)\b", re.I),
            re.compile(r"\b(li[çc][ãa]o|moral|conclus[ãa]o|resumo|implica[çc][ãa]o|aprendizado)\b", re.I),
            re.compile(r"\b(feedback|revis[ãa]o|an[áa]lise|avalia[çc][ãa]o)\b", re.I),
            re.compile(r"\b(melhorar|crescer|mudar|adaptar|evoluir|aprimorar)\b", re.I),
        ],
    ),
    temporal_patterns=[
        re.compile(r"\b(hoje|ontem|amanh[ãa]|esta\s+semana|semana\s+passada|esta\s+manh[ãa]|esta\s+noite|este\s+m[êe]s)\b", re.I),
        re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
        re.compile(r"\b20\d{2}[/-]?(0[1-9]|1[0-2])[/-]?(0[1-9]|[12]\d|3[01])\b"),
        re.compile(r"\b(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(de\s+)?\d{1,2}", re.I),
        re.compile(r"\b(h[áa]|faz)\s+\d+\s+(minutos?|horas?|dias?|semanas?|meses|anos?)\b", re.I),
        re.compile(r"\bo\s+que\s+(fiz|fizemos|aconteceu|estava\s+fazendo)\b", re.I),
    ],
    importance=ImportanceScoring(
        action_verbs=re.compile(
            r"\b(comprei|comprou|adquiri|visitei|fui|recebi|paguei|ganhei|aprendi|descobri|achei|encontrei|vi|completei|terminei|finalizei|consertei|implementei|criei|atualizei|adicionei|removi|resolvi|prescrevi|administrei|diagnostiquei|examinei)\b",
            re.I,
        ),
        wh=re.compile(r"\b(quem|o\s+que|qual|quais|quando|onde|por\s+que|por\s+qu[êe]|como)\b", re.I),
        self_refs=re.compile(r"\b(eu|meu|minha|me|mim|comigo)\b", re.I),
        months=re.compile(
            r"\b(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(de\s+)?\d+",
            re.I,
        ),
        units=re.compile(
            r"R\$\s*\d+|\d+\s*(km|m|metros|quilos?|kg|g|gramas?|mg|ml|litros?|reais|anos?|meses|dias|horas?|min)\b",
            re.I,
        ),
    ),
    synonym_groups=[
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
    stem=stem_pt,
    should_stem=should_stem_pt,
)
