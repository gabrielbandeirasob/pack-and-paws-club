# Resolver as 2 pendencias na App Store Connect

**Pack & Paws Club** · passo a passo · 12/09/2026

## Situacao (so faltam estas duas)

| Item | Estado |
|---|---|
| Build 15 vinculado a versao da loja | pronto |
| 6 telas (screenshots) | prontas |
| Conta demo, contato e notas para o revisor | prontos |
| Preco (Free) | pronto |
| Compliance de criptografia | pronto (`usesNonExemptEncryption: false`) |
| **Privacidade do App** | **falta marcar** |
| **Direitos de conteudo** | **falta marcar** |

## Como entrar

1. Abra **https://appstoreconnect.apple.com** e faca login
2. Clique em **Meus Apps** → **Pack & Paws Club**

---

## Pendencia 1 — Direitos de conteudo (1 minuto)

1. No menu da esquerda, clique em **Informacoes do App**
2. Role a pagina ate **Direitos de Conteudo**
3. Clique em **Editar**
4. Marque **"Nao, o app nao contem conteudo de terceiros"**
5. Clique em **Salvar** (canto superior direito)

Pronto. (A API da Apple nao aceita mais esse campo — por isso e manual.)

---

## Pendencia 2 — Privacidade do App (5 a 10 minutos)

1. No menu da esquerda, clique em **Privacidade do App**
2. Clique em **Comecar** (se ja tiver algo, **Editar**)
3. Na pergunta *"Voce ou seus parceiros de terceiros coletam dados deste app?"*
   → marque **Sim** e clique em **Avancar**

### 3.1 O que marcar (a tela agrupa por categoria)

| Categoria na tela | O que marcar dentro dela |
|---|---|
| **Informacoes de contato** | **Nome**, **E-mail**, **Numero de telefone** |
| **Contatos** | a categoria **Contatos** |
| **Localizacao** | **Localizacao precisa** e **Localizacao aproximada** |
| **Conteudo do usuario** | **Outro conteudo do usuario** |
| **Identificadores** | **ID do usuario** |
| **Diagnosticos** | **Dados de falhas** e **Dados de desempenho** |

### 3.2 Para cada tipo marcado, a Apple pergunta

| Pergunta na tela | Resposta |
|---|---|
| Os dados sao vinculados a identidade do usuario? | **Sim** |
| ...exceto para **Dados de falhas** e **Dados de desempenho** | **Nao** |
| Os dados sao usados para rastrear o usuario? | **Nao** |
| Finalidade | marque **Funcionalidade do app** |

> A Apple normalmente ja pre-marca essas opcoes quando voce marca o tipo de dado —
> so confira antes de avancar.

### 3.3 No fim

- *"Voce usa dados para rastrear o usuario?"* → **Nao**
- Clique em **Publicar** (botao azul no canto superior direito)

O estado deve mudar para **Publicado** (ou "Enviado para analise").

---

## Depois destas duas

Me manda um "feito" que eu **submeto para a revisao da Apple** na hora e acompanho:
- revisao costuma levar **1 a 3 dias**
- se a Apple pedir algo, eu vejo a mensagem pela API e te aviso
- a conta demo do revisor ja esta configurada (organizacao de teste, sem dados reais)
