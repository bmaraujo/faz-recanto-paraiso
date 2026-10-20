# infra — Infrastructure as Code (AWS CDK)

Toda a infraestrutura AWS deste projeto. **Nenhum recurso é criado pelo console**,
exceto os itens listados em "fora do CDK" na documentação.

Ver [docs/03-tecnico/12-infraestrutura-cdk.md](../docs/03-tecnico/12-infraestrutura-cdk.md).

## Estrutura prevista

```
bin/app.ts                     entrada: instancia as stacks por stage
lib/
  stack-dados.ts               DynamoDB, SSM
  stack-auth.ts                Cognito User Pool, App Client, domínio, grupo
  stack-backend.ts             Lambdas, Function URLs, IAM, EventBridge
  stack-frontend.ts            S3, CloudFront, ACM, Route 53, CloudFront Function
  stack-observabilidade.ts     alarmes, Budgets, SNS
  constructs/
    lambda-node.ts             construct padrão de Lambda (arm64, log, bundle)
    parametro-seguro.ts        referência a SecureString do SSM
config/
  dev.ts, prod.ts              configuração por stage
test/
  snapshot.test.ts             template não muda sem intenção
  seguranca.test.ts            nenhum Action:*, nenhum Scan, bucket privado
  cache.test.ts                TTL 0 em /api/solicitacoes/*, cache longo em /midia/*
  retencao.test.ts             RETAIN e PITR em prod
  custo.test.ts                nenhum NAT, ALB, RDS, EC2, WAF, Secrets Manager
```

## Comandos

```bash
npm run build
npx cdk diff   --context stage=dev            # SEMPRE antes do deploy
npx cdk deploy --context stage=dev --all
npx cdk deploy --context stage=prod --all --require-approval broadening
npm test                                       # testes de infraestrutura
```

`--context stage=` é **obrigatório** e não tem valor padrão, de propósito.

## Situação atual

| Item | Situação |
|---|---|
| `stack-dados` (tabela, GSI1, TTL, SSM `site-url`) | ✅ |
| `stack-auth` (User Pool, App Client PKCE, domínio, grupo `admin` — UC-A01) | ✅ |
| `stack-frontend` — só o bucket S3 (UC-A03), sem nome fixado (único globalmente) | ✅ |
| `stack-backend` — Lambdas `api-publica`/`api-admin`, Function URL `NONE`, IAM por ação explícita (sem `dynamodb:Scan`; S3 restrito a `midia/casas/*`); env `BUCKET` só na `api-admin` (UC-A03) | ✅ |
| `constructs/lambda-node.ts` (`lambda.Function` + bundle do `backend/esbuild.config.mjs`, não `NodejsFunction`) | ✅ |
| `config/dev.ts`, `config/prod.ts` | ✅ |
| `test/custo.test.ts`, `test/retencao.test.ts`, `test/seguranca.test.ts`, `test/snapshot.test.ts` | ✅ 48 testes, cobrindo as quatro stacks acima |
| `test/cache.test.ts` | ⬜ — nasce com a `Distribution` do CloudFront (ainda não construída) |
| `cron-diario`/`cron-ical`/`publicar-conteudo` em `stack-backend` | ⬜ — nenhum handler escrito ainda |
| Resto de `stack-frontend` (CloudFront, ACM, Route 53, CloudFront Function, OAC) | ⬜ — depende da pendência de domínio (8.1) |
| `stack-observabilidade` | ⬜ |
| `constructs/parametro-seguro.ts` | ⬜ |
| **`cdk deploy` de verdade** | ⬜ — só `synth`/`diff` (somente leitura) rodaram até agora, contra a conta real `627010764306`, para as quatro stacks |

**Pré-requisito de `stack-backend`:** `npm run build -w backend` precisa ter
rodado antes de `cdk synth`/`deploy` — a Lambda empacota `backend/dist/handlers`
(bundle do esbuild), não recompila nada.

`siteUrl` em `config/dev.ts` aponta para `http://localhost:4321` (callback do Cognito):
a distribuição CloudFront ainda não existe para dar um domínio real de `dev`. Trocar
quando ela nascer.

Ver [docs/06-planejamento/03-progresso-de-implementacao.md](../docs/06-planejamento/03-progresso-de-implementacao.md)
para o registro completo, incluindo a pegadinha de região já encontrada
(`CDK_DEFAULT_REGION` do perfil local pode não ser `sa-east-1`).
