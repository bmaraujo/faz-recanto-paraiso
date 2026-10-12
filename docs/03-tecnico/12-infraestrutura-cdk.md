# 12 — Infraestrutura (AWS CDK)

Tudo é provisionado por código. Nenhum recurso criado à mão no console — exceto os
dois itens listados em "fora do CDK".

Ver [ADR-005](../adr/ADR-005-cdk-como-iac.md) para a escolha de CDK sobre SAM.

## Organização

```
infra/
├─ bin/app.ts                     entrada: instancia as stacks por stage
├─ lib/
│  ├─ stack-dados.ts              DynamoDB, SSM
│  ├─ stack-auth.ts               Cognito User Pool, App Client, domínio, grupo
│  ├─ stack-backend.ts            Lambdas, Function URLs, IAM, EventBridge, SES
│  ├─ stack-frontend.ts           S3, CloudFront, ACM, Route 53, CloudFront Function
│  ├─ stack-observabilidade.ts    alarmes, Budgets, SNS
│  └─ constructs/
│     ├─ lambda-node.ts           construct padrão de Lambda (runtime, arm64, log, env)
│     └─ parametro-seguro.ts      referência a SecureString do SSM
├─ test/                          testes de snapshot e asserções de segurança
├─ cdk.json
└─ package.json
```

### Por que várias stacks e não uma

| Stack | Motivo da separação |
|---|---|
| `dados` | Contém a tabela. **Nunca** deve ser destruída junto com o resto. `RETAIN` + deletion protection |
| `auth` | O User Pool, se recriado, perde o usuário admin. Isolar reduz o risco |
| `frontend` | Mudanças no CloudFront levam ~15 min de deploy. Isolar evita prender o deploy do backend |
| `backend` | Onde quase todo deploy acontece. Rápido e frequente |
| `observabilidade` | Depende das outras; muda raramente |

Dependências explícitas via props (passando construtos ou nomes), nunca por
`Fn::ImportValue` manual. Exports entre stacks travam recursos — o CDK resolve isso
quando as stacks estão no mesmo app.

## Stages

```ts
// bin/app.ts
const app = new cdk.App();
for (const stage of ["dev", "prod"] as const) {
  const config = carregarConfig(stage);     // infra/config/<stage>.ts
  // ... instancia as 5 stacks com sufixo -<stage>
}
```

| Diferença | `dev` | `prod` |
|---|---|---|
| Domínio | CloudFront padrão (`d111.cloudfront.net`) | domínio próprio `[DEFINIR]` |
| PITR do DynamoDB | desligado | **ligado** |
| Deletion protection | desligado | **ligado** |
| `RemovalPolicy` da tabela | `DESTROY` | **`RETAIN`** |
| SES | sandbox, remetente verificado por e-mail | domínio verificado, fora do sandbox |
| Retenção de log | 7 dias | 14 dias |
| Concorrência reservada | 2 | 5 |
| Alerta de orçamento | — | US$ 5/mês |
| iCal | desativado | conforme configuração |

> `RemovalPolicy.RETAIN` na tabela de `prod` é obrigatório. É a diferença entre um
> `cdk destroy` acidental apagar a infraestrutura e apagar **todas as reservas**.

## Recursos

### Stack `dados`

```
DynamoDB Table
  nome: recanto-paraiso-<stage>
  PK: PK (S), SK: SK (S)
  billing: PAY_PER_REQUEST
  timeToLiveAttribute: ttl
  GSI1: GSI1PK (S) / GSI1SK (S), projeção ALL
  pointInTimeRecovery: stage === "prod"
  deletionProtection: stage === "prod"
  removalPolicy: prod ? RETAIN : DESTROY
  encryption: AWS_MANAGED (grátis)

SSM Parameters (String, criados vazios pelo CDK para documentar o contrato)
  /recanto-paraiso/<stage>/site-url
  /recanto-paraiso/<stage>/origem-cdn-segredo        ← SecureString, criado fora
  /recanto-paraiso/<stage>/github/token              ← SecureString, criado fora
  /recanto-paraiso/<stage>/ical/<casaId>/<canal>     ← SecureString, criado pelo admin
```

Parâmetros `SecureString` **não** são criados pelo CDK (o CDK não suporta criar
SecureString sem expor o valor no template do CloudFormation). São criados por CLI,
uma vez, e documentados no [runbook](../04-operacao/02-runbook.md).

### Stack `auth`

```
UserPool
  signInAliases: { email: true }
  selfSignUpEnabled: false
  passwordPolicy: 12 chars, maiúscula, minúscula, número, símbolo
  mfa: OPTIONAL, TOTP            [DEFINIR]
  accountRecovery: EMAIL_ONLY
  removalPolicy: RETAIN

UserPoolClient
  authFlows: { }                 nenhum fluxo direto habilitado
  oAuth: { flows: { authorizationCodeGrant: true }, scopes: [openid, email] }
  callbackUrls: [<site>/admin/callback]
  logoutUrls:   [<site>/admin]
  generateSecret: false          ← SPA não guarda segredo
  accessTokenValidity: 1 h
  refreshTokenValidity: 30 dias

UserPoolDomain       prefixo: recanto-paraiso-<stage>
UserPoolGroup        admin
```

> `generateSecret: false` é obrigatório para SPA. Com segredo, o PKCE não funciona e
> o segredo ficaria no código do navegador.

### Stack `backend`

Construct padrão para todas as Lambdas:

```ts
// constructs/lambda-node.ts
new NodejsFunction(this, nome, {
  runtime: lambda.Runtime.NODEJS_LATEST,     // runtime LTS suportado
  architecture: lambda.Architecture.ARM_64,  // Graviton: ~20% mais barato
  memorySize, timeout,
  logRetention: stage === "prod" ? 14 : 7,
  bundling: { minify: true, sourceMap: true, format: "esm",
              externalModules: ["@aws-sdk/*"] },  // o SDK v3 já vem no runtime
  environment: { TABELA, STAGE, SITE_URL, USER_POOL_ID, ... },
  tracing: lambda.Tracing.DISABLED,          // X-Ray custa; não usamos
});
```

| Lambda | Memória | Timeout | Concorrência reservada | Function URL |
|---|---|---|---|---|
| `api-publica` | 256 MB | 10 s | 5 (prod) | sim, `NONE` |
| `api-admin` | 512 MB | 15 s | 2 | sim, `NONE` |
| `cron-diario` | 256 MB | 60 s | 1 | não |
| `cron-ical` | 512 MB | 60 s | 1 | não |
| `publicar-conteudo` | 512 MB | 120 s | 1 | não |

Concorrência reservada baixa é a nossa proteção de custo contra tráfego anormal: é o
teto absoluto de gasto com Lambda. O efeito colateral é que um pico legítimo recebe
`429` — aceitável no volume esperado e muito melhor que uma fatura surpresa.

#### IAM — privilégio mínimo, tabela por tabela

| Lambda | Permissões |
|---|---|
| `api-publica` | `dynamodb:GetItem`, `Query`, `TransactWriteItems`, `PutItem`, `UpdateItem` na tabela e no GSI1; `ses:SendEmail`; `ssm:GetParameter` no prefixo do stage |
| `api-admin` | tudo da anterior, mais `DeleteItem`; `s3:PutObject/GetObject/DeleteObject/HeadObject` **apenas em `midia/casas/*`**; `lambda:InvokeFunction` só em `publicar-conteudo` e `cron-ical` |
| `cron-diario` | `Query`, `GetItem`, `UpdateItem`, `TransactWriteItems`; `ses:SendEmail` |
| `cron-ical` | idem, mais `ssm:GetParameter` no prefixo `ical/` |
| `publicar-conteudo` | `Query`, `GetItem`, `UpdateItem`; `s3:PutObject` em `_dados/*`; `cloudfront:CreateInvalidation`; `ssm:GetParameter` no token do GitHub |

| Regra | Valor |
|---|---|
| `Resource: "*"` | **Proibido**, exceto onde a AWS não suporta ARN (`cloudfront:CreateInvalidation` aceita ARN de distribuição — usar) |
| `dynamodb:Scan` | **Não concedido a ninguém.** Se um código precisar, o modelo está errado |
| `dynamodb:DeleteTable` | Nunca concedido |
| `ses:SendEmail` | Condicionado a `ses:FromAddress` igual ao remetente configurado |
| Acesso ao bucket | Por prefixo. `api-admin` não pode tocar em `index.html` |

> Um teste de infraestrutura (`infra/test/seguranca.test.ts`) deve falhar o build se
> qualquer policy do app contiver `Action: "*"`, `Resource: "*"` em DynamoDB/S3, ou
> `dynamodb:Scan`. É muito mais confiável que revisão manual.

#### EventBridge Scheduler

```
cron-diario:  rate(1 hour)            — ver 01-arquitetura.md
cron-ical:    rate(30 minutes)        — só habilitado se houver canal ativo
```

Usar **EventBridge Scheduler**, não Rules: suporta fuso horário nativamente
(`America/Sao_Paulo`) e é o serviço atual para agendamento.

### Stack `frontend`

```
Bucket
  blockPublicAccess: BLOCK_ALL
  encryption: S3_MANAGED
  enforceSSL: true
  removalPolicy: prod ? RETAIN : DESTROY
  lifecycleRules: [{ abortIncompleteMultipartUploadAfter: 7 dias }]

Distribution
  defaultBehavior         → S3 via OAC, cache otimizado, compress: true
  "/_dados/*"             → S3 via OAC, TTL 60 s
  "/midia/*"              → S3 via OAC, TTL 1 ano
  "/api/admin/*"          → Function URL api-admin, CACHE_DISABLED,
                            allowedMethods: ALL,
                            originRequestPolicy: encaminha Authorization + Content-Type
  "/api/*"                → Function URL api-publica, allowedMethods: ALL,
                            política de cache por rota
  defaultRootObject: "index.html"
  errorResponses: 403/404 → /404.html (status 404)
  responseHeadersPolicy: ver abaixo
  priceClass: PRICE_CLASS_ALL          ← inclui São Paulo; público é só brasileiro
  httpVersion: HTTP2_AND_3
  logging: DESABILITADO                 ← custo de S3 + privacidade
  certificate: ACM em us-east-1         ← única coisa fora de sa-east-1 (ADR-011)
                                        [DEFINIR domínio]

CloudFront Function (viewer-request)   reescrita de URL e rotas de SPA
OAC                                     para o bucket
```

> **`priceClass: PRICE_CLASS_ALL`.** A classe de preço não decide *quem* acessa o
> site — decide de quais edges o CloudFront serve. A `PRICE_CLASS_100` cobre América do
> Norte e Europa: o visitante brasileiro continuaria acessando normalmente, só seria
> atendido por um edge nos EUA. Edges da América do Sul entram apenas na
> `PRICE_CLASS_ALL` (❓ confirmar na documentação da AWS).
>
> Com a origem em `sa-east-1` ([ADR-011](../adr/ADR-011-regiao-sa-east-1.md)) e público
> exclusivamente brasileiro, a classe 100 seria o pior dos dois mundos: o conteúdo
> estático viajaria ao exterior para voltar, e cada rota sem cache
> (`POST /api/cotacao`, `POST /api/solicitacoes`) pagaria uma travessia Brasil ↔ EUA
> **extra** para acabar em São Paulo.
>
> **Custo:** o egress por GB na América do Sul é mais caro (❓ tipicamente ~2-3× a
> tarifa dos EUA — verificar na calculadora). No volume previsto (~5 GB/mês) tudo cabe
> no free tier do CloudFront, então a diferença esperada é **US$ 0,00**. A tarifa mais
> alta só passa a importar se o tráfego estourar o free tier — e aí o gatilho é
> comprimir as fotos, não voltar a servir do exterior. Ver
> [custos](../04-operacao/03-custos.md).

#### Pegadinha: OAC + Function URL + POST

Documentada em [01 — Arquitetura](./01-arquitetura.md). Resumo:
**não use OAC nas origens de Function URL**. Use `FunctionUrlAuthType.NONE` e valide
na Lambda. Um comentário no CDK deve registrar isso, porque "Function URL sem OAC"
parece um erro de segurança para quem revisa sem contexto.

#### Response Headers Policy

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
Content-Security-Policy: ver 05-conformidade/01-seguranca.md
```

### Stack `observabilidade`

```
SNS Topic  alertas-<stage>  → assinatura por e-mail do admin

Alarmes (ver 13-observabilidade.md):
  Erros da api-publica, api-admin, crons
  Throttle das Lambdas
  Erros de sistema do DynamoDB
  Taxa de bounce/complaint do SES
  Taxa de 5xx do CloudFront

AWS Budgets (só prod)
  US$ 5/mês, alerta em 80% do previsto e em 100% do real → e-mail
```

## Fora do CDK (deliberadamente)

| Item | Por quê | Como fazer |
|---|---|---|
| Usuário admin do Cognito | Senha não pode passar pelo IaC | CLI, uma vez — ver [auth](./08-autenticacao-e-autorizacao.md) |
| Parâmetros `SecureString` do SSM | O CDK exporia o valor no template | `aws ssm put-parameter --type SecureString` |
| Verificação de domínio no SES | Depende de registros DNS externos `[DEFINIR]` | Console + DNS |
| Saída do sandbox do SES | Chamado de suporte | Console. **Bloqueador de produção** |
| Role OIDC do GitHub Actions | Criada **uma vez por conta**, compartilhada entre stages | CDK em uma stack `bootstrap` separada, aplicada manualmente |

Cada item acima está no [runbook](../04-operacao/02-runbook.md) com o comando exato.

## Testes de infraestrutura

`infra/test/`:

| Teste | Verifica |
|---|---|
| `snapshot.test.ts` | Template não muda sem intenção |
| `seguranca.test.ts` | Nenhum `Action: "*"`; nenhum `dynamodb:Scan`; bucket sem acesso público; `enforceSSL`; Function URL com `NONE` **e** a Lambda com o env de validação de JWT |
| `cache.test.ts` | `/api/solicitacoes/*` com **TTL 0**; `/midia/*` com TTL longo; `/api/admin/*` com cache desabilitado |
| `retencao.test.ts` | Tabela de `prod` com `RETAIN` e PITR; log groups com retenção definida |
| `custo.test.ts` | Nenhum NAT Gateway, ALB, RDS, EC2, WAF ou Secrets Manager no template |

O `custo.test.ts` é a forma mais eficaz de defender a meta de US$ 3/mês: um recurso
caro adicionado por descuido falha o build, em vez de aparecer na fatura.

## Comandos

```bash
cd infra
npm run build
npx cdk diff  --context stage=dev
npx cdk deploy --context stage=dev --all
npx cdk deploy --context stage=prod --all --require-approval broadening
```

`--require-approval broadening` em `prod` exige confirmação quando o deploy amplia
permissões de IAM. Nunca use `--require-approval never` em `prod`.

Ordem na primeira aplicação: `dados` → `auth` → `backend` → `frontend` → `observabilidade`.
O CDK resolve a ordem automaticamente com `--all`; a lista serve para diagnóstico quando
algo falha no meio.
