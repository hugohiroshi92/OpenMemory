"""PT-BR health domain overlay.

Mirrors `packages/openmemory-js/src/i18n/domains/health.ts`.

Python's `re.compile(..., re.I)` is Unicode-aware by default, so `\\b` works
across accented characters and we don't need the JS `\\p{L}` lookarounds.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Pattern


@dataclass
class HealthOverlayImportance:
    action_verbs: Optional[Pattern] = None
    units: Optional[Pattern] = None


@dataclass
class HealthOverlay:
    sector_patterns: Dict[str, List[Pattern]]
    temporal_patterns: List[Pattern]
    importance: HealthOverlayImportance
    synonym_groups: List[List[str]]


HEALTH_PT_OVERLAY = HealthOverlay(
    sector_patterns={
        # Symptoms, diagnoses, exams, vital signs — semantic.
        "semantic": [
            # Symptoms / chief complaints
            re.compile(r"\b(cefaleia|enxaqueca|dor\s+de\s+cabe[çc]a)\b", re.I),
            re.compile(r"\b(febre|hipertermia|estado\s+febril)\b", re.I),
            re.compile(r"\b(tosse|expectora[çc][ãa]o|dispn[éeê]ia|falta\s+de\s+ar)\b", re.I),
            re.compile(r"\b(dor\s+(no\s+peito|tor[áa]cica|abdominal|lombar|articular|nas\s+costas))\b", re.I),
            re.compile(r"\b(n[áa]usea|v[ôo]mito|diarr[éeê]ia|constipa[çc][ãa]o)\b", re.I),
            re.compile(r"\b(vertigem|tontura|s[íi]ncope|desmaio)\b", re.I),
            re.compile(r"\b(fadiga|astenia|cansa[çc]o|prostra[çc][ãa]o)\b", re.I),
            re.compile(r"\b(edema|incha[çc]o|ascite)\b", re.I),
            re.compile(r"\b(erup[çc][ãa]o|exantema|prurido|coceira)\b", re.I),
            # Diagnoses / chronic conditions
            re.compile(r"\b(hipertens[ãa]o(?:\s+arterial)?(?:\s+sist[êe]mica)?|HAS|press[ãa]o\s+alta)\b", re.I),
            re.compile(r"\b(diabetes(?:\s+mellitus)?(?:\s+tipo\s+[12]|i|ii)?|DM(?:\s+tipo\s+[12])?)\b", re.I),
            re.compile(r"\b(asma|DPOC|bronquite|pneumonia|tuberculose|TB)\b", re.I),
            re.compile(r"\b(AVC|derrame|acidente\s+vascular\s+cerebral|isquemia\s+cerebral)\b", re.I),
            re.compile(r"\b(infarto(?:\s+do\s+mioc[áa]rdio)?|IAM|s[íi]ndrome\s+coron[áa]riana)\b", re.I),
            re.compile(r"\b(c[âa]ncer|neoplasia|tumor(?:\s+maligno)?|metastase)\b", re.I),
            re.compile(r"\b(depress[ãa]o|ansiedade|transtorno\s+(de|do)\s+(humor|ansiedade))\b", re.I),
            re.compile(r"\b(dislipidemia|colesterol\s+alto|hipercolesterolemia)\b", re.I),
            re.compile(r"\b(anemia|leucemia|trombocitopenia)\b", re.I),
            # Exams / labs / imaging
            re.compile(r"\b(hemograma|hemoglobina|leuc[óo]citos|plaquetas)\b", re.I),
            re.compile(r"\b(creatinina|ur[ée]ia|TGO|TGP|TSH|T4|glicemia|HbA1c)\b", re.I),
            re.compile(r"\b(raio-x|RX|tomografia|TC|ressonancia|RM|ultrassom|USG|ecocardiograma)\b", re.I),
            # Vital signs (with values)
            re.compile(r"\bPA\s*\d{2,3}\s*[xX/]\s*\d{2,3}", re.I),
            re.compile(r"\bFC\s*\d{2,3}\b", re.I),
            re.compile(r"\bFR\s*\d{1,2}\b", re.I),
            re.compile(r"\bTax?\s*\d{2}[,.]?\d?\b", re.I),
            re.compile(r"\bSatO?2?\s*\d{2,3}\b", re.I),
            re.compile(r"\bIMC\s*\d{1,2}[,.]?\d?\b", re.I),
        ],
        # Prescriptions, procedures — procedural.
        "procedural": [
            re.compile(r"\b(prescrev(?:er|i|o)|prescri[çc][ãa]o|receitar|receita)\b", re.I),
            re.compile(r"\b(administrar|administrei|aplicar|apliquei|inje[çc][ãa]o)\b", re.I),
            re.compile(r"\b(indicar|indicado|contraindicado|prescrito)\b", re.I),
            re.compile(r"\b(dose|dosagem|posologia)\b", re.I),
            re.compile(r"\b\d+\s*(mg|mcg|µg|g|ml|UI|comp(?:rimidos?)?|c[áa]ps(?:ulas?)?|gotas?|amp(?:olas?)?)\b", re.I),
            re.compile(r"\b\d+\s*x\s*\/?\s*dia|de\s+\d+\/\d+\s*h(?:oras?)?|a\s+cada\s+\d+\s*h(?:oras?)?|antes\s+de\s+dormir|em\s+jejum\b", re.I),
            re.compile(r"\b(VO|IV|IM|SC|SL|EV|via\s+oral)\b", re.I),
            re.compile(r"\b(an[áa]mnese|consulta|exame\s+(f[íi]sico|cl[íi]nico|neurol[óo]gico))\b", re.I),
            re.compile(r"\b(bi[óo]psia|punc[çc][ãa]o|drenagem)\b", re.I),
            re.compile(r"\b(cirurgia|opera[çc][ãa]o|interven[çc][ãa]o|procedimento\s+cir[úu]rgico)\b", re.I),
            re.compile(r"\b(cesari?ana|cesa?[áa]rea|parto(?:\s+normal)?)\b", re.I),
            re.compile(r"\b(intuba[çc][ãa]o|ventila[çc][ãa]o\s+mec[âa]nica)\b", re.I),
            re.compile(r"\b(encaminh(?:ar|amento)|referenci(?:ar|amento))\b", re.I),
        ],
        # Patient encounters — episodic.
        "episodic": [
            re.compile(r"\bpaciente(?:\s+(?:apresenta|relata|refere|nega|admite))\b", re.I),
            re.compile(r"\b(hist[óo]ria\s+(da|de)\s+(doen[çc]a|queixa)|HDA|HMA|HPP)\b", re.I),
            re.compile(r"\b(interna[çc][ãa]o|admiss[ãa]o\s+hospitalar|alta\s+hospitalar)\b", re.I),
            re.compile(r"\b(consulta\s+(de\s+)?retorno|seguimento|follow-?up)\b", re.I),
            re.compile(r"\b(crise|exacerba[çc][ãa]o|recidiva)\b", re.I),
        ],
    },
    temporal_patterns=[
        re.compile(r"\bh[áa]\s+\d+\s+(dias?|semanas?|meses|anos?|horas?|minutos?)\b", re.I),
        re.compile(r"\biniciou\s+(h[áa]|em|com)\b", re.I),
        re.compile(r"\bevolu[çc][ãa]o\s+(de|h[áa])\b", re.I),
        re.compile(r"\b(agudo|cr[ôo]nico|recidivante|recorrente|subagudo|transit[óo]rio)\b", re.I),
        re.compile(r"\b(preexistente|pr[ée]vio|atual|em\s+curso)\b", re.I),
        re.compile(r"\bepis[óo]dio\s+(anterior|pr[ée]vio|atual)\b", re.I),
    ],
    importance=HealthOverlayImportance(
        action_verbs=re.compile(
            r"\b(prescrevi|administrei|apliquei|diagnostiquei|examinei|auscultei|palpei|inspecionei|encaminhei|orientei|monitorei|internou|recebeu\s+alta|operou)\b",
            re.I,
        ),
        units=re.compile(
            r"\b\d+\s*(bpm|irpm|mmHg|mg\/dL|mEq\/L|UI|mcg|kg|cm|m[ée]tros?)\b",
            re.I,
        ),
    ),
    synonym_groups=[
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
)
