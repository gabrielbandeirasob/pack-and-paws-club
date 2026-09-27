"""Liga o RELÓGIO da importação do Google Calendar no n8n (27/09/2026).

Por que no n8n e não na Supabase: o projeto do Pack & Paws não tem `pg_cron` habilitado, e a regra da
casa é não usar cron local — o n8n auto-hospedado é o relógio oficial.

O que o workflow faz: a cada 15 minutos chama a função `google-calendar-sync` com o segredo no header
`x-cron-secret`. Nada de regra de negócio aqui: quem importa é a função.

Prova (não é o status da execução): o script encurta o intervalo para 1 minuto por um ciclo, lê o
`runData` do nó HTTP (tem de ter 1 item com status 200) e devolve o intervalo para 15 minutos.
"""
import json
import os
import time
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
cron = ler_env('/opt/data/.secrets/packpaws-cron-google.txt')
N8N = env['N8N_URL'].rstrip('/')
CHAVE = env['N8N_API_KEY']
URL_FUNCAO = cron['URL']
SEGREDO = cron['CRON_SECRET']
NOME = 'Pack & Paws — importação do Google Calendar (relógio)'
NOME_CRED = 'Pack & Paws — x-cron-secret'

def api(metodo, rota, corpo=None, limite=100000):
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
            return e.code, texto[:300]

def credencial_do_header():
    st, lista = api('GET', '/credentials?limit=100')
    for c in (lista if isinstance(lista, list) else lista.get('data', [])):
        if c.get('name') == NOME_CRED:
            return c['id']
    st, criada = api('POST', '/credentials', {'name': NOME_CRED, 'type': 'httpHeaderAuth', 'data': {'name': 'x-cron-secret', 'value': SEGREDO}})
    if st not in (200, 201):
        raise SystemExit(f'nao consegui criar a credencial: {st} {criada}')
    return criada['id']

def workflow_json(cred_id, minutos=15, error_workflow=None):
    return {
        'name': NOME,
        'nodes': [
            {
                'parameters': {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': minutos}]}},
                'id': 'relogio',
                'name': 'A cada 15 minutos',
                'type': 'n8n-nodes-base.scheduleTrigger',
                'typeVersion': 1.2,
                'position': [220, 300],
            },
            {
                'parameters': {
                    'method': 'POST',
                    'url': URL_FUNCAO,
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
                'position': [520, 300],
                'credentials': {'httpHeaderAuth': {'id': cred_id, 'name': NOME_CRED}},
            },
        ],
        'connections': {'A cada 15 minutos': {'main': [[{'node': 'Importar do Google', 'type': 'main', 'index': 0}]]}},
        'settings': ({'errorWorkflow': error_workflow} if error_workflow else {}),
    }

def id_por_nome(rota, nome):
    st, lista = api('GET', rota)
    itens = lista if isinstance(lista, list) else (lista or {}).get('data', [])
    for item in itens:
        if item.get('name') == nome:
            return item['id']
    return None

def main():
    cred = credencial_do_header()
    print('credencial do header:', cred)

    st, lista = api('GET', '/workflows?limit=100')
    itens = lista if isinstance(lista, list) else (lista or {}).get('data', [])
    existente = next((w for w in itens if w.get('name') == NOME), None)
    erro = next((w.get('id') for w in itens if 'Error' in (w.get('name') or '') or 'erro' in (w.get('name') or '').lower()), None)
    print('tratador de erro encontrado:', erro)

    corpo = workflow_json(cred, 15, erro)
    if existente:
        st, resp = api('PUT', f"/workflows/{existente['id']}", corpo)
        wf_id = existente['id']
    else:
        st, resp = api('POST', '/workflows', corpo)
        wf_id = (resp or {}).get('id')
    print('gravar workflow ->', st, '| id:', wf_id)
    print('ativar ->', api('POST', f'/workflows/{wf_id}/activate')[0])
    st, atual = api('GET', f'/workflows/{wf_id}')
    print('estado:', {'name': atual.get('name'), 'active': atual.get('active'),
                      'nos': [n['name'] for n in atual.get('nodes', [])],
                      'errorWorkflow': (atual.get('settings') or {}).get('errorWorkflow')})
    json.dump({'id': wf_id, 'cred': cred}, open('/opt/data/tmp/n8n_pp_cron.json', 'w'))
    print('workflow id guardado em /opt/data/tmp/n8n_pp_cron.json')

if __name__ == '__main__':
    main()
