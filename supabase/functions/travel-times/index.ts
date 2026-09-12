// Funcao `travel-times` (Supabase Edge Function, Deno).
//
// POR QUE AQUI E NAO NO APP: a chave do Google para rotas e privilegiada. A regra do projeto
// (plano §5.4) e que ela viva no servidor. O app manda as coordenadas e recebe so os tempos.
//
// COMO ATIVAR (uma vez):
//   1) Google Cloud: habilitar "Routes API" (ou "Distance Matrix API") e a cobranca.
//   2) Guardar a chave como segredo da funcao:
//        supabase secrets set GOOGLE_ROUTES_KEY=... --project-ref bhuexxjcrjdhkmsvagdw
//      Restrinja a chave por IP do Supabase (ou aceite o risco de chave de servidor) —
//      NAO use a mesma chave do Maps SDK do app.
//   3) Publicar:
//        supabase functions deploy travel-times --project-ref bhuexxjcrjdhkmsvagdw
//   4) Nada a fazer no app: ele ja tenta chamar; se falhar, usa a estimativa de linha reta.
//
// ENTRADA : { home?: {latitude, longitude} | null, stops: [{dogId, latitude, longitude}] }
// SAIDA   : { dogIds: string[], durations: number[][], source: 'google' }  (segundos)
//           dogIds[0] = base quando `home` vem preenchido; senao a matriz e so das paradas.

const ROUTES_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const MAX_PONTOS = 27;

type Ponto = { dogId: string; latitude: number; longitude: number };

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);

  const chave = Deno.env.get('GOOGLE_ROUTES_KEY');
  if (!chave) return json({ error: 'sem-chave-do-google' }, 501);

  let corpo: { home?: Ponto | null; stops?: Ponto[] };
  try {
    corpo = await req.json();
  } catch {
    return json({ error: 'json-invalido' }, 400);
  }

  const pontos = (corpo.stops ?? []).filter(
    (p) => typeof p?.latitude === 'number' && typeof p?.longitude === 'number' && typeof p?.dogId === 'string',
  );
  if (pontos.length < 2) return json({ error: 'poucas-paradas' }, 400);

  const base =
    corpo.home && typeof corpo.home.latitude === 'number' && typeof corpo.home.longitude === 'number' ? corpo.home : null;
  const lista: Ponto[] = base ? [base, ...pontos] : [...pontos];
  if (lista.length > MAX_PONTOS) return json({ error: 'paradas-demais' }, 400);

  const waypoint = (p: Ponto) => ({ waypoint: { location: { latLng: { latitude: p.latitude, longitude: p.longitude } } } });

  const resposta = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': chave,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,status',
    },
    // TRAFFIC_AWARE: usa o transito previsto para o horario da consulta
    body: JSON.stringify({
      origins: lista.map(waypoint),
      destinations: lista.map(waypoint),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  });

  if (!resposta.ok) {
    return json({ error: 'google-recusou', status: resposta.status, detalhe: await resposta.text() }, 502);
  }

  const elementos = (await resposta.json()) as { originIndex: number; destinationIndex: number; duration?: string }[];
  const n = lista.length;
  const durations: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));

  for (const elemento of elementos) {
    const segundos = Number(String(elemento.duration ?? '0s').replace('s', ''));
    if (Number.isFinite(segundos) && elemento.originIndex < n && elemento.destinationIndex < n) {
      durations[elemento.originIndex][elemento.destinationIndex] = Math.max(0, Math.round(segundos));
    }
  }

  // A base entra como '__base__' (o app reconhece esse marcador como "saida do motorista").
  const ids = [...(base ? ['__base__'] : []), ...pontos.map((ponto) => ponto.dogId)];
  return json({ dogIds: ids, durations, source: 'google' });
});
