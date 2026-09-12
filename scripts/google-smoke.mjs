#!/usr/bin/env node
/**
 * google-smoke.mjs — PROVA de que a cadeia do Google esta ligada de ponta a ponta.
 *
 * Roda os dois caminhos reais, do app para o servidor:
 *   1) `travel-times` -> Google Routes API (matriz com TRAFFIC_AWARE)
 *   2) `geocode`      -> Google Geocoding API (endereco -> coordenada)
 *
 * Uso: node scripts/google-smoke.mjs
 * Sai com codigo 0 quando as duas funcoes responderam com dado do Google; 1 caso contrario
 * (com o motivo na tela: sem chave, sem funcao implantada, Google recusou...).
 */
import { readFileSync } from 'node:fs';

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
    /* sem arquivo: usa process.env */
  }
  return env;
}

const env = { ...lerEnv('/opt/data/.env'), ...lerEnv('/opt/data/pack-and-paws/mobile/.env.local'), ...process.env };
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
if (!URL_BASE) {
  console.error('Falta EXPO_PUBLIC_SUPABASE_URL (ou SUPABASE_URL).');
  process.exit(2);
}

// O /opt/data/.env tem credenciais de OUTRO projeto: usa a primeira chave que o projeto aceitar.
const CANDIDATAS = [env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, env.SUPABASE_ANON_KEY].filter(Boolean);
let ANON = null;
for (const candidata of CANDIDATAS) {
  const teste = await fetch(`${URL_BASE}/rest/v1/clients?select=id&limit=1`, {
    headers: { apikey: candidata, Authorization: `Bearer ${candidata}` },
  });
  if (teste.status === 200) {
    ANON = candidata;
    break;
  }
}
console.log(`Projeto: ${URL_BASE}${ANON ? ` (chave aceita: ...${ANON.slice(-6)})` : ' (sem chave - as funcoes seguem acessiveis)'}`);

const cabecalhos = { 'Content-Type': 'application/json', ...(ANON ? { apikey: ANON, Authorization: `Bearer ${ANON}` } : {}) };

async function chamar(slug, corpo) {
  const resposta = await fetch(`${URL_BASE}/functions/v1/${slug}`, {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: resposta.status, json };
}

let falhas = 0;

// --- 1) transito real ------------------------------------------------------------------------
// Tres pontos reais da Peninsula (San Francisco -> San Mateo), com base do motorista.
const stops = [
  { dogId: 'smoke-a', latitude: 37.79298, longitude: -122.40415 }, // 580 California St, SF
  { dogId: 'smoke-b', latitude: 37.5630, longitude: -122.3255 }, // San Mateo
  { dogId: 'smoke-c', latitude: 37.4849, longitude: -122.2287 }, // Redwood City
];
const home = { latitude: 37.7749, longitude: -122.4194 }; // San Francisco

console.log('=== 1) travel-times (transito real) ===');
const tt = await chamar('travel-times', { home, stops });
if (tt.status === 501) {
  console.log('  [X] sem chave: a funcao esta no ar, mas falta o segredo GOOGLE_ROUTES_KEY.');
  falhas += 1;
} else if (tt.status !== 200) {
  console.log(`  [X] HTTP ${tt.status}:`, JSON.stringify(tt.json).slice(0, 300));
  falhas += 1;
} else {
  const matriz = tt.json?.durations ?? [];
  const baseAteB = matriz?.[0]?.[2];
  console.log(`  [OK] fonte: ${tt.json?.source} | pontos: ${tt.json?.dogIds?.length} | base->2a parada: ${baseAteB}s (~${Math.round((baseAteB ?? 0) / 60)} min)`);
  if (!matriz.length) {
    console.log('  [X] matriz vazia');
    falhas += 1;
  }
}

// --- 2) geocoding ----------------------------------------------------------------------------
const places = [{ id: 'smoke-1', addressLine1: '2523 Holland St', city: 'San Mateo', state: 'CA', country: 'US' }];
console.log('\n=== 2) geocode (endereco -> coordenada) ===');
const gc = await chamar('geocode', { places });
if (gc.status === 501) {
  console.log('  [X] sem chave: a funcao esta no ar, mas falta o segredo GOOGLE_GEOCODING_KEY.');
  falhas += 1;
} else if (gc.status !== 200) {
  console.log(`  [X] HTTP ${gc.status}:`, JSON.stringify(gc.json).slice(0, 300));
  falhas += 1;
} else {
  const ponto = gc.json?.results?.[0];
  if (!ponto) {
    console.log('  [X] nada encontrado; resposta:', JSON.stringify(gc.json).slice(0, 200));
    falhas += 1;
  } else {
    console.log(`  [OK] fonte: ${gc.json?.source} | ${ponto.formattedAddress ?? ''} -> ${ponto.latitude}, ${ponto.longitude} (${ponto.precision})`);
  }
}

console.log(falhas === 0 ? '\nTUDO LIGADO: Google respondendo nas duas pontas.' : `\n${falhas} caminho(s) sem resposta do Google (veja acima).`);
process.exit(falhas === 0 ? 0 : 1);
