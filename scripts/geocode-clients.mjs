#!/usr/bin/env node
/**
 * geocode-clients.mjs — preenche a coordenada dos clientes que TEM endereco e NAO tem pino.
 *
 * Usa a funcao `geocode` do Supabase (a chave do Google fica no servidor: este script nunca ve
 * nem guarda chave do Google). Roda com:
 *
 *   node scripts/geocode-clients.mjs            # simulacao (nao grava nada)  <- comece por aqui
 *   node scripts/geocode-clients.mjs --gravar   # grava no banco
 *   node scripts/geocode-clients.mjs --org <uuid> [--gravar] [--limite 25]
 *
 * ACESSO: e script de administracao, entao usa a chave `service_role` (lida na hora pela API de
 * gerenciamento com o PACKPAWS_SUPABASE_TOKEN). A chave publishable/anon NAO serve aqui: ela
 * respeita RLS e devolveria ZERO clientes — um "nada a fazer" silenciosamente errado. O script
 * confere e avisa em vez de mentir.
 *
 * Sem a chave do Google configurada na funcao, ela responde 501 sem-chave-do-google: o script
 * avisa e sai sem tocar no banco (nada de pino inventado).
 */
import { readFileSync } from 'node:fs';

const REF = 'bhuexxjcrjdhkmsvagdw';

// ---- env -----------------------------------------------------------------------------------
function lerEnv(caminho) {
  const env = {};
  try {
    for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
      const t = linha.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const [k, ...resto] = t.split('=');
      env[k.trim()] = resto.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* arquivo ausente: cai no process.env */
  }
  return env;
}

const env = { ...lerEnv('/opt/data/.env'), ...lerEnv('/opt/data/pack-and-paws/mobile/.env.local'), ...process.env };
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
if (!URL_BASE || !URL_BASE.includes(REF)) {
  console.error(`EXPO_PUBLIC_SUPABASE_URL precisa apontar para o projeto ${REF}. Hoje: ${URL_BASE ?? '(vazio)'}`);
  process.exit(2);
}

/**
 * Chave de servico. O projeto usa as chaves NOVAS do Supabase (sb_secret_...): a antiga
 * `service_role` (JWT legacy) esta desativada neste projeto e devolve 401 "Invalid API key".
 * Por isso aqui a chave e ESCOLHIDA POR PROVA: testa cada candidata e usa a que enxerga uma
 * tabela que o RLS esconde do publico (route_stops). Assim o script nunca "nao acha nada" por
 * estar usando chave de leitura publica.
 */
async function chaveDeServico() {
  const candidatas = [];
  if (env.SUPABASE_SERVICE_ROLE_KEY) candidatas.push({ rotulo: 'env SUPABASE_SERVICE_ROLE_KEY', chave: env.SUPABASE_SERVICE_ROLE_KEY });
  const token = env.PACKPAWS_SUPABASE_TOKEN;
  if (token) {
    const resposta = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resposta.ok) {
      const chaves = await resposta.json();
      for (const k of chaves) {
        if (k.type === 'secret' || k.name === 'service_role') candidatas.push({ rotulo: `${k.type}:${k.name}`, chave: k.api_key });
      }
    }
  }
  if (candidatas.length === 0) return null;

  let primeiraOk = null;
  for (const candidata of candidatas) {
    const teste = await fetch(`${URL_BASE}/rest/v1/route_stops?select=id&limit=1`, {
      headers: { apikey: candidata.chave, Authorization: `Bearer ${candidata.chave}` },
    });
    if (teste.status !== 200) continue;
    primeiraOk ??= candidata;
    const linhas = await teste.json().catch(() => []);
    if (Array.isArray(linhas) && linhas.length > 0) {
      console.log(`Chave de servico: ${candidata.rotulo} (enxerga o banco inteiro)`);
      return candidata.chave;
    }
  }
  if (primeiraOk) console.log(`Aviso: usei ${primeiraOk.rotulo}, mas nao consegui confirmar visao total do banco.`);
  return primeiraOk?.chave ?? null;
}

const ANON = await chaveDeServico();
if (!ANON) {
  console.error('Nao consegui a chave de servico (PACKPAWS_SUPABASE_TOKEN ausente ou invalido).');
  process.exit(2);
}

const cabecalhos = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`${URL_BASE}${caminho}`, { ...opcoes, headers: { ...cabecalhos, ...(opcoes.headers ?? {}) } });
  const texto = await resposta.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  return { status: resposta.status, corpo };
}

const argv = process.argv.slice(2);
const gravar = argv.includes('--gravar');
const org = argv.includes('--org') ? argv[argv.indexOf('--org') + 1] : null;
const limite = argv.includes('--limite') ? Number(argv[argv.indexOf('--limite') + 1]) : 25;

// ---- 1) quem precisa de pino ---------------------------------------------------------------
const filtroOrg = org ? `&organization_id=eq.${org}` : '';
const todos = await api(`/rest/v1/clients?select=id${filtroOrg}`);
if (todos.status !== 200) {
  console.error('Falha ao ler os clientes:', todos.status, todos.corpo);
  process.exit(1);
}
const visiveis = Array.isArray(todos.corpo) ? todos.corpo.length : 0;
console.log(`Clientes visiveis neste projeto: ${visiveis}`);
if (visiveis === 0) {
  console.error('ZERO clientes visiveis: ou o projeto nao tem dados, ou a chave nao e de servico (RLS). Nada foi tocado.');
  process.exit(1);
}

const consulta = await api(
  `/rest/v1/clients?select=id,name,address_line_1,address_line_2,city,state,postal_code,latitude,longitude&latitude=is.null&address_line_1=not.is.null&order=name${filtroOrg}`,
);
if (consulta.status !== 200) {
  console.error('Falha ao procurar quem precisa de pino:', consulta.status, consulta.corpo);
  process.exit(1);
}

const clientes = (consulta.corpo ?? []).filter((c) => (c.address_line_1 ?? '').trim().length > 0);
console.log(`Com endereco e SEM coordenada: ${clientes.length}`);
for (const c of clientes) {
  console.log(`  - ${c.name} :: ${[c.address_line_1, c.city, c.state, c.postal_code].filter(Boolean).join(', ')}`);
}
if (clientes.length === 0) {
  console.log('Nada a fazer.');
  process.exit(0);
}

// ---- 2) pede ao servidor (funcao geocode) --------------------------------------------------
const lote = clientes.slice(0, limite);
const places = lote.map((c) => ({
  id: c.id,
  addressLine1: c.address_line_1,
  addressLine2: c.address_line_2 ?? null,
  city: c.city ?? null,
  state: c.state ?? null,
  postalCode: c.postal_code ?? null,
  country: 'US',
}));

const respostaFuncao = await api('/functions/v1/geocode', { method: 'POST', body: JSON.stringify({ places }) });
console.log(`\nFuncao geocode -> HTTP ${respostaFuncao.status}`);

if (respostaFuncao.status === 501) {
  console.error('A funcao respondeu "sem-chave-do-google". Configure o segredo e rode de novo:');
  console.error(`  supabase secrets set GOOGLE_GEOCODING_KEY=<chave> --project-ref ${REF}`);
  process.exit(3);
}
if (respostaFuncao.status !== 200) {
  console.error('Resposta inesperada:', respostaFuncao.corpo);
  process.exit(1);
}

const pontos = respostaFuncao.corpo?.results ?? [];
const faltando = respostaFuncao.corpo?.missing ?? [];
console.log(`Enderecos resolvidos: ${pontos.length} | nao encontrados: ${faltando.length}`);
for (const p of pontos) {
  const nome = lote.find((c) => c.id === p.id)?.name ?? p.id;
  console.log(`  [OK]  ${nome} -> ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)} (${p.precision}) ${p.formattedAddress ?? ''}`);
}
for (const id of faltando) {
  const nome = lote.find((c) => c.id === id)?.name ?? id;
  console.log(`  [--]  ${nome} -> endereco nao encontrado pelo Google (fica sem pino)`);
}

// ---- 3) grava (so com --gravar) ------------------------------------------------------------
if (!gravar) {
  console.log('\nSIMULACAO: nada foi gravado. Rode com --gravar para gravar os pinos acima.');
  process.exit(0);
}

let gravados = 0;
for (const p of pontos) {
  const { status: st } = await api(`/rest/v1/clients?id=eq.${p.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ latitude: p.latitude, longitude: p.longitude }),
  });
  if (st >= 200 && st < 300) gravados += 1;
  else console.error(`  erro ao gravar ${p.id}: HTTP ${st}`);
}
console.log(`\nPinos gravados: ${gravados}/${pontos.length}`);
