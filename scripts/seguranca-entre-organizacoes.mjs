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


// ============================================================================
// MATRIZ DE SEGURANÇA AUTOMATIZADA — isolamento entre ORGANIZAÇÕES
//
// Por que existe (auditoria de 02/10/2026): o app é multi-tenant. Um defeito de RLS
// deixaria o gestor/motorista de UMA organização ler ou escrever os dados de OUTRA —
// e isso não aparece em teste unitário. Este script IMPERSONA o gestor e o motorista
// de OUTRA organização (membros ativos de verdade) e cobra 0 linhas nas tabelas
// principais do alvo, e recusa nas tentativas de escrita.
//
// Reaproveita o MESMO harness do `scripts/db-flows-test.mjs` (asUser/caso/rollback):
// as duas primeiras metades deste arquivo vieram de lá. Tudo roda em transação com
// ROLLBACK — nada fica gravado.
//
// Uso:  node scripts/seguranca-entre-organizacoes.mjs
//   (mesmas credenciais do db-flows: PACKPAWS_SUPABASE_TOKEN / PACKPAWS_SUPABASE_REF,
//    ou deixe em /opt/data/.env)
// Exit code 1 se QUALQUER caso de isolamento falhar.
// ============================================================================

const ctx = (await sql(`
  -- Alvo: uma organizacao COM DADOS (cliente cadastrado), e um gestor e um motorista
  -- ATIVOS de OUTRA organizacao — sao eles que tentam atravessar a fronteira.
  with alvo as (
    select o.id
      from organizations o
     where exists (select 1 from clients c where c.organization_id = o.id)
     order by o.created_at
     limit 1
  )
  select (select id from alvo) as org,
         (select m.user_id from organization_members m
           where m.status = 'active' and m.role = 'manager'
             and m.organization_id <> (select id from alvo)
           order by m.created_at limit 1) as foreign_manager,
         (select m.user_id from organization_members m
           where m.status = 'active' and m.role = 'driver'
             and m.organization_id <> (select id from alvo)
           order by m.created_at limit 1) as foreign_driver,
         (select count(*) from clients where organization_id = (select id from alvo)) as n_clients_alvo;
`))[0]

const { org: ORG, foreign_manager: FOREIGN_MANAGER, foreign_driver: FOREIGN_DRIVER, n_clients_alvo: N_CLIENTES } = ctx

if (!ORG || Number(N_CLIENTES) === 0) {
  console.error('Organizacao-alvo sem dados (precisa de um cliente cadastrado para a matriz valer).')
  process.exit(2)
}
if (!FOREIGN_MANAGER && !FOREIGN_DRIVER) {
  console.error('Nao existe membro ativo de OUTRA organizacao para impersonar — rode de novo com 2 orgs.')
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

const MGR_FORA = { uid: FOREIGN_MANAGER ?? FOREIGN_DRIVER, role: 'authenticated' }
const DRV_FORA = { uid: FOREIGN_DRIVER ?? FOREIGN_MANAGER, role: 'authenticated' }

/** O erro é uma RECUSA de isolamento (RLS/permissão)? Isso TAMBÉM é prova — "0 linhas ou erro". */
function ehRecusaDeIsolamento (e) {
  const m = String(e && e.message ? e.message : e)
  return /42501|row-level security|permission denied|insufficient privilege/i.test(m)
}

/**
 * Caso de isolamento: passa quando o forasteiro vê ZERO linha OU é recusado por RLS/permissão.
 * Um erro de SQL quebrado (ex.: coluna inexistente) NÃO passa — senão a matriz aprovaria a consulta
 * errada como se fosse segurança.
 */
async function casoIsolamento (nome, quem, body) {
  try {
    const r = await asUser(quem.uid, quem.role, body)
    const n = Array.isArray(r) && r.length && typeof r[r.length - 1]?.n === 'number' ? r[r.length - 1].n : null
    const ok = n === 0
    console.log(`${ok ? '  OK   ' : ' FALHA '} ${nome}  (n=${n})`)
    if (!ok) falhas++
  } catch (e) {
    const ok = ehRecusaDeIsolamento(e)
    console.log(`${ok ? '  OK   ' : ' FALHA '} ${nome}  (${ok ? 'recusado: ' : 'erro inesperado: '}${String(e.message).slice(0, 90)})`)
    if (!ok) falhas++
  }
}

console.log(`\nORG ALVO ${ORG}  (${N_CLIENTES} cliente(s))`)
console.log(`gestor de outra org   ${FOREIGN_MANAGER}\nmotorista de outra org ${FOREIGN_DRIVER}\n`)

// Tabelas ORGANIZACIONAIS principais. Cada uma tem `organization_id` e RLS por vínculo.
const TABELAS = [
  'clients', 'dogs', 'reservations', 'routes',
  'recurring_schedules', 'recurring_exceptions', 'pack_entries',
  'daily_plans', 'daily_todos', 'driver_shifts', 'driver_locations',
  'device_tokens', 'client_errors', 'client_instructions',
  'organization_locations', 'google_calendar_credentials', 'audit_logs',
]

console.log('== LEITURA: o gestor de OUTRA organização não vê NENHUMA linha do alvo ==')
for (const tabela of TABELAS) {
  if (!FOREIGN_MANAGER) continue
  await casoIsolamento(`gestor de fora NAO le ${tabela}`,
    MGR_FORA, `select count(*)::int as n from ${tabela} where organization_id = '${ORG}';`)
}
// `route_stops` NÃO tem `organization_id` — a fronteira se prova pela ROTA dona da parada.
if (FOREIGN_MANAGER) {
  await casoIsolamento('gestor de fora NAO le as paradas (via rota) do alvo',
    MGR_FORA, `select count(*)::int as n from route_stops
                 where route_id in (select id from routes where organization_id = '${ORG}');`)
}

console.log('\n== LEITURA: o motorista de OUTRA organização também não vê nada ==')
for (const tabela of TABELAS) {
  if (!FOREIGN_DRIVER) continue
  await casoIsolamento(`motorista de fora NAO le ${tabela}`,
    DRV_FORA, `select count(*)::int as n from ${tabela} where organization_id = '${ORG}';`)
}
if (FOREIGN_DRIVER) {
  await casoIsolamento('motorista de fora NAO le as paradas (via rota) do alvo',
    DRV_FORA, `select count(*)::int as n from route_stops
                 where route_id in (select id from routes where organization_id = '${ORG}');`)
}

console.log('\n== LIMITE DA PRÓPRIA ORGANIZAÇÃO: nem a linha da org o forasteiro enxerga ==')
if (FOREIGN_MANAGER) {
  await casoIsolamento('gestor de fora NAO le a propria organizacao alvo',
    MGR_FORA, `select count(*)::int as n from organizations where id = '${ORG}';`)
  await casoIsolamento('gestor de fora NAO le os membros da organizacao alvo',
    MGR_FORA, `select count(*)::int as n from organization_members where organization_id = '${ORG}';`)
}

console.log('\n== ESCRITA: o forasteiro NÃO cadastra nada na organização alvo ==')
if (FOREIGN_MANAGER) {
  await caso('gestor de fora NAO cria cliente no alvo',
    MGR_FORA, `insert into clients (id, organization_id, name) values ('${U()}','${ORG}','FORASTEIRO'); select 1 as n;`, 'erro')
  await caso('gestor de fora NAO cria reserva no alvo',
    MGR_FORA, `insert into reservations (organization_id, dog_id, service_type, start_date, end_date)
                 values ('${ORG}', (select id from dogs where organization_id='${ORG}' limit 1), 'daycare', current_date, current_date);
               select 1 as n;`, 'erro')
  await caso('gestor de fora NAO apaga reserva do alvo (0 linha)',
    MGR_FORA, `with d as (delete from reservations where organization_id = '${ORG}' returning 1)
               select count(*)::int as n from d;`, 'n==0')
  await caso('gestor de fora NAO muda parada de rota do alvo (0 linha)',
    MGR_FORA, `with u as (update route_stops set status = 'arrived'
                 where route_id in (select id from routes where organization_id = '${ORG}') returning 1)
               select count(*)::int as n from u;`, 'n==0')
}

if (FOREIGN_DRIVER) {
  await caso('motorista de fora NAO cadastra cao no alvo',
    DRV_FORA, `insert into dogs (id, organization_id, client_id, name)
                 values ('${U()}','${ORG}', (select id from clients where organization_id='${ORG}' limit 1), 'FORASTEIRO');
               select 1 as n;`, 'erro')
  await caso('motorista de fora NAO registra posicao na rota do alvo',
    DRV_FORA, `insert into driver_locations (route_id, organization_id, driver_id, latitude, longitude)
                 values ((select id from routes where organization_id='${ORG}' limit 1), '${ORG}', '${FOREIGN_DRIVER}', 37.7, -122.4);
               select 1 as n;`, 'erro')
  await caso('motorista de fora NAO grava token na organizacao alvo',
    DRV_FORA, `insert into device_tokens (organization_id, user_id, token, platform)
                 values ('${ORG}','${FOREIGN_DRIVER}','ExponentPushToken[FORA-${U().slice(0, 6)}]','ios');
               select 1 as n;`, 'erro')
  await caso('motorista de fora NAO grava erro em nome do alvo',
    DRV_FORA, `insert into client_errors (organization_id, user_id, message, platform)
                 values ('${ORG}','${FOREIGN_DRIVER}','forasteiro','ios');
               select 1 as n;`, 'erro')
}

// Rede de segurança: como TODOS os casos deram ROLLBACK, o alvo tem de estar intacto.
console.log('\n== INTEGRIDADE: o alvo continua com a MESMA contagem ==')
const depois = (await sql(`select (select count(*) from clients where organization_id = '${ORG}') as n;`))[0]
const igual = Number(depois.n) === Number(N_CLIENTES)
console.log(`${igual ? '  OK   ' : ' FALHA '} clientes do alvo: antes ${N_CLIENTES} / depois ${depois.n}`)
if (!igual) falhas++

console.log(`\n${falhas === 0 ? 'MATRIZ DE SEGURANCA VERDE' : 'MATRIZ COM ' + falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
