# TestFlight — checklist pós-aprovação da Apple

Conta Apple Developer **aprovada e ativa** (Individual, Apple ID `gabriel.bdsobrinho@gmail.com`).
Conta Expo/EAS: **jarbasdev** (owner) · projeto EAS `784897ee-2e4f-47e0-bb1c-1eacc39d412b`.

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
