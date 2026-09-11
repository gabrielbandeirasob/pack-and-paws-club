# App Store — o que falta para publicar

**Pack & Paws Club** · atualizado em 12/09/2026

## Situacao

| Item | Estado |
|---|---|
| Build enviado e em teste | **14** (VALID, IN_BETA_TESTING) |
| Nome, subtitulo, descricao, palavras-chave | prontos |
| Politica de privacidade, suporte, marketing URL | prontos |
| Categoria (Business) e classificacao etaria (4+) | prontos |
| Build vinculado a versao 1.0 | pronto |
| Link publico do TestFlight | **desligado** |
| **Screenshots** | **faltam as 6 telas** |
| **Privacidade do App** | **falta preencher na tela da Apple** |
| **Direitos de conteudo** | **falta 1 clique** |
| **Telefone de contato da revisao** | **falta o numero** |
| **Preco** | **falta confirmar (gratis?)** |

## 1. Screenshots — so da para tirar no aparelho

O que a Apple pede e **print das telas do app**, nao da tela do TestFlight nem dos menus do
iPhone. Sao 6 telas:

1. **Login** (mostrando a marca)
2. **Calendar** — dia com um daycare e um boarding, com o selo de transporte
3. **Dispatch** — quadro com a rota publicada e as paradas
4. **Dispatch** — resultado do **Optimize** com os horarios de chegada
5. **Rota do motorista** — cartao da parada com endereco e instrucoes de acesso
6. **Motorista** — faixa de offline e status de sincronizacao

**Como tirar no iPhone:**
1. TestFlight → Pack & Paws Club → **Abrir**
2. Navegue ate a tela
3. Aperte **botao lateral + volume para cima** ao mesmo tempo
4. Repita nas 6 telas e me mande as imagens (pode ser por aqui)

**Eu cuido do resto:** ajusto cada imagem para o tamanho exato que a Apple exige
(**1320x2868**, iPhone 6.9") e subo pela API, com as legendas.

> Dica: se preferir nao expor nomes de clientes reais nos prints, escolha telas com dados
> neutros ou me avise que eu troco os dados antes.

## 2. Privacidade do App (questionario)

**Caminho na tela:** App Store Connect (site) → **Meus Apps** → Pack & Paws Club →
menu lateral **Privacidade do App** → **Comecar**.

Respostas (uma linha por tipo de dado):

| Tipo de dado | Coletado? | Vinculado a identidade | Rastreamento | Finalidade |
|---|---|---|---|---|
| Informacoes de contato — **Nome** | Sim | Sim | Nao | Funcionalidade do app |
| Informacoes de contato — **E-mail** | Sim | Sim | Nao | Funcionalidade do app |
| Informacoes de contato — **Telefone** | Sim | Sim | Nao | Funcionalidade do app |
| **Contatos** | Sim (somente os que o usuario escolhe importar) | Sim | Nao | Funcionalidade do app |
| **Localizacao** (aproximada e precisa) | Sim (motorista, somente com rota ativa) | Sim | Nao | Funcionalidade do app |
| **Conteudo do usuario** — outros (notas do pet, instrucoes de acesso) | Sim | Sim | Nao | Funcionalidade do app |
| **Identificadores** — ID do usuario | Sim | Sim | Nao | Funcionalidade do app |
| **Diagnosticos** — falhas/desempenho | Sim | Nao | Nao | Funcionalidade do app |

No fim do questionario:
- **"Voce usa dados para rastrear o usuario?"** → **Nao**
- Localizacao **nao** e usada em segundo plano (somente com o app aberto e rota ativa)
- Retencao: os dados seguem a Politica de Privacidade publicada (localizacao do motorista
  apagada depois de 24 h)

## 3. Direitos de conteudo (1 clique)

**Caminho:** app → **Informacoes do App** → **Direitos de Conteudo** →
marcar **"Nao, o app nao contem conteudo de terceiros"** → **Salvar**.

*(A API da Apple nao expoe esse campo — por isso e manual.)*

## 4. Ficha de revisao — falta so o telefone

Ja esta montado o que a Apple pede para revisar o app:

- **Contato:** Gabriel Sobrinho · automadigitalsup@gmail.com
- **Conta demo:** usuario de teste em uma **organizacao de teste separada** (2 clientes,
  3 caes, 2 reservas e 1 rota publicada) — **sem nenhum dado real do cliente**
- **Notas (em ingles)** explicando o fluxo: entrar como manager, ver Home/Calendar/
  Dispatch/Clients; depois entrar como motorista e ver a rota do dia
- **Falta:** o **telefone de contato**, que a Apple exige. Me passa um numero com DDD/pais
  que eu envio na hora.

## 5. Preco

A Apple ainda nao tem preco definido — sem isso nao da para submeter.
O documento do projeto diz **gratis**. Confirma? Com o "sim" eu configuro pela API.

## Depois destes 5 itens

**Submeter para a revisao da Apple.** Eu acompanho o estado pela API e aviso assim que
mudar (revisao costuma levar de 1 a 3 dias).
