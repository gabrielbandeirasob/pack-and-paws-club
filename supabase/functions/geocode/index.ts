// Funcao `geocode` (Supabase Edge Function, Deno).
//
// ENDERECO -> COORDENADA. Mesma regra do `travel-times`: a chave do Google e privilegiada e
// vive no servidor (plano §5.4). O app manda o endereco e recebe o ponto no mapa.
//
// POR QUE ISSO EXISTE: a operacao do Pack & Paws e uma ROTA de busca/devolucao. Cliente com
// endereco e sem coordenada nao entra no mapa nem no calculo de transito — em 12/09/2026 eram
// 7 de 9 clientes nessa situacao. Sem geocoding, os tempos reais do Google nao tem o que medir.
//
// COMO ATIVAR (uma vez):
//   1) Google Cloud: habilitar "Geocoding API" e a cobranca.
//   2) Guardar a chave como segredo da funcao (pode ser a MESMA chave de servidor do
//      travel-times — a funcao aceita as duas):
//        supabase secrets set GOOGLE_GEOCODING_KEY=... --project-ref bhuexxjcrjdhkmsvagdw
//      (ou GOOGLE_ROUTES_KEY, se voce so quer uma chave de servidor)
//   3) Publicar:
//        supabase functions deploy geocode --project-ref bhuexxjcrjdhkmsvagdw
//   4) Nada a fazer no app: ele ja tenta chamar; se falhar, o cadastro segue sem coordenada
//      e a navegacao por endereco continua funcionando.
//
// ENTRADA : { places: [{ id, addressLine1, addressLine2?, city?, state?, postalCode?, country? }] }
// SAIDA   : { results: [{ id, latitude, longitude, formattedAddress, precision }], missing: [id...],
//             source: 'google' }
//           precision: 'rooftop' | 'street' | 'approximate' (qualidade do ponto devolvido)
//
// CUSTO: SKU "Geocoding" do Google — 10.000 chamadas gratuitas por mes, depois US$ 5,00 por
// 1.000. Endereco repetido na mesma chamada e resolvido UMA vez (cache local por texto).

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const MAX_LOCAIS = 25;
const CONCORRENCIA = 5;
const PAIS_PADRAO = 'US';

type Lugar = {
  id: string;
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

type Ponto = {
  id: string;
  latitude: number;
  longitude: number;
  formattedAddress: string | null;
  precision: 'rooftop' | 'street' | 'approximate';
};

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Texto do endereco como o Google espera (partes vazias fora, pais no fim). */
function textoDoEndereco(lugar: Lugar): string {
  return [
    lugar.addressLine1,
    lugar.addressLine2,
    lugar.city,
    lugar.state,
    lugar.postalCode,
    lugar.country ?? PAIS_PADRAO,
  ]
    .map((parte) => (typeof parte === 'string' ? parte.trim() : ''))
    .filter((parte) => parte.length > 0)
    .join(', ');
}

/** location_type do Google -> qualidade do ponto (o gestor decide se confia). */
function precisaoDe(locationType: unknown): 'rooftop' | 'street' | 'approximate' {
  if (locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED') return 'rooftop';
  if (locationType === 'GEOMETRIC_CENTER') return 'street';
  return 'approximate';
}

async function geocodarUm(lugar: Lugar, chave: string): Promise<Ponto | null> {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(textoDoEndereco(lugar))}&key=${encodeURIComponent(chave)}`;
  const resposta = await fetch(url);
  if (!resposta.ok) return null;

  const corpo = (await resposta.json()) as {
    status?: string;
    results?: { formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number }; location_type?: string } }[];
  };
  if (corpo.status !== 'OK') return null;

  const melhor = corpo.results?.[0];
  const lat = melhor?.geometry?.location?.lat;
  const lng = melhor?.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  return {
    id: lugar.id,
    latitude: lat,
    longitude: lng,
    formattedAddress: melhor?.formatted_address ?? null,
    precision: precisaoDe(melhor?.geometry?.location_type),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);

  const chave = Deno.env.get('GOOGLE_GEOCODING_KEY') ?? Deno.env.get('GOOGLE_ROUTES_KEY');
  if (!chave) return json({ error: 'sem-chave-do-google' }, 501);

  let corpo: { places?: Lugar[] };
  try {
    corpo = await req.json();
  } catch {
    return json({ error: 'json-invalido' }, 400);
  }

  const lugares = (corpo.places ?? []).filter(
    (l) => typeof l?.id === 'string' && typeof l?.addressLine1 === 'string' && l.addressLine1.trim().length > 0,
  );
  if (lugares.length === 0) return json({ error: 'sem-enderecos' }, 400);
  if (lugares.length > MAX_LOCAIS) return json({ error: 'enderecos-demais', limite: MAX_LOCAIS }, 400);

  const resultados: Ponto[] = [];
  const faltando: string[] = [];
  const cache = new Map<string, Ponto | null>();

  for (let i = 0; i < lugares.length; i += CONCORRENCIA) {
    const lote = lugares.slice(i, i + CONCORRENCIA);
    const resolvidos = await Promise.all(
      lote.map(async (lugar) => {
        const texto = textoDoEndereco(lugar);
        if (cache.has(texto)) return { lugar, ponto: cache.get(texto)! };
        const ponto = await geocodarUm(lugar, chave).catch(() => null);
        cache.set(texto, ponto);
        return { lugar, ponto };
      }),
    );
    for (const { lugar, ponto } of resolvidos) {
      if (ponto) resultados.push({ ...ponto, id: lugar.id });
      else faltando.push(lugar.id);
    }
  }

  return json({ results: resultados, missing: faltando, source: 'google' });
});
