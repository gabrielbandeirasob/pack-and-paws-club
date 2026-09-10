# TestFlight — checklist pós-aprovação da Apple

Tudo que **não** depende da Apple já está pronto neste repositório:

- `app.json` com bundle ID `com.packandpaws.club`, `buildNumber`, descrições de permissão (localização/contatos) e `ITSAppUsesNonExemptEncryption: false`.
- `eas.json` com profiles `development`, `preview` e `production` (+ `autoIncrement` no production) e submit iOS apontando para o bundle ID.
- EAS CLI instalado e logado na conta **jarbasdev** (owner). Projeto EAS vinculado: `784897ee-2e4f-47e0-bb1c-1eacc39d412b`.
- `expo-doctor`: 21/21 checks passando; `tsc --noEmit` limpo; 99 testes passando; ícone 1024×1024 **sem transparência**.
- Site legal publicado (obrigatório na App Store):
  - Privacidade: https://pack-and-paws-legal.vercel.app/privacy
  - Suporte: https://pack-and-paws-legal.vercel.app/support
  - E-mail de contato usado nas páginas: **support@autonestmobile.com** ⚠️ confirmar/criar este e-mail (ou trocar em `pack-and-paws/legal/*.html` e republicar).

## 1. Quando a Apple aprovar o enrollment

1. Confirmar em https://developer.apple.com/account → *Membership details* (Team ID à mão).
2. Registrar o **App ID** (bundle ID): *Identifiers* → `+` → App IDs → App → `com.packandpaws.club` → habilitar as capabilities usadas (nenhuma especial é necessária além do padrão; localização em uso não exige capability).
3. Criar o app no **App Store Connect** (*My Apps* → `+` → New App):
   - Platform: iOS · Name: `Pack & Paws Club` · Primary language: English (U.S.)
   - Bundle ID: `com.packandpaws.club` · SKU: `packandpawsclub`
   - User access: Full Access

## 2. Build de teste (EAS Build na nuvem)

```bash
cd /opt/data/pack-and-paws/mobile
npx eas-cli login            # se pedir: conta jarbasdev
npx eas-cli build:configure  # só se o projeto EAS precisar ser reconfigurado
npx eas-cli device:create    # registrar o iPhone de cada testador (development/preview)
npx eas-cli build --platform ios --profile preview
```

No primeiro build o EAS pergunta pelas credenciais Apple — escolher **"Let EAS handle it"** (o EAS cria o certificado de distribuição e o provisioning profile na conta Apple).

Distribuir o build `preview` (integração/instalação direta no aparelho): o EAS devolve um link de instalação; o iPhone precisa estar registrado (`device:create`).

## 3. Subir para o TestFlight

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

No `submit`, informar: Apple ID, App Store Connect App ID (`ascAppId`) e Team ID. Para automatizar depois, preencher em `eas.json` → `submit.production.ios`:

```json
"ios": { "appleId": "SEU_APPLE_ID", "ascAppId": "ID_DO_APP", "appleTeamId": "TEAM_ID" }
```

No App Store Connect → TestFlight:
1. Aguardar o processamento do build (5–15 min) e responder o questionário de export compliance (já respondido automaticamente por `ITSAppUsesNonExemptEncryption: false`).
2. Criar o grupo **Internal Testers** e adicionar o e-mail do cliente (Raphael) — testadores internos não precisam de review da Apple.
3. Enviar o convite; o testador instala o **TestFlight** na App Store, abre o link e usa o app.

## 4. Checklist de uso no aparelho do testador

- [ ] Login do manager: `raphael@autonestmobile.com`
- [ ] Calendário: criar reserva de daycare com transporte marcado
- [ ] Dispatch: atribuir motorista, definir janela, publicar
- [ ] Motorista: ver a rota, usar *Navigate*, marcar *Arrived → Picked up → Completed*
- [ ] Aceitar a permissão de localização e confirmar que o Dispatch mostra "📍 N min ago"
- [ ] Modo avião: marcar ações → religar → confirmar a sincronização

## 5. Pendências só depois da conta Google Cloud (pós-venda)

- Matriz de trânsito real (Directions/Routes API) no otimizador de rotas.
- Push notifications (alertas fora do app) — exige `expo-notifications` + credenciais APNs (o EAS cria a chave APNs automaticamente no primeiro build com o módulo).
