# 09 — Publicação de conteúdo

O problema: o conteúdo das casas é **editável no backoffice** (vive no DynamoDB), mas
o site é **estático** (vive no S3, para custar centavos e ter SEO bom). Algo precisa
levar um ao outro.

Ver [ADR-009](../adr/ADR-009-conteudo-no-banco-com-publicacao.md) para as alternativas
avaliadas.

## O que é dinâmico e o que é publicado

| Conteúdo | Muda | Como é servido |
|---|---|---|
| Fotos, descrição, comodidades, regras, localização | raramente | **Publicado** — HTML estático |
| Textos legais, FAQ, WhatsApp | raramente | **Publicado** |
| Tabela de preços | ocasionalmente | **Publicada** nas páginas + **dinâmica** na cotação |
| Disponibilidade (noites ocupadas) | sempre | **Dinâmica** — API, cache 60 s |
| Cotação | sempre | **Dinâmica** — API, sem cache |
| Solicitação de reserva | — | **Dinâmica** |

Regra: **o que vende é publicado, o que decide é dinâmico.**
Nunca publicar disponibilidade em arquivo estático — 60 s de cache já é o limite
tolerável para não mostrar uma data ocupada como livre.

## O fluxo

```
Admin edita uma casa no backoffice
        │  casa.publicacaoPendente = true
        ▼
Backoffice mostra a faixa: "Há alterações não publicadas  [ Publicar site ]"
        │
        │  POST /api/admin/publicar
        ▼
api-admin:
  1. valida: existe ao menos uma casa ATIVA, todas com foto principal e texto alternativo
  2. grava PUBLICACAO/ATUAL = EM_ANDAMENTO (condicional: não pode já estar em andamento)
  3. invoca `publicar-conteudo` de forma ASSÍNCRONA (InvocationType: Event)
  4. responde 202 imediatamente
        ▼
publicar-conteudo (Lambda):
  1. lê todas as casas ATIVAS + preços + CONFIG/GERAL
  2. monta os JSONs públicos:
       _dados/casas.json
       _dados/casas/<slug>.json
       _dados/config.json
  3. grava no S3 com Cache-Control: public, max-age=60
  4. dispara o rebuild do site (ver abaixo)
  5. cria invalidação no CloudFront: /_dados/*  e  /index.html  e  /casas/*
  6. limpa publicacaoPendente das casas publicadas
  7. grava PUBLICACAO/ATUAL = CONCLUIDA (ou FALHOU + erro)
        ▼
Backoffice consulta GET /api/admin/publicar/status a cada 3 s (até 3 min)
e mostra "Publicado" ou o erro
```

O passo 3 da `api-admin` é o que mantém a promessa de **nunca bloquear o usuário**:
publicar pode levar um minuto, e o admin não fica olhando um spinner travado.

## Rebuild do site estático

As páginas HTML precisam ser regeradas pelo Astro para que o conteúdo apareça no
HTML servido (e não só via JavaScript) — é isso que dá o SEO.

**Mecanismo: GitHub Actions acionado por `repository_dispatch`.**

```
publicar-conteudo
   │  POST https://api.github.com/repos/<owner>/<repo>/dispatches
   │  { "event_type": "publicar-site", "client_payload": { "stage": "prod" } }
   ▼
GitHub Actions (.github/workflows/publicar.yml):
   1. checkout
   2. npm ci
   3. npm run build -w site       ← busca os JSONs de /_dados/ do S3
   4. aws s3 sync site/dist s3://<bucket> --delete --exclude "midia/*" --exclude "_dados/*"
   5. aws cloudfront create-invalidation
   6. POST de volta para /api/admin/publicar/callback com o resultado
```

| Decisão | Motivo |
|---|---|
| GitHub Actions e não CodeBuild | Actions tem free tier generoso; CodeBuild cobra por minuto de build |
| Credencial AWS por **OIDC** | Nenhuma chave de longo prazo. Role assumível só pelo repositório e pelo branch `main` |
| Token do GitHub no SSM (SecureString) | Fine-grained PAT com escopo mínimo: apenas `contents: write` no repositório, para disparar o dispatch |
| `--exclude "midia/*"` no sync | Sem isso, `--delete` **apagaria todas as fotos**. Erro catastrófico e fácil de cometer |
| `--exclude "_dados/*"` | Os JSONs vêm da Lambda, não do build |

> O `--exclude "midia/*"` combinado com `--delete` é o item mais perigoso deste
> documento. Deve haver um comentário no workflow explicando, e o teste de deploy
> deve verificar que uma foto sobrevive a uma publicação.

### Nota sobre o payload do `repository_dispatch`

O `client_payload` vem de dentro do nosso sistema, mas o workflow **não deve
interpolar nada dele em comando de shell** — é a receita de injeção de comando em
pipeline. Use variáveis de ambiente com `env:` e valide `stage` contra `dev|prod`.

### Fallback sem GitHub Actions

Se o proprietário não quiser dependência do GitHub, há um caminho degradado que
**funciona** com SEO pior:

- As páginas de casa são construídas uma vez com um shell estático.
- O conteúdo é buscado de `/_dados/casas/<slug>.json` no cliente.
- O `<title>`, a meta description e o JSON-LD são injetados por uma
  **CloudFront Function** que lê... nada — ela não tem acesso ao S3.

Conclusão honesta: **não há como ter SEO bom sem rebuild**. As opções reais são
GitHub Actions (grátis), CodeBuild (pago por minuto) ou editar o conteúdo no
repositório em vez do backoffice. Escolhemos Actions.

## Os JSONs publicados

### `_dados/casas.json`
Igual à resposta de `GET /api/casas`, com `geradoEm`. Consumido pelo build e pelo
formulário de reserva.

### `_dados/casas/<slug>.json`
Igual à resposta de `GET /api/casas/{slug}`.

### `_dados/config.json`
Igual à resposta de `GET /api/config-publica`.

**Por que publicar JSON se a API já serve isso:** o build do Astro precisa ler o
conteúdo sem autenticação e sem acoplar o CI à Lambda; e, se a `api-publica` cair, as
páginas estáticas continuam no ar com o conteúdo embutido. O JSON é a fonte do build;
a API é a fonte para o que é dinâmico.

## Estados da publicação

```
         ┌───────────┐
         │ CONCLUIDA │◀────────────────────┐
         └─────┬─────┘                     │
    admin edita│                           │ sucesso
               ▼                           │
         ┌───────────┐  POST /publicar ┌───┴─────────┐
         │ PENDENTE  │────────────────▶│ EM_ANDAMENTO│
         └───────────┘                 └───┬─────────┘
               ▲                           │ erro ou timeout
               │                           ▼
               │                     ┌──────────┐
               └─────────────────────│  FALHOU  │
                     admin reenvia   └──────────┘
```

| Regra | Valor |
|---|---|
| Publicação concorrente | Rejeitada com `409 PUBLICACAO_EM_ANDAMENTO` |
| Timeout | `EM_ANDAMENTO` por mais de 10 min → tratada como `FALHOU` pelo `cron-diario` |
| Falha | Mensagem no backoffice com o erro e botão "Tentar novamente"; `ALERTA_ADMIN` |
| Conteúdo anterior | **Continua no ar.** Uma publicação que falha nunca derruba o site |

A última garantia é a mais importante: o `s3 sync` só roda após o build ter sucesso.
Build quebrado = nada é enviado = o site antigo continua servindo.

## Validações antes de publicar

| # | Validação | Severidade |
|---|---|---|
| 1 | Existe ao menos uma casa `ATIVA` | **Bloqueia** |
| 2 | Toda casa `ATIVA` tem ao menos 1 foto | **Bloqueia** |
| 3 | Toda casa `ATIVA` tem foto principal definida | **Bloqueia** |
| 4 | Toda foto tem `textoAlternativo` | **Bloqueia** (critério de acessibilidade) |
| 5 | Toda casa `ATIVA` tem configuração de preços válida | **Bloqueia** |
| 6 | `CONFIG/GERAL` tem WhatsApp e e-mails preenchidos | **Bloqueia** |
| 7 | Toda casa `ATIVA` tem `resumo` e `descricao` | **Bloqueia** |
| 8 | Alguma casa `ATIVA` tem menos de 5 fotos | Aviso |
| 9 | Algum texto legal está vazio | Aviso |

As bloqueantes retornam `422` com a lista do que falta, por casa — o admin precisa
saber **o que** corrigir, não só que falhou.

## Custo

| Item | Custo |
|---|---|
| Lambda `publicar-conteudo` | Alguns segundos por publicação → desprezível |
| GitHub Actions | Free tier (2.000 min/mês em repositório privado) |
| Invalidação do CloudFront | 1.000 caminhos/mês grátis. Usamos ~4 por publicação |
| `PUT` no S3 | Centenas por publicação → desprezível |

> Use invalidações por **prefixo** (`/_dados/*`) e não uma por arquivo, para não
> estourar a cota de 1.000 caminhos/mês com publicações frequentes.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Publicar com casa ativa sem foto | `422` listando a casa |
| 2 | Publicar duas vezes seguidas | A segunda recebe `409` |
| 3 | Build do Astro falha | Status `FALHOU`; site anterior intacto; alerta |
| 4 | `s3 sync --delete` após publicação | As fotos em `midia/` **continuam lá** |
| 5 | `publicacaoPendente` após sucesso | `false` em todas as casas publicadas |
| 6 | `EM_ANDAMENTO` há 15 min | `cron-diario` marca `FALHOU` |
| 7 | Casa muda de `ATIVA` para `INATIVA` e publica | Página removida do site e do sitemap |
| 8 | Publicação sem alterações pendentes | Permitida (republicar é inofensivo) |
