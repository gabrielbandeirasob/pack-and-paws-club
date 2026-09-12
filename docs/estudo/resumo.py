"""Imprime um resumo enxuto dos relatorios de concorrentes (para escrever o estudo).

Uso: resumo.py <produto|precos|tabela|oportunidades|onfleet> [limite_itens]
"""
import json, sys, textwrap

BASE = '/opt/data/pack-and-paws/estudo/'


def carrega(nome):
    return json.load(open(BASE + nome + '.json', encoding='utf-8'))


def lista(titulo, itens, limite=30, largura=150):
    if not itens:
        return
    print(f'\n### {titulo} ({len(itens)})')
    for i in itens[:limite]:
        if isinstance(i, dict):
            i = ' | '.join(f'{k}={v}' for k, v in i.items())
        texto = str(i).replace('\n', ' ')
        print('  - ' + textwrap.shorten(texto, width=largura, placeholder=' (...)'))


def texto(titulo, valor, largura=400):
    if not valor:
        return
    print(f'\n### {titulo}')
    print('  ' + textwrap.shorten(str(valor).replace('\n', ' '), width=largura, placeholder=' (...)'))


alvo = sys.argv[1] if len(sys.argv) > 1 else 'precos'

if alvo == 'precos':
    ttp = carrega('time-to-pet')
    gin = carrega('gingr')
    moe = carrega('moego')
    onf = carrega('onfleet')
    texto('TIME TO PET - posicionamento', ttp.get('posicionamento'))
    lista('TIME TO PET - precos', ttp.get('precos'), 10)
    texto('TIME TO PET - pagamentos', ttp.get('pagamentos'))
    texto('GINGR - preco', gin.get('precos'))
    texto('MOEGO - preco', moe.get('moego_precos'))
    texto('DAYS SMART - preco', moe.get('daysmart_precos'))
    lista('OUTROS - precos', moe.get('outros_precos'), 12)
    texto('ONFLEET - preco', onf.get('preco'))

elif alvo == 'tabela':
    for nome, rotulo in [('time-to-pet', 'TIME TO PET'), ('gingr', 'GINGR'), ('moego', 'MOEGO/OUTROS'), ('onfleet', 'ONFLEET')]:
        d = carrega(nome)
        print(f'\n\n========== {rotulo} ==========')
        for chave in ['funcionalidades_cliente', 'funcionalidades_equipe', 'funcionalidades_financeiro', 'funcionalidades_despacho', 'app_motorista', 'rastreio_e_comunicacao', 'operacao_dia_a_dia', 'gestao_relatorios', 'operacao', 'financeiro', 'recursos_modernos']:
            if d.get(chave):
                lista(f'{rotulo} · {chave}', d[chave], 14, 140)

elif alvo == 'tabela':
    pass

elif alvo == 'obrigatorias':
    moe = carrega('moego')
    lista('OBRIGATORIAS NO RAMO HOJE (table stakes)', moe.get('obrigatorias_table_stakes'), 30, 160)

elif alvo == 'oportunidades':
    moe = carrega('moego')
    onf = carrega('onfleet')
    lista('OPORTUNIDADES (o que ninguem faz bem)', moe.get('oportunidades'), 20, 170)
    lista('ONFLEET - copiar para o nosso caso', onf.get('copiar_para_nosso_caso'), 20, 170)
    lista('ONFLEET - NAO copiar', onf.get('nao_copiar'), 20, 170)

elif alvo == 'reclamacoes':
    for nome, rotulo in [('time-to-pet', 'TIME TO PET'), ('gingr', 'GINGR'), ('moego', 'MOEGO/OUTROS'), ('onfleet', 'ONFLEET')]:
        d = carrega(nome)
        lista(f'{rotulo} - reclamacoes', d.get('reclamacoes'), 6, 160)
        lista(f'{rotulo} - pontos fracos', d.get('pontos_fracos'), 6, 160)

elif alvo == 'portal':
    d = carrega('portal-pag')
    lista('PORTAL DO CLIENTE - OBRIGATORIO', d.get('portal_cliente_obrigatorio'), 20, 170)
    lista('PORTAL DO CLIENTE - DESEJAVEL', d.get('portal_cliente_desejavel'), 20, 170)
    lista('COBRANCA - modelos', d.get('cobranca_modelos'), 20, 170)
    lista('CONFORMIDADE EUA', d.get('conformidade'), 12, 170)
    lista('PRECISA ENTIDADE EUA', d.get('requer_entidade_eua'), 12, 170)
    texto('STRIPE', d.get('stripe_detalhes'), 500)
    lista('ERROS COMUNS', d.get('erros_comuns'), 12, 170)
    lista('IMPLEMENTACAO - passos', d.get('recomendacao_implementacao'), 12, 170)
