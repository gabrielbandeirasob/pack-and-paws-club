# App Store — metadados prontos (EN, cliente nos EUA)

## Informações do app

| Campo | Valor |
|---|---|
| Name (30) | `Pack & Paws Club` |
| Subtitle (30) | `Dog daycare & transport runs` |
| Bundle ID | `br.com.automadigital.app` |
| SKU | `packandpawsclub` |
| Primary category | Business |
| Secondary category | Productivity |
| Price | Free (a confirmar com o cliente) |
| Age rating | 4+ (sem conteúdo restrito) |
| Copyright | `© 2026 Pack & Paws Club` |

## URLs obrigatórias

| Campo | Valor |
|---|---|
| Privacy Policy URL | https://pack-and-paws-legal.vercel.app/privacy |
| Support URL | https://pack-and-paws-legal.vercel.app/support |
| Marketing URL (opcional) | https://pack-and-paws-legal.vercel.app/ |

## Descrição (Promotional text / Description)

**Promotional text (170):**
> Run your dog daycare, boarding and transport day from one place. Assign runs, publish routes to drivers, and see every pickup in real time.

**Description:**
> Pack & Paws Club keeps your dog care business organised from the first booking to the last drop-off.
>
> FOR MANAGERS
> • Clients and dogs in one place, with pick-up access instructions drivers can actually read.
> • Daily, weekly and monthly calendar for daycare and boarding, including recurring schedules.
> • Dispatch board: assign each dog to a driver, set a pick-up window or exact time, mark priority stops and publish the route.
> • Optimise a route in one tap, and re-optimise the remaining stops when plans change.
> • Follow progress live: every stop's status, the driver's position during an active route, estimated arrival times and problem reports.
> • Route history with a version for every publish.
>
> FOR DRIVERS
> • Today's route, in order, with addresses and access instructions.
> • One tap to open Apple Maps, then Arrived, Dog picked up and Completed.
> • Report a problem so the office knows instantly.
> • Keeps working with no signal — actions are stored on the device and sync automatically when you are back online.
>
> Built for busy teams: fast, readable in sunlight, and designed to be used with one hand.

**Keywords (100):**
> dog daycare,boarding,pet transport,dog walker,route,dispatch,pet care kennel,pack

## App Privacy (respostas do questionário)

| Data type | Collected? | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Contact Info — Name | Yes | Yes | No | App Functionality |
| Contact Info — Email | Yes | Yes | No | App Functionality |
| Contact Info — Phone | Yes | Yes | No | App Functionality |
| Contacts | Yes (only contacts the user selects to import) | Yes | No | App Functionality |
| Location — Coarse & Precise | Yes (drivers, only during an active published route) | Yes | No | App Functionality |
| User Content — Other (pet notes, access instructions) | Yes | Yes | No | App Functionality |
| Identifiers — User ID | Yes | Yes | No | App Functionality |
| Diagnostics — Crash/Performance (se habilitado) | Yes | No | No | App Functionality |

Notes to fill in App Store Connect:
- "Data used to track you": **No**.
- Location is **not** used in the background: usage only while the app is open with an active route.
- Retention statement matches the published Privacy Policy (driver location deleted after 24 h).

## Screenshots necessários

Required sizes (iPhone): **6.9"** (1320×2868) and **6.5"** (1242×2688); iPad (if `supportsTablet` stays true): **13"** (2064×2752).

Plan: take them from the real app running on an iPhone (TestFlight build) on these screens:

1. Login screen (brand)
2. Calendar — day view with daycare/boarding and transport badges
3. Dispatch board — two drivers, badges, published state
4. Dispatch — Optimize result with arrival times
5. Driver route — stop card with address and access instructions
6. Driver — offline banner and sync status

Optional captions: "Plan the day", "Publish runs in one tap", "Every pickup, live", "Works without signal".

## Review notes (para a Apple, no App Review Information)

> Demo account for review:
> Manager — raphael@autonestmobile.com / (senha de teste enviada no campo de notas)
> Driver — rafael@packpawsclub.driver / (idem)
>
> The app requires an organisation account created by the business. Location permission is optional and only used while a driver has an active published route; the reviewer can decline it and still use every screen.
