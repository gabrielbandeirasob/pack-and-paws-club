# Estratégia de testes

Três camadas, todas rodando por comando. Nenhuma delas depende de macOS.

## 1. Testes unitários e de componente (rápidos)

```bash
npm test              # jest --runInBand
npm run test:coverage # com cobertura
```

- `jest-expo` + `@testing-library/react-native`.
- Cobrem a regra de negócio pura (calendário/recorrência, otimizador de rota, ETA, mapa de contatos,
  plano de cadastro de cliente, ciclo de vida da rota, offline/outbox) e as telas principais.
- **Números de 11/09/2026:** 185 testes, 37 suítes, statements 92,3% / branches 85,2% / linhas 94,2%.

## 2. Integração de banco — RLS e fluxos (`npm run test:db`)

```bash
npm run test:db       # precisa de PACKPAWS_SUPABASE_TOKEN (env ou /opt/data/.env)
```

`scripts/db-flows-test.mjs` reproduz cada fluxo do app **como usuário de verdade**:

- dentro de uma transação com `set_config('request.jwt.claims', …)` + `set local role authenticated`;
- **sempre termina em `ROLLBACK`** — no fim o script confere que nenhuma contagem mudou;
- 31 casos: manager cadastrando cliente/cão/instruções, reservas (daycare e boarding), recorrência e
  exceção, ciclo completo da rota (draft → parada → reordenar → publicar), leituras e escritas do
  motorista, e os casos que **têm** de ser recusados (motorista lendo rota/cliente de outro, anônimo
  lendo qualquer coisa, cão apontando para cliente inexistente, rota com usuário que não é motorista,
  registro em organização inexistente);
- sai com código 1 se qualquer caso falhar (pronto para CI).

**Por que existe:** o bug de produção (erro `42P17 — infinite recursion detected in policy for relation
dogs`) não aparece em teste unitário. Ele só aparece quando a RLS é avaliada de verdade. Foi exatamente
o que essa camada pegou.

## 3. O que ainda não está automatizado (e por quê)

- **E2E no aparelho (iOS):** Maestro e Detox exigem macOS/simulador. No Linux não roda iOS.
  O caminho é **Maestro Cloud** (EAS + conta), que executa os fluxos em aparelhos da nuvem.
  Alternativa local: `expo export --platform web` + Playwright, que testa a UI real no navegador
  (mesmo código React Native, precisa de um usuário de teste no banco).
- **Push notifications, permissões nativas e Localização em segundo plano:** só em aparelho real —
  fazem parte do roteiro de teste manual em TestFlight (`docs/TESTFLIGHT-CHECKLIST.md`).
