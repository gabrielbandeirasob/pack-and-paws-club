# TestFlight — checklist pós-aprovação da Apple

Conta Apple Developer **aprovada e ativa** (Individual, Apple ID `gabriel.bdsobrinho@gmail.com`).
Conta Expo/EAS: **jarbasdev** (owner) · projeto EAS `784897ee-2e4f-47e0-bb1c-1eacc39d412b`.

## ✅ Estado real em 2026-09-10 (tarde): conta aprovada, App ID + API Key prontos, build rodando

- **App ID registrado** no portal Apple: `br.com.automadigital.app` (Description interna "Pack and Paws Club", platform UNIVERSAL, seedId 957KA752J5). *A Description não aceita `&` — por isso "Pack and Paws Club".*
- **App Store Connect API Key** (chave de EQUIPE, papel **Admin**): Key ID `856ZHZY4PJ`, Issuer ID `9d093488-99dd-41d1-ac95-dbfd17028d09`, `.p8` em `/opt/data/.apple/AuthKey_856ZHZY4PJ.p8` (fora do repositório, modo 600). Configurada em `eas.json` → `submit.production.ios` (`ascApiKeyPath`/`ascApiKeyId`/`ascApiKeyIssuerId` + `appleTeamId`).
- **Certificado de distribuição + provisioning profile criados no nome do Gabriel pelo EAS** usando a API Key (sem senha do Apple ID): certificado expira 2027-09-10, profile `7UQRM8KDQD` (active).
- **Build de produção iOS**: versão `1.0.0`, **buildNumber 2**, id `84f5268a-c5c4-4866-ad21-56454196ec3d` → `https://expo.dev/accounts/jarbasdev/projects/pack-and-paws-club/builds/84f5268a-c5c4-4866-ad21-56454196ec3d`
- **Comando do build** (exige os 5 env vars; sem elas o EAS não autentica no Apple):
  ```bash
  cd /opt/data/pack-and-paws/mobile
  export EXPO_ASC_API_KEY_PATH=/opt/data/.apple/AuthKey_856ZHZY4PJ.p8 \
         EXPO_ASC_KEY_ID=856ZHZY4PJ \
         EXPO_ASC_ISSUER_ID=9d093488-99dd-41d1-ac95-dbfd17028d09 \
         EXPO_APPLE_TEAM_ID=957KA752J5 \
         EXPO_APPLE_TEAM_TYPE=INDIVIDUAL
  npx eas-cli build --platform ios --profile production --non-interactive
  ```
  **Pitfall (1º build):** `--non-interactive` falha com `Distribution Certificate is not validated for non-interactive builds / Credentials are not set up`. Nesse caso rodar **interativo sob pty** e responder **Y** aos dois prompts (*Generate a new Apple Distribution Certificate?* / *Generate a new Apple Provisioning Profile?*). Com a API Key ativa **não** é pedida senha do Apple ID (o log mostra `Skipping capability identifier syncing because the current Apple authentication session is not using Cookies`).
- **Pendente (só navegador):** criar o app no **App Store Connect** — a **API não permite criar apps** (`POST /v1/apps` → 403 `The resource 'apps' does not allow 'CREATE'`). Depois copiar o **Apple ID numérico** (Geral → Informações do app) para `ascAppId` no `eas.json` e usar `groups` (grupo **Internal Testers**) para o TestFlight interno.
- **Verificar a chave sem o EAS:** `/tmp/ascvenv/bin/python` + PyJWT (ES256, `aud: appstoreconnect-v1`) → `GET /v1/bundleIds?filter[identifier]=br.com.automadigital.app` → 200 com o App ID.
- **Vigia do build:** cron `packpaws-ios-build-status` (a cada 10 min, script `/opt/data/scripts/packpaws_ios_build_status.sh`) avisa no Telegram quando o build terminar/falhar.

### ⚠️ Pitfall real (10/09/2026): EAS Submit ficou >30 min em `IN_QUEUE`
Duas submissões (`eas submit`) travaram em `in queue` (fila do EAS Submit congestionada, status.expo.dev dizia "operacional"). **Solução que funcionou: subir o IPA direto pela App Store Connect API (Baixar o IPA do EAS (18 MB aqui) → fluxo `BuildUpload` da API (o mesmo do Transporter, anunciado na WWDC25 session 324). Passo a passo validado (scripts em `/opt/data/pack-and-paws/build/upload_step*.py`, venv `/tmp/ascvenv`):
1. `POST /v1/buildUploads` — `attributes: {cfBundleShortVersionString, cfBundleVersion, platform:"IOS"}` + `relationships.app` → 201 (`state: AWAITING_UPLOAD`).
2. `POST /v1/buildUploadFiles` — `attributes: {assetType:"ASSET", fileName, fileSize, uti:"com.apple.ipa"}` + `relationships.buildUpload`. **`uti` é obrigatório** (`com.apple.pkg` para .pkg) → 201 com `uploadOperations`.
3. `PUT` cada operação (offset/length + `requestHeaders` exatos) — o IPA é dividido em vários chunks (aqui 4).
4. `PATCH /v1/buildUploadFiles/{id}` com `attributes: {uploaded: true}` → 200, `assetDeliveryState: COMPLETE`. **NÃO** enviar `sourceFileChecksums` (rejeita: "unknown property 'hash'") e **não** tentar `PATCH /v1/buildUploads` (403, não permite UPDATE) nem `isUploaded` (nome inexistente em buildUploadFiles).
5. `GET /v1/builds?filter[app]=...` → o build aparece em `PROCESSING` em ~1 min e `VALID` em ~2 min (bem mais rápido que o EAS).
- Pós-processamento: `usesNonExemptEncryption` já vem `false` (Info.plist), `betaBuildLocalizations` para o "What to Test" (201), e o build entra **automaticamente** no grupo interno `Team (Expo)` (`hasAccessToAllBuilds: true`) — tentar associar grupo interno via API dá `422 Builds cannot be assigned to this internal group`.
- Testador interno adicionado via API: `POST /v1/betaTesters` com `{email, firstName, lastName}` + `relationships.betaGroups` → 201 (precisa ser um **usuário existente** da conta, ex.: o Account Holder `gabriel.bdsobrinho@gmail.com`).
- Testador externo (Raphael, `raphaelstefan98@icloud.com`) + grupo externo `Testers externos` (`8dbc2b1d-41f6-42f9-bad8-6d3ee7e2df61`) criados via API. Ficha beta (`betaAppLocalizations`, en-US) com descrição + `feedbackEmail: automadigitalsup@gmail.com` + privacy/support do site legal. **Falta** `betaAppReviewDetail` (exige `contactPhone`) para então `POST /v1/betaAppReviewSubmissions` com o build.

### 🐛 Bug real do build 1/3 no TestFlight: `EXPO_PUBLIC_*` com acesso DINÂMICO
O app abria e dava erro (`Supabase public configuration is missing`) mesmo com as variáveis definidas no EAS. Causa: `lib/supabase.ts` / `lib/supabase.web.ts` faziam `getSupabaseConfig(process.env)` — **o Metro só inlinia `process.env.EXPO_PUBLIC_X` quando o acesso é literal**; passar o objeto inteiro não inlinia nada (no Expo Go funciona porque o dev bundle carrega o `.env.local`). Correção: passar campo por campo (`{ EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL, ... }`) — **manter assim** (há comentário de aviso nos arquivos). Testes 106/106 + `tsc --noEmit` limpos depois da correção.
- **Como validar o IPA antes de subir:** `zipfile` → `Payload/PackPawsClub.app/main.jsbundle` → `b'<project-ref>' in data` (a ref do projeto = 20 chars do `.env.local`). Se a ref não estiver lá, o binário está quebrado e não vale subir.

### 🐛 Bug de UI do build 4: faixa creme no topo acima do header verde (corrigido no build 5)

Sintoma relatado pelo cliente no TestFlight: *"o topo do aplicativo está com uma barra"*.

- **Causa:** todas as telas usavam `<SafeAreaView style={styles.screen} edges={['top']}>` com `screen: {backgroundColor: colors.cream}`. O SafeAreaView aplica o recuo do topo **e pinta essa faixa de creme**, então o header verde (`forest700`) começava **abaixo** da status bar.
- **Prova (barata e sem device):** amostrar as cores por linha do print com Pillow → no app, creme (`#F7F3E8`) de `y=0` até `y≈148` e verde só depois; no mockup de referência (`artifacts/clubhouse-calm.png`) o verde começa em `y=0`. Não é questão de gosto: contraria o design aprovado.
- **Correção (11 telas):** `screen` vira `colors.forest700` + o contêiner rolável ganha `scroll/body` com `backgroundColor: colors.cream` (`ManagerDashboard`, driver, assigned, schedule, profile, calendar, more, dispatch, clients, `DispatchBoard`, `ClientsList`).
- **Segunda camada do mesmo bug (build 5 → 6):** depois de deixar o recuo do `SafeAreaView` verde, sobrou uma faixa de **exatamente 1 recuo (44pt)**. Medida no print do usuário (recorte 1125px de largura num aparelho de 375pt → 3x): a faixa creme abaixo da status bar ≈ 44pt = o **segundo recuo**, aplicado pelo `ScrollView` (`automaticallyAdjustContentInsets` / `contentInsetAdjustmentBehavior`). Correção: `automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"` nos ScrollViews de topo de tela (ManagerDashboard, DispatchBoard, DriverRouteView, ClientsList, assigned, schedule, calendar, drivers). Diagnóstico por pixel: no print antigo o creme somava ~94pt (= 2 × 44pt), no novo ~44pt (= 1 × 44pt) — a aritmética identifica quantas camadas de recuo estão ativas.
- **CAUSA RAIZ (build 7): `SafeAreaView` aninhado no `app/(tabs)/index.tsx`.** A tela embrulhava o `ManagerDashboard` (que já tem `SafeAreaView` próprio) em OUTRO `SafeAreaView` com fundo creme → duas faixas creme empilhadas. Prova pela aritmética dos pixels do print (aparelho de 375pt, escala 3x, recuo 44pt): build 4 = **88pt = 2 × 44**; builds 5–6 = **44pt = 1 × 44**; build 7 = **0**. Correção: o `SafeAreaView` de index.tsx ficou apenas nos estados de `loading`/`error` e o dashboard renderiza direto. Lição: **um `SafeAreaView` por tela** (`grep -rn "<SafeAreaView" app features`; os de dentro de `<Modal>` são legítimos).
- **Status bar:** com o topo verde, o texto precisa ser claro → `<StatusBar style="light" />` em `app/(tabs)/_layout.tsx` e `style="dark"` em `app/login.tsx` (tela clara).
- **Gates antes do build:** `npm run typecheck` limpo + `npm test` **106/106**.

## Decisões fechadas (imutáveis depois do 1º build/submissão)

| Item | Valor |
|---|---|
| Bundle ID (iOS) | `br.com.automadigital.app` |
| Package (Android) | `br.com.automadigital.app` |
| SKU (App Store Connect) | `packandpawsclub` |
| Nome na loja | `Pack & Paws Club` |
| Idioma primário | English (U.S.) |
| Apple ID da conta | `gabriel.bdsobrinho@gmail.com` |
| E-mail público (privacidade/suporte) | `automadigitalsup@gmail.com` |

## ✅ Já pronto (não depende da Apple)

- `app.json`: bundle/package `br.com.automadigital.app`, `buildNumber: 1`, descrições de permissão (localização/contatos), `ITSAppUsesNonExemptEncryption: false`.
- `eas.json`: profiles `development` / `preview` / `production` (`autoIncrement: true`) + `submit.production.ios` apontando para o bundle ID.
- EAS CLI logado na conta **jarbasdev**.
- `expo-doctor` 21/21 · `tsc --noEmit` limpo · **106 testes** passando · ícone 1024×1024 sem transparência.
- Site legal publicado (obrigatório na App Store):
  - Privacidade: https://pack-and-paws-legal.vercel.app/privacy
  - Suporte: https://pack-and-paws-legal.vercel.app/support
  - E-mail de contato: **automadigitalsup@gmail.com** ✅

## Etapa 1 — Apple Developer Portal (navegador)

1. https://developer.apple.com/account → *Membership details* → anotar o **Team ID**.
2. *Certificates, Identifiers & Profiles* → **Identifiers** → `+` → **App IDs** → **App** → Continue.
   - Description: `Pack & Paws Club`
   - Bundle ID: **Explicit** → `br.com.automadigital.app`
   - Capabilities: nenhuma especial (localização em uso não exige capability).
3. *Users and Access* → **Integrations** (aba superior) → **App Store Connect API** → **Team Keys** → `+`
   - Name: `EAS Build` · Access/Role: **Admin**
   - **Download** o arquivo `AuthKey_XXXXXXXXXX.p8` (só pode baixar UMA vez).
   - Anotar **Key ID** e **Issuer ID**.

## Etapa 2 — App Store Connect (navegador)

*My Apps* → `+` → **New App**:

- Platform: **iOS**
- Name: `Pack & Paws Club`
- Primary language: **English (U.S.)**
- Bundle ID: `br.com.automadigital.app` (aparece no dropdown depois da Etapa 1)
- SKU: `packandpawsclub`
- User Access: **Full Access**

## Etapa 3 — Credenciais no EAS (terminal, sem senha e sem 2FA)

Colocar o `.p8` no servidor e registrar na config:

```bash
install -m 600 /path/AuthKey_XXXXXXXXXX.p8 /opt/data/pack-and-paws/keys/ios/AuthKey_XXXXXXXXXX.p8
```

`eas.json` → `submit.production.ios`:

```json
{
  "ascAppId": "ID_DO_APP_NO_ASC",
  "ascApiKeyPath": "/opt/data/pack-and-paws/keys/ios/AuthKey_XXXXXXXXXX.p8",
  "ascApiKeyId": "KEY_ID",
  "ascApiKeyIssuerId": "ISSUER_ID"
}
```

Registrar a chave no projeto EAS: `npx eas-cli credentials --platform ios` →
*App Store Connect: Manage your API Key* → *Set up your project to use an API Key*.

## Etapa 4 — Build de teste

```bash
cd /opt/data/pack-and-paws/mobile
npx eas-cli build --platform ios --profile preview   # instala direto no aparelho registrado
npx eas-cli device:create                            # registra o iPhone do testador (UDID)
```

## Etapa 5 — TestFlight

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

No App Store Connect → **TestFlight**:
1. Aguardar o processamento (5–15 min); o questionário de export compliance já é respondido por `ITSAppUsesNonExemptEncryption: false`.
2. Criar o grupo **Internal Testers** e adicionar o e-mail do cliente (Raphael).
   - Testador **interno** precisa ser um usuário no App Store Connect: *Users and Access* → *People* → convidar e-mail (conta Individual pode ter até 50 usuários). Sem review da Apple.
   - Alternativa sem conta: grupo **External Testers** (convite por e-mail) — mas exige uma revisão beta da Apple (~1 dia).
3. O testador instala o app **TestFlight** na App Store, abre o link e usa o app.

## Etapa 6 — Checklist de uso no aparelho do testador

- [ ] Login do manager: `raphael@autonestmobile.com`
- [ ] Calendário: criar reserva de daycare com transporte marcado
- [ ] Dispatch: atribuir motorista, definir janela, publicar
- [ ] Motorista: ver a rota, usar *Navigate*, marcar *Arrived → Picked up → Completed*
- [ ] Aceitar a permissão de localização e confirmar que o Dispatch mostra "📍 N min ago"
- [ ] Modo avião: marcar ações → religar → confirmar a sincronização

## Pendências só depois da conta Google Cloud (pós-venda)

- Matriz de trânsito real (Directions/Routes API) no otimizador de rotas.
- Push notifications (alertas fora do app) — exige `expo-notifications` + credenciais APNs (o EAS cria a chave APNs automaticamente no primeiro build com o módulo).
