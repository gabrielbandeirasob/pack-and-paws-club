# Destravar o push — 2 passos no portal da Apple

**Por que:** o aviso de "rota publicada" no celular do motorista exige uma capacidade que só
existe na conta Apple (a minha chave de API não cria chave de push). O código já está pronto e
testado — falta só ligar essa chave.

**Tempo:** ~5 minutos. **Onde:** portal do desenvolvedor Apple (não é o App Store Connect).

---

## Passo 1 — Habilitar Push Notifications no app

1. Abra **developer.apple.com** e faça login na conta da equipe.
2. Entre em **Certificates, Identifiers & Profiles** (Certificados, Identificadores e Perfis).
3. No menu da esquerda, clique em **Identifiers** (Identificadores).
4. Clique em **br.com.automadigital.app** (o app do Pack & Paws).
5. Na lista **Capabilities** (Recursos), marque a caixa **Push Notifications**.
6. Clique em **Save** (Salvar) no canto superior direito. Vai aparecer um aviso de que os
   perfis serão regenerados — pode confirmar.

## Passo 2 — Criar a chave de push (APNs) e me enviar

1. No mesmo site, no menu da esquerda, clique em **Keys** (Chaves).
2. Clique no **➕** (Create a key).
3. Nome da chave: **Pack & Paws Push**
4. Marque **Apple Push Notifications service (APNs)**.
5. Clique em **Continue** (Continuar) → **Register** (Registrar).
6. Clique em **Download** (Baixar).

⚠️ **O arquivo `.p8` só pode ser baixado UMA vez.** Se perder, precisa criar outra chave.
Guarde numa pasta segura antes de fechar a página.

7. Anote o **Key ID** que aparece na tela (10 caracteres) e me mande:
   - o arquivo **.p8** (pode mandar por aqui)
   - o **Key ID**

**Do meu lado eu já tenho:** Team ID `957KA752J5`, bundle `br.com.automadigital.app` e a chave
de API da App Store Connect.

---

## O que eu faço quando receber

1. Subo a chave para o EAS (credencial de push do projeto).
2. Volto a habilitar o plugin de notificações no `app.json`.
3. Gero o **build 17** (que já vai ser a versão 1.1 da loja).
4. Publico no TestFlight e testo: publico uma rota de verdade e o motorista recebe o aviso.

## Se preferir outro caminho

- **Você mesmo autoriza o EAS:** eu rodo o passo de credencial e você digita o Apple ID, a
  senha e o código de 2FA quando ele pedir. (Não é o recomendado — envolve senha no chat.)
- **Deixar sem push por enquanto:** o app funciona normalmente; o motorista só não recebe o
  aviso automático — ele vê a rota ao abrir o app. É o estado atual do build 16.
