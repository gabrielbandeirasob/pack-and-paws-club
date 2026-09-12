# Suporte e releases — Pack & Paws Club

**Para quem opera o app no dia a dia** · atualizado em 12/09/2026

## 1. Como saber que algo quebrou (antes do cliente reclamar)

O app agora **registra os erros sozinho**. Nada de esperar print.

```sql
-- no SQL Editor do Supabase (projeto bhuexxjcrjdhkmsvagdw)
select created_at, platform, app_version, message
from client_errors
order by created_at desc
limit 20;
```

- Só o **gestor da organização** consegue ler (RLS). O motorista não vê erros de ninguém.
- O relatório **não carrega dado de cliente** nem código de portão: o app descarta chaves
  sensíveis antes de gravar (tem teste garantindo isso).
- Se um dia contratarem Sentry, o envio passa a apontar para lá e esta tabela vira histórico.

**O que fazer ao ver um erro:** olhar `message` e `app_version`. Se o erro for de uma versão
antiga, provavelmente já foi corrigido — peça para o motorista atualizar no TestFlight.

## 2. Publicar uma versão nova (roteiro)

```bash
cd /opt/data/pack-and-paws/mobile

# 1) portão de qualidade — os três tem de passar antes de qualquer build
npx jest --runInBand          # testes (hoje: 262)
npx tsc --noEmit              # tipos
node scripts/db-flows-test.mjs # RLS e fluxos de banco (hoje: 46 casos)

# 2) subir o número da versão quando for release de loja (ex.: 1.0.0 -> 1.1.0)
#    editar app.json -> expo.version

# 3) build iOS de producao (o EAS sobe o número do build sozinho)
EAS_BIN=$(ls -d /opt/data/home/.npm/_npx/*/node_modules/.bin/eas | head -1)
"$EAS_BIN" build --platform ios --profile production --non-interactive

# 4) enviar para a App Store Connect (baixa o IPA, sobe e espera ficar VALID)
/opt/data/apple-venv/bin/python /opt/data/pack-and-paws/build/publish_build2.py
```

- TestFlight: os testadores do grupo "Testers externos" recebem a build sozinhos.
- App Store: só depois de 1.0 aprovado se cria a versão 1.1 (a Apple não deixa duas
  versões em revisão ao mesmo tempo).
- **Não** é preciso repetir a ficha do app (nome, descrição, telas) a cada versão: só o que
  mudou. As telas ficam presas à versão que foi submetida.

## 3. Banco de dados (migrações)

As migrações ficam em `supabase/migrations/` e são aplicadas pela API de administração.
Ordem do que existe hoje (todas já aplicadas):

| Migração | O que faz |
|---|---|
| `202609110014_fix_rls_recursion_dogs_clients` | corrige a recursão infinita de RLS (cães↔clientes) |
| `202609110015_harden_routes_policy` | endurece a política de rotas (comparação errada) |
| `202609120016_push_device_tokens` | push: `device_tokens` + trigger que avisa o motorista |
| `202609120017_client_errors` | registro de erros do app |
| `202609120018_concorrencia_rotas` | `lock_version`: dois gestores não se sobrescrevem |

**Regra:** mexeu no banco → rodar `node scripts/db-flows-test.mjs` (ele simula o usuário
real dentro de transação com rollback e falha se algo persistir).

## 4. Notificações push (ligado)

- Tabela `device_tokens`: cada aparelho registra o token ao entrar; sai ao deslogar.
- Trigger `routes_notify_driver`: quando a rota é **publicada** (ou cancelada), o banco chama a
  Expo Push API. Sai mesmo se o gestor fechar o app.
- Mensagem **sem dado sensível**: só a contagem de paradas e o id da rota.
- Testar: publicar uma rota com um motorista que já abriu o app no aparelho.

## 5. Trânsito real (ligar quando houver conta Google)

Hoje o otimizador usa **linha reta + velocidade média** (funciona, é estimativa). Para usar o
tempo real de rua:

1. Google Cloud: habilitar **Routes API** e a cobrança; criar uma chave **de servidor**
   (não use a mesma chave do Maps SDK que vai no app).
2. `supabase secrets set GOOGLE_ROUTES_KEY=... --project-ref bhuexxjcrjdhkmsvagdw`
3. `supabase functions deploy travel-times --project-ref bhuexxjcrjdhkmsvagdw`
4. Nada muda no app: ele já chama a função e, se ela não responder em 4 s, cai na estimativa.
   Na tela, o alerta do "Optimize" diz `(live traffic)` ou `(estimated times)`.

## 6. Ícones e logo

```bash
python3 scripts/make-app-icons.py --check                    # audita os atuais
python3 scripts/make-app-icons.py --source logo-em-alta.png   # regenera tudo
```

⚠️ O logo disponível hoje tem **100×100** — o ícone sai ampliado/macio. Pedir ao cliente o
**arquivo original** (SVG ou PNG grande). Com ele, o comando acima resolve em um passo.

## 7. Situação conhecida (o que ainda depende de terceiros)

| Item | Depende de | Impacto |
|---|---|---|
| Trânsito real | conta Google Cloud + cobrança | estimativa em vez de tempo de rua |
| Logo em alta resolução | cliente | ícone macio |
| Endereço inicial das vans / destino padrão | decisão do cliente (plano §25) | otimização de rota incompleta |
| Push no aparelho dos motoristas | eles abrirem o app uma vez | sem aviso automático |
| Versão 1.1 na loja | aprovação da 1.0 | features novas só no TestFlight |
