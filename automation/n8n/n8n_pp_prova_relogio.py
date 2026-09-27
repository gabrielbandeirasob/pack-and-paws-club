"""Prova ao vivo do relógio do n8n: encurta para 1 minuto, espera um ciclo, confere o NÓ (não o status).

Skill do n8n: `status=success` não prova nada — o que prova é o `runData` do nó HTTP ter 1 item com
`statusCode` 200 e o corpo da função. Depois o intervalo volta para 15 minutos.
"""
import json
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
N8N = env['N8N_URL'].rstrip('/')
CHAVE = env['N8N_API_KEY']
WF = json.load(open('/opt/data/tmp/n8n_pp_cron.json'))['id']

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
        return e.code, e.read().decode()[:300]

def com_intervalo(minutos):
    st, wf = api('GET', f'/workflows/{WF}')
    for no in wf['nodes']:
        if no['type'] == 'n8n-nodes-base.scheduleTrigger':
            no['parameters']['rule']['interval'][0]['minutesInterval'] = minutos
    corpo = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
             'settings': ({'errorWorkflow': wf['settings']['errorWorkflow']} if (wf.get('settings') or {}).get('errorWorkflow') else {})}
    return api('PUT', f'/workflows/{WF}', corpo)[0]

print('1) encurtar o intervalo para 1 min ->', com_intervalo(1))
print('   esperando um ciclo...'); time.sleep(80)

st, execucoes = api('GET', f'/executions?workflowId={WF}&limit=5')
lista = execucoes if isinstance(execucoes, list) else (execucoes or {}).get('data', [])
print('2) execucoes do workflow:', [(e['id'], e.get('status')) for e in lista[:3]])
if lista:
    st, detalhe = api('GET', f"/executions/{lista[0]['id']}?includeData=true")
    rodadas = ((detalhe or {}).get('data') or {}).get('resultData', {}).get('runData', {})
    for nome_no, execucoes_no in rodadas.items():
        for execucao in execucoes_no:
            itens = (execucao.get('data') or {}).get('main', [[]])[0]
            resumo = []
            for item in itens:
                j = item.get('json', {})
                resumo.append({k: j.get(k) for k in ('statusCode', 'body') if k in j})
            print(f"   no '{nome_no}': {len(itens)} item(ns)", resumo[:1])
else:
    print('   NENHUMA execucao: o relogio nao disparou')

print('3) devolver o intervalo para 15 min ->', com_intervalo(15))
st, wf = api('GET', f'/workflows/{WF}')
for no in wf['nodes']:
    if no['type'] == 'n8n-nodes-base.scheduleTrigger':
        print('   intervalo agora:', no['parameters']['rule']['interval'], '| ativo:', wf.get('active'))
