#!/usr/bin/env python3
"""MUTAÇÃO — os 1.443 testes pegam defeito de verdade?

Mecanismo NOVO da auditoria de 02/10/2026. Cobertura mede linha executada; mutação mede se o teste
DEFENDE o comportamento: para cada defeito plantado (uma linha trocada de propósito), o teste focado
tem de ficar VERMELHO. Se continuar verde, o teste é decorativo naquele ponto.

Como rodar:  python3 scripts/mutacao.py            (todos)
             python3 scripts/mutacao.py nome-do-caso

Nada é commitado: o arquivo é restaurado (bit a bit) ao final de cada caso, mesmo se o processo morrer
(o backup fica em .mutacao-backup/).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BACKUP = RAIZ / '.mutacao-backup'

# Cada caso: nome, arquivo, o texto original, o defeito plantado, e os testes que DEVEM pegar.
CASOS = [
    dict(
        nome='otimizador-sem-2opt',
        arquivo='features/dispatch/routeOptimizer.ts',
        de='if (total < melhorTotal - 1e-9) {',
        para='if (false) {',
        testes=['__tests__/otimizador-nunca-piora.test.ts', '__tests__/fuzz-operacao.test.ts'],
        porque='desliga a melhoria 2-opt: a rota volta a poder sair pior que a original',
    ),
    dict(
        nome='entrega-sai-da-van',
        arquivo='features/dispatch/routeOptimizer.ts',
        de='const lat = temOrigemPropria ? origem!.latitude! : options.homeLatitude;',
        para='const lat = options.homeLatitude as number;',
        testes=['__tests__/minutosDaOrdem.test.ts'],
        porque='volta a primeira perna da ENTREGA para a van (cliente pediu: posição do motorista)',
    ),
    dict(
        nome='boarding-volta-a-ser-parada',
        arquivo='features/calendar/dayMath.ts',
        de='      .filter((item) => item.goesToDaycare)',
        para='      .filter((item) => !item.transportRequired && item.goesToDaycare)',
        testes=['__tests__/transportPool.test.ts', '__tests__/contrato-escrito-do-cliente-28-09.test.ts'],
        porque='volta a regra antiga: boarding com transporte entra na lista de pickup',
    ),
    dict(
        nome='yard-e-van-trocados',
        arquivo='features/driver/routeClosing.ts',
        de='  const destino = yard ?? van;',
        para='  const destino = van ?? yard;',
        testes=['__tests__/fechamentoDaRota.test.ts', '__tests__/motorista-2-toques.test.tsx'],
        porque='fim da BUSCA passa a mandar o motorista para a van em vez do yard',
    ),
    dict(
        nome='rotulo-do-yard-trocado',
        arquivo='features/driver/routeClosing.ts',
        de="    return {\n      kind: destino.kind === 'yard' ? 'yard' : 'van',\n      title: destino.kind === 'yard' ? 'Back to the yard' : 'Back to the van',\n      subtitle: 'All dogs delivered — the day ends here.',",
        para="    return {\n      kind: destino.kind === 'yard' ? 'yard' : 'van',\n      title: destino.kind === 'yard' ? 'Back to the van' : 'Back to the yard',\n      subtitle: 'All dogs delivered — the day ends here.',",
        testes=['__tests__/fechamentoDaRota.test.ts'],
        porque='o motorista lê o destino errado no fim da busca',
    ),
    dict(
        nome='contagem-sem-dedupe',
        arquivo='features/dashboard/dayService.ts',
        de='export function contagemDoDia',
        para='export function contagemDoDia',
        testes=['__tests__/dia-operacao-agente2.test.ts'],
        porque='(controle: mutação neutra — deve SOBREVIVER para provar que a ferramenta não aprova tudo)',
        neutra=True,
    ),
    dict(
        nome='fila-offline-engole-erro',
        arquivo='app/(tabs)/driver.tsx',
        de='remaining.push(event, ...events.slice(indice + 1));',
        para='remaining.push();',
        testes=['__tests__/motorista-2-toques.test.tsx'],
        porque='passo recusado pelo servidor some sem avisar o motorista',
    ),
    dict(
        nome='data-usa-fuso-do-aparelho',
        arquivo='features/calendar/dates.ts',
        de='const nextDay = String(date.getUTCDate()).padStart(2, \'0\');',
        para='const nextDay = String(date.getDate()).padStart(2, \'0\');',
        testes=['__tests__/fuzz-operacao.test.ts'],
        porque='data montada com o fuso do APARELHO em vez de UTC (vira o dia em quem não está em UTC)',
        # 🪤 o servidor roda em UTC: sem forçar o fuso do CLIENTE, este defeito passa despercebido.
        env={'TZ': 'America/Los_Angeles'},
    ),
    dict(
        nome='eta-aceita-sem-base',
        arquivo='features/driver/eta.ts',
        de='temBase: daRota != null || temPosicao,',
        para='temBase: true,',
        testes=['__tests__/eta.test.ts'],
        porque='ETA volta a mostrar número inventado quando a rota não foi cronometrada',
    ),
    dict(
        nome='irmaos-em-motoricos-diferentes',
        arquivo='features/dispatch/routeSuggestion.ts',
        de='cao.clientId ? `c:${cao.clientId}` : `d:${cao.dogId}`',
        para='`d:${cao.dogId}`',
        testes=['__tests__/fuzz-operacao.test.ts'],
        porque='irmãos da mesma casa caem em vans diferentes',
    ),
    # ----------------------------------------------------------------------------------------------
    # Lote de 02/10/2026 (2ª frente): mutações sobre recorrência/fuso, fila offline, contadores do
    # dia e importação do Google — cada uma tem de ser PEGA pelos testes NOVOS que cobrem o módulo.
    # ----------------------------------------------------------------------------------------------
    dict(
        nome='recorrencia-ignora-transport-on',
        arquivo='features/calendar/dayMath.ts',
        de="    if (exception.action === 'transport_on') transport = true;",
        para="    if (exception.action === 'transport_on') transport = transport;",
        testes=['__tests__/dayMath.test.ts', '__tests__/fuso-recorrencia-propriedade.test.ts'],
        porque='a exceção transport_on deixa de ligar o transporte: a van não busca o cão naquele dia',
    ),
    dict(
        nome='serie-passado-do-fim-nao-para',
        arquivo='features/calendar/dayMath.ts',
        de="    if (schedule.endDate && isoDate > schedule.endDate) continue;\n    if (!schedule.weekdays.includes(weekday)) continue;",
        para="    if (false) continue;\n    if (!schedule.weekdays.includes(weekday)) continue;",
        testes=['__tests__/fuso-recorrencia-propriedade.test.ts'],
        porque='série com endDate continua aparecendo depois de terminar (agenda eterna)',
    ),
    dict(
        nome='fila-offline-descarta-por-qualquer-erro',
        arquivo='features/driver/pendingWrites.ts',
        de='      if (isDefinitiveWriteRefusal(reason)) {',
        para='      if (true) {',
        testes=['__tests__/pendingWrites.test.ts', '__tests__/fila-offline-propriedade.test.ts'],
        porque='qualquer erro (inclusive organização indisponível) apaga o registro da fila em silêncio',
    ),
    dict(
        nome='contagem-do-dia-conta-sem-dedupe',
        arquivo='features/dashboard/dayService.ts',
        de="  const caes = dogsOfDaySummary(dia);\n  return {\n    daycare: caes.filter((cao) => cao.serviceType === 'daycare').length,\n    boarding: caes.filter((cao) => cao.serviceType === 'boarding').length,\n  };",
        para="  return {\n    daycare: dia.daycare.filter((item) => !item.paused).length,\n    boarding: dia.boarding.filter((item) => !item.paused).length,\n  };",
        testes=['__tests__/dia-operacao-agente2.test.ts', '__tests__/contadores-do-dia-propriedade.test.ts'],
        porque='a contagem volta a não deduplicar: cão em boarding E daycare conta duas vezes',
    ),
    dict(
        nome='importacao-fim-invertido',
        arquivo='features/integrations/google/importPlan.ts',
        de="  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(endDate)) return startDate;\n  return endDate < startDate ? startDate : endDate;",
        para="  return endDate;",
        testes=['__tests__/importacao-fim-hora-independente.test.ts', '__tests__/importacao-google-propriedade.test.ts'],
        porque='volta o defeito de produção: end_date antes do start_date derruba o insert inteiro no banco',
    ),
    dict(
        nome='importacao-dois-caes-vira-um',
        arquivo='features/integrations/google/importPlan.ts',
        de='  return nomes.map((dogName) => ({',
        para='  return nomes.slice(0, 1).map((dogName) => ({',
        testes=['__tests__/importacao-dois-caes-agente2.test.ts', '__tests__/importacao-google-propriedade.test.ts'],
        porque='evento com DOIS cães cria reserva só para o primeiro (o outro cão perde o dia)',
    ),
]


def rodar(caso: dict) -> dict:
    alvo = RAIZ / caso['arquivo']
    if not alvo.exists():
        return {'nome': caso['nome'], 'resultado': 'ARQUIVO AUSENTE', 'detalhe': caso['arquivo']}
    original = alvo.read_text(encoding='utf-8')
    if caso['de'] not in original:
        return {
            'nome': caso['nome'],
            'resultado': 'NAO APLICOU',
            'detalhe': f"texto nao encontrado em {caso['arquivo']}: {caso['de'][:60]}",
        }
    BACKUP.mkdir(exist_ok=True)
    (BACKUP / alvo.name).write_text(original, encoding='utf-8')
    try:
        alvo.write_text(original.replace(caso['de'], caso['para'], 1), encoding='utf-8')
        ambiente = dict(os.environ, **(caso.get('env') or {}))
        proc = subprocess.run(
            ['npx', 'jest', *caso['testes'], '--runInBand', '--silent'],
            cwd=RAIZ, capture_output=True, text=True, timeout=900, env=ambiente,
        )
        pegou = proc.returncode != 0
        falhas = [linha.strip() for linha in proc.stdout.splitlines() if linha.strip().startswith('✕')][:4]
        return {
            'nome': caso['nome'],
            'arquivo': caso['arquivo'],
            'porque': caso['porque'],
            'resultado': ('PEGOU' if pegou else 'PASSOU (teste fraco)'),
            'testes': caso['testes'],
            'neutra': bool(caso.get('neutra')),
            'falhas': falhas,
        }
    finally:
        alvo.write_text(original, encoding='utf-8')


def main() -> int:
    filtro = sys.argv[1] if len(sys.argv) > 1 else None
    casos = [c for c in CASOS if not filtro or filtro in c['nome']]
    resultados = []
    for caso in casos:
        sys.stderr.write(f"· {caso['nome']} ... ")
        sys.stderr.flush()
        resultado = rodar(caso)
        resultados.append(resultado)
        sys.stderr.write(f"{resultado['resultado']}\n")

    print(json.dumps(resultados, ensure_ascii=False, indent=2))
    plantadas = [r for r in resultados if not r.get('neutra') and r['resultado'] in ('PEGOU', 'PASSOU (teste fraco)')]
    pegas = [r for r in plantadas if r['resultado'] == 'PEGOU']
    print('=' * 78)
    print(f'DEFEITOS PLANTADOS: {len(plantadas)} | PEGOS PELOS TESTES: {len(pegas)}')
    for r in plantadas:
        if r['resultado'] != 'PEGOU':
            print(f"  ⚠️ SOBREVIVEU: {r['nome']} ({r['arquivo']}) — {r['porque']}")
    neutras = [r for r in resultados if r.get('neutra')]
    for r in neutras:
        print(f"  (controle neutro {r['nome']}: {r['resultado']})")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
