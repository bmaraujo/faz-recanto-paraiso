# 01 — Ambientes e deploy

## Ambientes

| | `dev` | `prod` |
|---|---|---|
| Conta AWS | **a mesma** (`627010764306`) `[DEFINIR]` | a mesma |
| Região | `sa-east-1` (certificado em `us-east-1`) | `sa-east-1` (certificado em `us-east-1`) |
| Domínio | CloudFront padrão | domínio próprio `[DEFINIR]` |
| Tabela | `recanto-paraiso-dev` | `recanto-paraiso-prod` |
| `RemovalPolicy` da tabela | `DESTROY` | **`RETAIN`** |
| PITR | desligado | **ligado** |
| Deletion protection | desligado | **ligada** |
| SES | sandbox, destinatários verificados | domínio verificado, fora do sandbox |
| Retenção de log | 7 dias | 14 dias |
| Concorrência reservada | 2 | 5 |
| Orçamento (Budgets) | — | US$ 5/mês |
| iCal | desativado | conforme configuração |
| Dados | fictícios | reais |

> **Uma conta para os dois stages** é uma escolha de custo e simplicidade: separar em
> contas exigiria AWS Organizations e um bootstrap de CDK por conta. O isolamento vem
> do sufixo `-<stage>` em todo recurso e de IAM por recurso.
>
> **Risco aceito e mitigado:** um `cdk deploy` apontado para o stage errado. Mitigação:
> `--context stage=` obrigatório (sem padrão), `--require-approval broadening` em
> `prod`, `RETAIN` + deletion protection na tabela de produção.

## Pré-requisitos (uma vez por conta)

```bash
# 1. Bootstrap do CDK
npx cdk bootstrap aws://627010764306/sa-east-1
npx cdk bootstrap aws://627010764306/us-east-1   # só para o certificado ACM

# 2. Role OIDC para o GitHub Actions (sem chave de longo prazo)
cd infra && npx cdk deploy RecantoParaisoBootstrap --context stage=prod
```

Depois, os passos manuais do [runbook](./02-runbook.md): parâmetros `SecureString`,
usuário do Cognito, verificação de domínio no SES e saída do sandbox.

## Deploy da infraestrutura

```bash
cd infra
npm ci
npm run build

npx cdk diff   --context stage=dev            # SEMPRE antes do deploy
npx cdk deploy --context stage=dev --all

npx cdk diff   --context stage=prod
npx cdk deploy --context stage=prod --all --require-approval broadening
```

**`cdk diff` antes de todo deploy é obrigatório**, inclusive em `dev`. É a única
oportunidade de perceber que uma mudança vai recriar a tabela ou o User Pool.

Ordem na primeira aplicação (o CDK resolve sozinho com `--all`; a lista serve para
diagnóstico): `dados` → `auth` → `backend` → `frontend` → `observabilidade`.

### Sinais de alerta no `cdk diff`

Se o diff mostrar qualquer um destes, **pare**:

| Sinal | Significa |
|---|---|
| `[-] AWS::DynamoDB::Table` | A tabela será **destruída** |
| `Replacement: true` em `AWS::DynamoDB::Table` | A tabela será **recriada vazia** |
| `[-] AWS::Cognito::UserPool` | O usuário admin será perdido |
| `[-] AWS::S3::Bucket` | As fotos serão perdidas |
| `AWS::CloudFront::Distribution` com mudança de `Aliases` | O domínio sai do ar durante a troca |

## Deploy do site

```bash
npm run deploy:site -- --stage=prod
```

O script (`scripts/deploy-site.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail

STAGE="${1:?informe o stage}"
BUCKET=$(aws ssm get-parameter --name "/recanto-paraiso/$STAGE/bucket-site" --query Parameter.Value --output text)
DIST=$(aws ssm get-parameter --name "/recanto-paraiso/$STAGE/distribuicao-id" --query Parameter.Value --output text)

npm run build -w site

# ATENÇÃO: os --exclude são obrigatórios.
# Sem eles, o --delete APAGA TODAS AS FOTOS DAS CASAS (midia/) e os
# dados publicados (_dados/), que não estão versionados no S3.
aws s3 sync site/dist "s3://$BUCKET" \
  --delete \
  --exclude "midia/*" \
  --exclude "_dados/*"

aws cloudfront create-invalidation \
  --distribution-id "$DIST" \
  --paths "/" "/index.html" "/casas/*" "/sitemap.xml"
```

> O comentário no script não é decoração. `aws s3 sync --delete` sem os `--exclude` é a
> operação mais destrutiva deste projeto, e o versionamento do bucket está **desligado**
> por custo. Há um teste de deploy que verifica que uma foto sobrevive a uma publicação
> ([UC-A14](../02-casos-de-uso/admin/UC-A14-publicar-site.md) caso 14).

## Deploy do backend

Faz parte do `cdk deploy` da stack `backend` — o `NodejsFunction` do CDK roda o esbuild
e empacota. Não há passo separado.

```bash
cd infra && npx cdk deploy RecantoParaisoBackend-prod --context stage=prod
```

## Ordem recomendada em uma mudança completa

```
1. npm test          (backend + infra)
2. cdk diff          → revisar
3. cdk deploy        (backend primeiro, se houver mudança de API)
4. npm run deploy:site
5. smoke test        (abaixo)
```

Backend antes do site: se a API ganhou um campo novo que o site consome, o site
publicado antes quebraria. O inverso (API nova, site antigo) é compatível, porque
adicionar campo não remove nada.

> Essa regra implica que **toda mudança de API é retrocompatível** por algumas horas.
> Remover um campo exige dois deploys: primeiro parar de usá-lo no site, depois removê-lo
> da API.

## Smoke test pós-deploy

```bash
npm run smoke -- --stage=prod
```

Verifica, em sequência, abortando no primeiro erro:

| # | Verificação |
|---|---|
| 1 | `GET /api/saude` → `200` com a `versao` esperada |
| 2 | `GET /api/casas` → `200` com ao menos uma casa |
| 3 | `GET /api/casas/<slug>` → `200` |
| 4 | `GET /api/casas/<id>/disponibilidade?de=&ate=` → `200` |
| 5 | `POST /api/cotacao` com datas válidas → `200` com total > 0 |
| 6 | `GET /api/admin/painel` **sem** token → `401` |
| 7 | `GET /api/solicitacoes/qualquer?t=errado` → `404` |
| 8 | Home → `200`, com `<title>` e o nome da fazenda no HTML |
| 9 | Cabeçalhos de segurança presentes (HSTS, nosniff, CSP) |
| 10 | Uma foto conhecida → `200` com `Cache-Control` de 1 ano |

Os testes 6 e 7 são os mais importantes: verificam que a autorização está ativa em
produção. Um deploy que quebra a validação de JWT passaria todos os outros.

## GitHub Actions

Dois workflows:

### `.github/workflows/ci.yml`
Em todo push e PR: `npm ci`, `tsc --noEmit`, lint, testes unitários, testes de
integração (DynamoDB Local), testes de CDK, Lighthouse CI quando `site/` mudou.

### `.github/workflows/publicar.yml`
Disparado por `repository_dispatch` (`event_type: publicar-site`) pela Lambda
`publicar-conteudo` ([UC-A14](../02-casos-de-uso/admin/UC-A14-publicar-site.md)).

```yaml
permissions:
  id-token: write      # OIDC
  contents: read

env:
  STAGE: ${{ github.event.client_payload.stage }}

steps:
  - name: Validar stage
    run: |
      case "$STAGE" in dev|prod) ;; *) echo "stage inválido"; exit 1 ;; esac
```

| Decisão | Motivo |
|---|---|
| Credencial por **OIDC** | Nenhuma chave de longo prazo no GitHub |
| Role restrita ao repositório e ao branch `main` | Um fork não assume a role |
| `client_payload` via `env:`, nunca interpolado em shell | Injeção de comando em pipeline |
| `stage` validado contra allowlist | Idem |
| Deploy de infraestrutura **não** é automático | Mudança de infraestrutura é decisão humana |

> Só a **publicação de conteúdo** é automatizada. `cdk deploy` continua manual, de
> propósito: em um projeto de um desenvolvedor, deploy automático de infraestrutura
> troca uma inconveniência pequena (rodar um comando) por um risco grande (recriar a
> tabela às 3h da manhã).

## Rollback

| O que quebrou | Como voltar |
|---|---|
| Site estático | `git revert` + `npm run deploy:site` (~2 min) |
| Lambda | `git revert` + `cdk deploy` da stack `backend` (~3 min) |
| Configuração de CloudFront | `cdk deploy` da versão anterior (~15 min — é o mais lento) |
| Conteúdo (casa, preço, template) | Restaurar versão no backoffice ([UC-A04](../02-casos-de-uso/admin/UC-A04-gerenciar-precos.md), [UC-A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md)) |
| Dados corrompidos | PITR do DynamoDB — ver [runbook](./02-runbook.md) |

**Não há deploy canário nem blue/green.** Com esse volume e esse orçamento, não se
paga. O que substitui: testes antes, smoke test depois, e rollback rápido.

## Versionamento

Cada deploy injeta na Lambda e no site:

```
VERSAO = <AAAA.MM.DD>-<hash curto do commit>     ex.: 2026.10.11-a1b2c3d
```

Exposta em `GET /api/saude` e em um comentário HTML na home. É o que responde "o deploy
foi?" sem adivinhação.

## Checklist antes do primeiro deploy em produção

- [ ] Todos os `[DEFINIR]` de [pendências](../06-planejamento/02-pendencias-definir.md) resolvidos
- [ ] Domínio registrado e DNS apontando
- [ ] Certificado ACM emitido em `us-east-1` (exigência do CloudFront; o resto em `sa-east-1`)
- [ ] Domínio verificado no SES com DKIM, SPF e DMARC
- [ ] **SES fora do sandbox** (chamado aberto com antecedência)
- [ ] Parâmetros `SecureString` criados
- [ ] Usuário admin criado no Cognito e no grupo `admin`
- [ ] Alerta de orçamento (Budgets) configurado e testado
- [ ] PITR e deletion protection ligados na tabela
- [ ] Ao menos uma casa cadastrada, completa e publicada
- [ ] Templates de e-mail revisados pelo proprietário
- [ ] Textos legais preenchidos
- [ ] Smoke test passando
- [ ] Lighthouse ≥ 90 nas páginas públicas
- [ ] Teste real: solicitar uma reserva, confirmar e receber os e-mails
