#!/usr/bin/env node
/**
 * Suite de integracao do banco (RLS + fluxos do app).
 *
 * Por que existe: o bug que apareceu em campo (erro 42P17, "infinite recursion
 * detected in policy for relation dogs") nao aparece em teste unitario — ele só
 * aparece quando a RLS e de fato avaliada, com um usuario de verdade. Este script
 * reproduz cada fluxo do app como MANAGER, como DRIVER e como ANONIMO, dentro de
 * uma transacao que SEMPRE termina em ROLLBACK (nada fica gravado na base).
 *
 * Uso:
 *   node scripts/db-flows-test.mjs
 *
 * Credenciais (fora do repositorio):
 *   PACKPAWS_SUPABASE_TOKEN=...   (token de Management API do Supabase)
 *   PACKPAWS_SUPABASE_REF=bhuexxjcrjdhkmsvagdw
 *   ou deixe em /opt/data/.env que o script le sozinho.
 *
 * Saida: tabela PASS/FALHA + exit code 1 se qualquer caso falhar.
 */

import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

const ENV_FILE = process.env.PACKPAWS_ENV_FILE || '/opt/data/.env'
const REF = process.env.PACKPAWS_SUPABASE_REF || 'bhuexxjcrjdhkmsvagdw'

function loadEnv (path) {
  try {
    const out = {}
    for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    return out
  } catch { return {} }
}

const env = { ...loadEnv(ENV_FILE), ...process.env }
const TOKEN = env.PACKPAWS_SUPABASE_TOKEN
if (!TOKEN) {
  console.error('FALTA PACKPAWS_SUPABASE_TOKEN (env ou ' + ENV_FILE + ')')
  process.exit(2)
}

async function sql (query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 300) } }
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : JSON.stringify(data).slice(0, 300))
  return data
}

/** Executa um caso dentro de transacao com claims + role e devolve o ultimo SELECT. */
async function asUser (uid, role, body) {
  const claims = JSON.stringify({ sub: uid, role })
  const DQ = '$$' // dollar-quote do Postgres (nao confundir com template do JS)
  const query = [
    'begin;',
    `select set_config('request.jwt.claims', ${DQ}${claims}${DQ}, true);`,
    `set local role ${role};`,
    body,
    'rollback;'
  ].join('\n')
  return sql(query)
}

// ---------------------------------------------------------------- contexto
const ctx = (await sql(`
  -- TUDO da MESMA organizacao: escolhe uma org que tenha gestor ativo E rota publicada, e deriva
  -- o resto dela. Antes pegava "a org mais antiga" + "um gestor qualquer" + "uma rota qualquer" -
  -- com mais de uma org no banco isso misturava identidades e a suite acusava falha falsa
  -- (aconteceu em 12/09/2026, quando o teste de push publicou uma rota na org do cliente).
  with alvo as (
    select o.id
      from organizations o
      join organization_members m on m.organization_id = o.id and m.role = 'manager' and m.status = 'active'
     where exists (select 1 from routes r where r.organization_id = o.id and r.status = 'published')
     order by o.created_at
     limit 1
  ), rota as (
    select r.id, r.driver_id
      from routes r
     where r.organization_id = (select id from alvo) and r.status = 'published'
     order by r.route_date
     limit 1
  )
  select (select id from alvo) as org,
         (select user_id from organization_members where organization_id = (select id from alvo) and role='manager' and status='active' limit 1) as manager,
         (select driver_id from rota) as driver,
         (select id from rota) as route,
         (select r.driver_id from routes r where r.organization_id = (select id from alvo) and r.driver_id <> (select driver_id from rota) limit 1) as other_driver,
         (select s.dog_id from route_stops s where s.route_id = (select id from rota) limit 1) as stop_dog,
         (select d.client_id from dogs d where d.id = (select s.dog_id from route_stops s where s.route_id = (select id from rota) limit 1)) as stop_client,
         (select d.id from dogs d where d.id <> (select s.dog_id from route_stops s where s.route_id = (select id from rota) limit 1) limit 1) as free_dog,
         (select count(*) from clients) as n_clients,
         (select count(*) from dogs) as n_dogs,
         (select count(*) from reservations) as n_res,
         (select count(*) from routes) as n_routes,
         (select count(*) from route_stops) as n_stops,
         (select count(*) from recurring_schedules) as n_sched,
         (select count(*) from client_instructions) as n_instr,
         (select count(*) from device_tokens) as n_tokens,
         (select count(*) from client_errors) as n_errors;
`))[0]

const { org: ORG, manager: MANAGER, driver: DRIVER, route: ROUTE, other_driver: OTHER_DRIVER,
  stop_dog: STOP_DOG, stop_client: STOP_CLIENT, free_dog: FREE_DOG } = ctx

if (!ORG || !MANAGER || !ROUTE || !STOP_DOG) {
  console.error('Banco sem dados minimos para testar (precisa de org, manager e rota publicada).')
  process.exit(2)
}

const U = () => randomUUID()
let falhas = 0

async function caso (nome, quem, body, espera) {
  try {
    const r = await asUser(quem.uid, quem.role, body)
    const n = Array.isArray(r) && r.length && typeof r[r.length - 1]?.n === 'number' ? r[r.length - 1].n : null
    let ok
    if (espera === 'erro') ok = false
    else if (espera === 'n>0') ok = n !== null && n > 0
    else if (espera === 'n==0') ok = n === 0
    else ok = true
    const det = n !== null ? `n=${n}` : JSON.stringify(r).slice(0, 60)
    console.log(`${ok ? '  OK   ' : ' FALHA '} ${nome}  (${det})`)
    if (!ok) falhas++
  } catch (e) {
    const ok = espera === 'erro'
    console.log(`${ok ? '  OK   ' : ' FALHA '} ${nome}  (${ok ? 'recusado: ' : 'erro inesperado: '}${String(e.message).slice(0, 90)})`)
    if (!ok) falhas++
  }
}

const MGR = { uid: MANAGER, role: 'authenticated' }
const DRV = { uid: DRIVER, role: 'authenticated' }
const DRV2 = { uid: OTHER_DRIVER, role: 'authenticated' }
const ANON = { uid: '00000000-0000-0000-0000-000000000000', role: 'anon' }

console.log(`\nORG ${ORG}\nmanager ${MANAGER}\ndriver  ${DRIVER}\n`)

console.log('== MANAGER: cadastro e agenda ==')
await caso('cria cliente novo', MGR,
  `insert into clients (id, organization_id, name, source_contact_identifier) values ('${U()}','${ORG}','TESTE E2E ${Date.now()}','TESTE-E2E'); select 1 as n;`, 'ok')
await caso('cria cao para cliente existente', MGR,
  `insert into dogs (id, organization_id, client_id, name) values ('${U()}','${ORG}','${STOP_CLIENT}','TESTE E2E CAO'); select 1 as n;`, 'ok')
await caso('grava instrucoes de acesso', MGR,
  `insert into client_instructions (organization_id, client_id, pickup_access_instructions) values ('${ORG}','${STOP_CLIENT}','teste'); select 1 as n;`, 'ok')
await caso('cria reserva de daycare (hoje)', MGR,
  `insert into reservations (organization_id, dog_id, service_type, start_date, end_date, transport_required) values ('${ORG}','${FREE_DOG}','daycare',current_date,current_date,true); select 1 as n;`, 'ok')
await caso('cria reserva de boarding (intervalo)', MGR,
  `insert into reservations (organization_id, dog_id, service_type, start_date, end_date) values ('${ORG}','${FREE_DOG}','boarding',current_date,current_date+2); select 1 as n;`, 'ok')
await caso('cria agenda recorrente + excecao', MGR,
  `insert into recurring_schedules (organization_id, dog_id, weekdays) values ('${ORG}','${FREE_DOG}',array[1,3,5]);
   insert into recurring_exceptions (organization_id, recurring_schedule_id, action, start_date, end_date)
     select '${ORG}', id, 'skip', current_date, current_date from recurring_schedules where dog_id='${FREE_DOG}' limit 1;
   select 1 as n;`, 'ok')

console.log('\n== MANAGER: rota (draft -> publicada) ==')
const ROTA = U()
// ciclo completo numa unica transacao: a rota criada num caso nao existe no
// proximo (cada caso termina em rollback), entao o ciclo vai junto.
await caso('ciclo da rota: draft -> parada -> reordenar -> publicar', MGR,
  `insert into routes (id, organization_id, route_date, driver_id, status) values ('${ROTA}','${ORG}',current_date,'${DRIVER}','draft');
   select assign_stop_to_route('${ROTA}','${FREE_DOG}', null, null, null, 'normal');
   select reorder_route_stops('${ROTA}', array['${FREE_DOG}']::uuid[]);
   select publish_route('${ROTA}');
   select (case when status='published' then 1 else 0 end) as n from routes where id='${ROTA}';`, 'n>0')

console.log('\n== MANAGER: o que TEM de ser recusado ==')
await caso('cao apontando para cliente inexistente', MGR,
  `insert into dogs (id, organization_id, client_id, name) values ('${U()}','${ORG}','${U()}','TESTE INVALIDO'); select 1 as n;`, 'erro')
await caso('rota com usuario que nao e driver', MGR,
  `insert into routes (id, organization_id, route_date, driver_id, status) values ('${U()}','${ORG}',current_date,'${MANAGER}','draft'); select 1 as n;`, 'erro')
await caso('registro em organizacao inexistente', MGR,
  `insert into dogs (id, organization_id, client_id, name) values ('${U()}','${U()}','${STOP_CLIENT}','TESTE ORG FALSA'); select 1 as n;`, 'erro')

console.log('\n== DRIVER: a rota dele ==')
await caso('le a propria rota', DRV, `select count(*)::int as n from routes where id='${ROUTE}';`, 'n>0')
await caso('le as paradas da propria rota', DRV, `select count(*)::int as n from route_stops where route_id='${ROUTE}';`, 'n>0')
await caso('le o cliente da parada (endereco)', DRV, `select count(*)::int as n from clients where id='${STOP_CLIENT}';`, 'n>0')
await caso('le o cao da parada (nome)', DRV, `select count(*)::int as n from dogs where id='${STOP_DOG}';`, 'n>0')
await caso('marca a parada como arrived', DRV,
  `update route_stops set status='arrived' where route_id='${ROUTE}' and dog_id='${STOP_DOG}'; select 1 as n;`, 'ok')
await caso('grava a localizacao na rota ativa', DRV,
  `insert into driver_locations (route_id, organization_id, driver_id, latitude, longitude) values ('${ROUTE}','${ORG}','${DRIVER}',37.7749,-122.4194); select 1 as n;`, 'ok')

console.log('\n== DRIVER: o que ele NAO pode ver ==')
await caso('rota de outro motorista', DRV2, `select count(*)::int as n from routes where id='${ROUTE}';`, 'n==0')
await caso('paradas de outro motorista', DRV2, `select count(*)::int as n from route_stops where route_id='${ROUTE}';`, 'n==0')
await caso('cliente fora das rotas dele', DRV2, `select count(*)::int as n from clients where id='${STOP_CLIENT}';`, 'n==0')
await caso('localizacao de outro motorista', DRV2, `select count(*)::int as n from driver_locations where driver_id='${DRIVER}';`, 'n==0')
await caso('motorista tentando cadastrar cliente', DRV,
  `insert into clients (id, organization_id, name) values ('${U()}','${ORG}','TESTE DRIVER NAO PODE'); select 1 as n;`, 'erro')

console.log('\n== ANONIMO (sem login) ==')
await caso('nao le clientes', ANON, `select count(*)::int as n from clients;`, 'n==0')
await caso('nao le caes', ANON, `select count(*)::int as n from dogs;`, 'n==0')
await caso('nao le rotas', ANON, `select count(*)::int as n from routes;`, 'n==0')

console.log('\n== PUSH: token do aparelho (device_tokens) ==')
const TOKEN_TESTE = 'ExponentPushToken[SUITE-' + U().slice(0, 8) + ']'
// cada caso roda em transacao propria com rollback: inserir e ler tem de ficar no MESMO caso
await caso('motorista registra o aparelho e le de volta', DRV,
  `insert into device_tokens (organization_id, user_id, token, platform) values ('${ORG}','${DRIVER}','${TOKEN_TESTE}','ios');
   select count(*)::int as n from device_tokens where token='${TOKEN_TESTE}';`, 'n>0')
await caso('gerente NAO ve o token do motorista (troca de identidade no mesmo caso)', DRV,
  `insert into device_tokens (organization_id, user_id, token, platform) values ('${ORG}','${DRIVER}','${TOKEN_TESTE}-2','ios');
   select set_config('request.jwt.claims', json_build_object('sub','${MANAGER}','role','authenticated')::text, true);
   select count(*)::int as n from device_tokens where token='${TOKEN_TESTE}-2';`, 'n==0')
await caso('motorista NAO grava token em nome de outro', DRV,
  `insert into device_tokens (organization_id, user_id, token, platform) values ('${ORG}','${MANAGER}','ExponentPushToken[ROUBADO-${U().slice(0, 6)}]','ios'); select 1 as n;`, 'erro')
await caso('NAO grava token em organizacao alheia', DRV,
  `insert into device_tokens (organization_id, user_id, token, platform) values ('00000000-0000-0000-0000-000000000000','${DRIVER}','ExponentPushToken[ALHEIA-${U().slice(0, 6)}]','ios'); select 1 as n;`, 'erro')

// --- 019: a frase do aviso (data certa + ingles) ---
// Antes dizia "1 parada hoje" para rota de outro dia, e em portugues para um motorista americano.
console.log('\n== PUSH: frase do aviso (019) ==')
await caso('aviso: 1 parada hoje, em ingles',
  MGR, `select (public.push_route_body('route_published', current_date, 1) = '1 stop today. Tap to open.')::int as n;`, 'n>0')
await caso('aviso: 3 paradas amanha',
  MGR, `select (public.push_route_body('route_published', current_date + 1, 3) = '3 stops tomorrow. Tap to open.')::int as n;`, 'n>0')
await caso('aviso: rota de outra data NAO pode dizer "hoje"',
  MGR, `select (public.push_route_body('route_published', date '2026-09-09', 1) = '1 stop on Sep 9. Tap to open.')::int as n;`, 'n>0')
await caso('aviso: rota sem paradas',
  MGR, `select (public.push_route_body('route_published', current_date, 0) = 'Tap to open today''s route.')::int as n;`, 'n>0')
await caso('aviso: cancelada hoje',
  MGR, `select (public.push_route_body('route_cancelled', current_date, 1) = 'Your route for today was cancelled.')::int as n;`, 'n>0')
await caso('aviso: cancelada em outra data',
  MGR, `select (public.push_route_body('route_cancelled', date '2026-09-09', 1) = 'Your route for Sep 9 was cancelled.')::int as n;`, 'n>0')
await caso('aviso: nada de portugues sobrando na mensagem',
  MGR, `select (public.push_route_body('route_published', current_date, 2) !~* '(parada|hoje|cancelad|toque|rota )')::int as n;`, 'n>0')

console.log('\n== MONITORAMENTO: erros do app (client_errors) ==')
await caso('motorista registra erro e o gestor enxerga', DRV,
  `insert into client_errors (organization_id, user_id, app_version, platform, message, stack, context)
   values ('${ORG}','${DRIVER}','1.0.0','ios','erro de teste da suite','stack de teste','{"origem":"suite"}'::jsonb);
   select set_config('request.jwt.claims', json_build_object('sub','${MANAGER}','role','authenticated')::text, true);
   select count(*)::int as n from client_errors where message='erro de teste da suite';`, 'n>0')
await caso('motorista NAO le os erros da organizacao', DRV,
  `insert into client_errors (organization_id, user_id, message, platform) values ('${ORG}','${DRIVER}','erro invisivel','ios');
   select count(*)::int as n from client_errors where message='erro invisivel';`, 'n==0')
await caso('NAO da para gravar erro em nome de outro usuario', DRV,
  `insert into client_errors (organization_id, user_id, message, platform) values ('${ORG}','${MANAGER}','forjado','ios'); select 1 as n;`, 'erro')
await caso('anonimo nao grava nem le erros', ANON,
  `select count(*)::int as n from client_errors;`, 'n==0')

console.log('\n== CONCORRENCIA: dois gestores na mesma rota (lock_version) ==')
await caso('gestor reordena com a versao que leu', MGR,
  `select reorder_route_stops('${ROUTE}',
     (select array_agg(dog_id) from route_stops where route_id='${ROUTE}'),
     (select lock_version from routes where id='${ROUTE}'));
   select 1 as n;`, 'ok')
await caso('gestor com versao VELHA e recusado (nao sobrescreve)', MGR,
  `select reorder_route_stops('${ROUTE}',
     (select array_agg(dog_id) from route_stops where route_id='${ROUTE}'),
     (select lock_version from routes where id='${ROUTE}') + 99);
   select 1 as n;`, 'erro')
await caso('publicar com versao VELHA e recusado', MGR,
  `select publish_route('${ROUTE}', (select lock_version from routes where id='${ROUTE}') + 99); select 1 as n;`, 'erro')
await caso('publicar com a versao atual funciona', MGR,
  `select publish_route('${ROUTE}', (select lock_version from routes where id='${ROUTE}')); select 1 as n;`, 'ok')
await caso('app antigo (sem versao) continua publicando', MGR,
  `select publish_route('${ROUTE}'); select 1 as n;`, 'ok')
await caso('motorista nao reordena rota (so gestor)', DRV,
  `select reorder_route_stops('${ROUTE}', (select array_agg(dog_id) from route_stops where route_id='${ROUTE}')); select 1 as n;`, 'erro')

console.log('\n== INTEGRIDADE: nada pode ter ficado gravado ==')
const depois = (await sql(`
  select (select count(*) from clients) as n_clients, (select count(*) from dogs) as n_dogs,
         (select count(*) from reservations) as n_res, (select count(*) from routes) as n_routes,
         (select count(*) from route_stops) as n_stops, (select count(*) from recurring_schedules) as n_sched,
         (select count(*) from client_instructions) as n_instr, (select count(*) from device_tokens) as n_tokens,
         (select count(*) from client_errors) as n_errors;
`))[0]
for (const k of ['n_clients', 'n_dogs', 'n_res', 'n_routes', 'n_stops', 'n_sched', 'n_instr', 'n_tokens', 'n_errors']) {
  const igual = Number(depois[k]) === Number(ctx[k])
  console.log(`${igual ? '  OK   ' : ' FALHA '} ${k}: antes ${ctx[k]} / depois ${depois[k]}`)
  if (!igual) falhas++
}

console.log(`\n${falhas === 0 ? 'SUITE VERDE' : 'SUITE COM ' + falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
