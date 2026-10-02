"""Pendência #4 da auditoria do Pack & Paws — trava de execução + retry no relógio do n8n.

Achado: o workflow 'Pack & Paws — importação do Google Calendar (relógio)' podia rodar em
paralelo consigo mesmo e não tinha retry em falha.

Forma escolhida (explicada no relatório): esta instância do n8n NÃO tem opção nativa de
'concorrência por workflow' (só o limite global N8N_CONCURRENCY_PRODUCTION_LIMIT, que afetaria
AutoNest/GLPI também). E não há credencial Postgres/Redis do projeto Pack & Paws nesta instância,
então `pg_try_advisory_lock` não é aplicável por aqui.

Solução: o próprio workflow pergunta à API pública do n8n se JÁ existe execução EM CURSO dele
(GET /api/v1/executions?workflowId=...&status=running), descarta a si próprio pelo $execution.id e,
com um nó IF, encerra cedo quando outra já está rodando. É fail-open: se a checagem falhar, a
importação segue (não deixa o robô parado por causa da trava).
"""
import json
import os
import urllib.error
import urllib.request

def ler_env(caminho):
    d = {}
    for linha in open(caminho, encoding='utf-8'):
        if '=' in linha and not linha.startswith('#'):
            k, v = linha.split('=', 1)
            d[k.strip()] = v.strip().strip('"')
    return d

env = ler_env('/opt/data/.env')
N8N = env['N8N_URL'].rstrip('/')
CHAVE = env['N8N_API_KEY']
NOME = 'Pack & Paws — importação do Google Calendar (relógio)'
NOME_CRED_CRON = 'Pack & Paws — x-cron-secret'
NOME_CRED_API = 'Pack & Paws — n8n API (trava de execução)'
SAIDA = '/opt/data/pack-and-paws/mobile/automation/n8n/relogio-importacao-google.json'

def api(metodo, rota, corpo=None, limite=200000):
    req = urllib.request.Request(
        f'{N8N}/api/v1{rota}',
        data=(json.dumps(corpo).encode() if corpo is not None else None),
        method=metodo,
        headers={'X-N8N-API-KEY': CHAVE, 'Content-Type': 'application/json', 'User-Agent': 'hermes-n8n/1.0'},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            texto = r.read().decode()
            return r.status, (json.loads(texto) if texto else None)
    except urllib.error.HTTPError as e:
        texto = e.read().decode()
        try:
            return e.code, json.loads(texto)
        except Exception:
            return e.code, texto[:400]

def credencial(nome, tipo, data):
    st, lista = api('GET', '/credentials?limit=100')
    itens = lista if isinstance(lista, list) else (lista or {}).get('data', [])
    for c in itens:
        if c.get('name') == nome and c.get('type') == tipo:
            return c['id']
    st, criada = api('POST', '/credentials', {'name': nome, 'type': tipo, 'data': data})
    if st not in (200, 201):
        raise SystemExit(f'nao consegui criar a credencial {nome}: {st} {criada}')
    return criada['id']

# --- ICONE DO CODIGO DA TRAVA (roda no nó Code) ---------------------------------------------
JS_TRAVA = r"""
// Pendência #4: trava de execução paralela do relógio do Google Calendar.
// A API do n8n (nó anterior) devolve {"data":[execuções em curso], "nextCursor":...}.
// Regra: se existe OUTRA execução deste workflow em curso, encerra cedo (IF -> false).
// Fail-open: se a checagem não veio em formato esperado, libera (não deixa o robô travado).
const bruto = $json;
const corpo = (bruto && bruto.data !== undefined) ? bruto.data : bruto;
const lista = Array.isArray(corpo) ? corpo : (Array.isArray(bruto && bruto.data) ? bruto.data : null);
const eu = String($execution.id);
if (lista === null) {
  return [{ json: { podeRodar: true, motivo: 'checagem indisponivel (fail-open)', execucoes: [] } }];
}
const outras = lista.filter((e) => e && String(e.id) !== eu);
return [{ json: {
  podeRodar: outras.length === 0,
  motivo: outras.length === 0 ? 'nenhuma outra execucao em curso' : 'ja existe execucao em curso',
  execucoes: outras.map((e) => String(e.id)),
} }];
""".strip()

def montar(wf_id, cred_cron, cred_api, erro):
    return {
        'name': NOME,
        'nodes': [
            {
                'parameters': {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': 15}]}},
                'id': 'relogio',
                'name': 'A cada 15 minutos',
                'type': 'n8n-nodes-base.scheduleTrigger',
                'typeVersion': 1.2,
                'position': [220, 300],
            },
            {
                'parameters': {
                    'method': 'GET',
                    'url': f'{N8N}/api/v1/executions?workflowId={wf_id}&status=running&limit=20',
                    'authentication': 'genericCredentialType',
                    'genericAuthType': 'httpHeaderAuth',
                    'options': {},
                },
                'id': 'ver-execucoes',
                'name': 'Já tem execução em curso?',
                'type': 'n8n-nodes-base.httpRequest',
                'typeVersion': 4.2,
                'position': [460, 160],
                # Fail-open: se a checagem falhar, NÃO derruba o robô nem bloqueia a importação.
                'onError': 'continueRegularOutput',
                'credentials': {'httpHeaderAuth': {'id': cred_api, 'name': NOME_CRED_API}},
            },
            {
                'parameters': {'jsCode': JS_TRAVA},
                'id': 'trava',
                'name': 'Trava de execução',
                'type': 'n8n-nodes-base.code',
                'typeVersion': 2,
                'position': [680, 160],
            },
            {
                'parameters': {
                    'conditions': {
                        'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 2},
                        'conditions': [
                            {
                                'id': 'pode',
                                'leftValue': '={{ $json.podeRodar }}',
                                'rightValue': '',
                                'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True},
                            }
                        ],
                        'combinator': 'and',
                    },
                    'options': {},
                },
                'id': 'pode-importar',
                'name': 'Pode importar?',
                'type': 'n8n-nodes-base.if',
                'typeVersion': 2.2,
                'position': [900, 300],
            },
            {
                'parameters': {
                    'method': 'POST',
                    'url': 'https://bhuexxjcrjdhkmsvagdw.supabase.co/functions/v1/google-calendar-sync',
                    'sendHeaders': True,
                    'headerParameters': {'parameters': [{'name': 'Content-Type', 'value': 'application/json'}]},
                    'sendBody': True,
                    'specifyBody': 'json',
                    'jsonBody': '{}',
                    'options': {'timeout': 120000},
                    'authentication': 'genericCredentialType',
                    'genericAuthType': 'httpHeaderAuth',
                },
                'id': 'chama-importacao',
                'name': 'Importar do Google',
                'type': 'n8n-nodes-base.httpRequest',
                'typeVersion': 4.2,
                'position': [1140, 300],
                'credentials': {'httpHeaderAuth': {'id': cred_cron, 'name': NOME_CRED_CRON}},
                # Pendência #4: retry em falha — 3 tentativas, 5 s entre elas.
                'retryOnFail': True,
                'maxTries': 3,
                'waitBetweenTries': 5000,
            },
        ],
        'connections': {
            'A cada 15 minutos': {'main': [[{'node': 'Já tem execução em curso?', 'type': 'main', 'index': 0}]]},
            'Já tem execução em curso?': {'main': [[{'node': 'Trava de execução', 'type': 'main', 'index': 0}]]},
            'Trava de execução': {'main': [[{'node': 'Pode importar?', 'type': 'main', 'index': 0}]]},
            'Pode importar?': {'main': [[{'node': 'Importar do Google', 'type': 'main', 'index': 0}]]},
        },
        'settings': ({'errorWorkflow': erro} if isinstance(erro, str) and erro else {}),
    }

def main():
    cred_cron = credencial(NOME_CRED_CRON, 'httpHeaderAuth', {'name': 'x-cron-secret', 'value': ler_env('/opt/data/.secrets/packpaws-cron-google.txt')['CRON_SECRET']})
    cred_api = credencial(NOME_CRED_API, 'httpHeaderAuth', {'name': 'X-N8N-API-KEY', 'value': CHAVE})
    print('credencial x-cron-secret:', cred_cron)
    print('credencial n8n API (trava):', cred_api)

    st, lista = api('GET', '/workflows?limit=100')
    itens = lista if isinstance(lista, list) else (lista or {}).get('data', [])
    existente = next((w for w in itens if w.get('name') == NOME), None)
    if not existente:
        raise SystemExit('workflow nao encontrado pelo nome')
    wf_id = existente['id']
    erro = (existente.get('settings') or {}).get('errorWorkflow')
    print('workflow id:', wf_id, '| errorWorkflow preservado:', erro)

    json.dump(existente, open('/opt/data/tmp/pend4-antes.json', 'w'), indent=2, ensure_ascii=False)

    corpo = montar(wf_id, cred_cron, cred_api, erro)
    st, resp = api('PUT', f'/workflows/{wf_id}', corpo)
    print('PUT workflow ->', st)
    if st >= 300:
        raise SystemExit(f'falhou: {resp}')

    st, atual = api('GET', f'/workflows/{wf_id}')
    json.dump(atual, open('/opt/data/tmp/pend4-depois.json', 'w'), indent=2, ensure_ascii=False)
    print('== estado depois ==')
    print('name:', atual.get('name'), '| active:', atual.get('active'), '| errorWorkflow:', (atual.get('settings') or {}).get('errorWorkflow'))
    for n in atual['nodes']:
        print(f"  - {n['name']!r} tipo={n['type']} retryOnFail={n.get('retryOnFail')} maxTries={n.get('maxTries')} waitBetweenTries={n.get('waitBetweenTries')} onError={n.get('onError')}")
    print('conexoes:', json.dumps(atual.get('connections'), ensure_ascii=False))

    # versiona a fonte de verdade no repo (mesmo JSON, sem tocar no app)
    doc = montar(wf_id, cred_cron, cred_api, erro)
    json.dump(doc, open(SAIDA, 'w'), indent=2, ensure_ascii=False)
    print('JSON versionado atualizado:', SAIDA, '|', os.path.getsize(SAIDA), 'bytes')
    json.dump({'id': wf_id}, open('/opt/data/tmp/n8n_pp_cron.json', 'w'))

if __name__ == '__main__':
    main()
