# 01 — Arquitetura

## Visão geral

```
                     ┌──────────────────────────────────────────┐
  Navegador ────────▶│              CloudFront                  │
  (público/admin)    │  (HTTPS, cache, headers de segurança)    │
                     └───┬──────────────┬───────────────┬───────┘
                         │              │               │
              /* (estáticos)    /api/admin/*        /api/*
                         │              │               │
                         ▼              ▼               ▼
                ┌────────────────┐  ┌──────────┐  ┌─────────────┐
                │ S3 (privado)   │  │api-admin │  │ api-publica │
                │ site Astro     │  │ Lambda   │  │  Lambda     │
                │ + /midia/*     │  │ JWT      │  │  anônima    │
                └────────────────┘  └────┬─────┘  └──────┬──────┘
                       ▲  OAC                 │              │
                       │                      ▼              ▼
                       │              ┌──────────────────────────┐
                       │              │   DynamoDB (tabela única) │
                       │              └──────────────────────────┘
                       │                      │
         ┌─────────────┴──────┐               ▼
         │ publicar-conteudo  │        ┌──────────┐  ┌──────────────┐
         │ (Lambda, Fase 2)   │        │   SES    │  │ SSM Param.   │
         └────────────────────┘        └──────────┘  │ Store        │
                                                      └──────────────┘
  EventBridge Scheduler (de hora em hora) ──▶ cron-diario    ──▶ DynamoDB + SES
  EventBridge Scheduler (a cada 30 min)   ──▶ cron-ical      ──▶ DynamoDB + SES
                                                                  ▲
                                               Airbnb/Booking .ics┘

  Cognito User Pool (1 usuário admin) ──▶ Hosted UI ──▶ JWT para api-admin
```

## Lambdas

| Função | Gatilho | Responsabilidade | Memória | Timeout |
|---|---|---|---|---|
| `api-publica` | Function URL via CloudFront `/api/*` | casas, disponibilidade, cotação, criar/consultar/cancelar solicitação, export iCal | 256 MB | 10 s |
| `api-admin` | Function URL via CloudFront `/api/admin/*` | tudo do backoffice | 512 MB | 15 s |
| `cron-diario` | EventBridge, de hora em hora | expirar solicitações, concluir reservas, e-mails agendados, reenvio de e-mails falhos | 256 MB | 60 s |
| `cron-ical` | EventBridge, a cada 30 min | importar calendários externos | 512 MB | 60 s |
| `publicar-conteudo` | Invocada por `api-admin` (async) | regerar os dados públicos e invalidar o CloudFront | 512 MB | 120 s |

Todas em Node.js (runtime LTS mais recente suportado), TypeScript, bundle com esbuild,
arquitetura **arm64** (Graviton — ~20% mais barata que x86 com a mesma performance),
logs no CloudWatch com **retenção de 14 dias**.

> A Lambda `webhook-mp` da especificação inicial **não existe** — não há pagamento online.

## Por que Lambda Function URL e não API Gateway

Function URL é gratuita; API Gateway HTTP API custa ~US$ 1,00 por milhão de requisições.
No nosso volume a diferença é de centavos, mas Function URL também elimina uma peça
e o CORS (tudo sob o mesmo domínio do CloudFront). Ver
[ADR-006](../adr/ADR-006-lambda-function-urls.md).

**Pegadinha conhecida e obrigatória de respeitar:** não use **OAC do CloudFront** com
Function URL para rotas `POST`. O OAC assina a requisição e exige que o cliente envie
`x-amz-content-sha256` com o hash do corpo, o que um navegador não faz. Resultado:
todo `POST` falha com `403`.

**Solução adotada:** Function URL com `AuthType: NONE`, e **toda** autorização feita
dentro da Lambda (JWT do Cognito em `/api/admin/*`, token de acesso nas rotas de
reserva). A Function URL fica pública na internet, então:

- Nenhum endpoint confia em "veio do CloudFront".
- `api-admin` valida o JWT em **toda** requisição, antes de qualquer leitura.
- Concorrência reservada baixa nas duas Lambdas limita o dano de um ataque de volume.
- Um cabeçalho secreto adicionado pelo CloudFront (`x-origem-cdn`, valor no SSM) é
  verificado como **defesa em profundidade**, nunca como autorização.

## Roteamento no CloudFront

| Padrão | Origem | Cache | Observações |
|---|---|---|---|
| `/api/admin/*` | Function URL `api-admin` | **desabilitado** | Encaminha `Authorization`; `OPTIONS` incluído |
| `/api/*` | Function URL `api-publica` | política por rota (ver abaixo) | Encaminha `Content-Type`; não encaminha cookies |
| `/midia/*` | S3 (OAC) | 1 ano, imutável | Nome do arquivo contém hash |
| `/_dados/*` | S3 (OAC) | 60 s | JSON público gerado pela publicação |
| `/*` | S3 (OAC) | `index.html` 60 s; assets com hash 1 ano | CloudFront Function reescreve URLs |

### Cache por rota pública

| Rota | TTL | Chave de cache |
|---|---|---|
| `GET /api/casas` | 300 s | caminho |
| `GET /api/casas/{slug}` | 300 s | caminho |
| `GET /api/casas/{id}/disponibilidade` | 60 s | caminho + querystring `de`, `ate` |
| `GET /api/config-publica` | 300 s | caminho |
| `POST /api/cotacao` | 0 | — |
| `POST /api/solicitacoes` | 0 | — |
| `GET /api/solicitacoes/{id}` | 0 | **nunca** cachear: tem dado pessoal e token |
| `GET /api/casas/{id}/calendario.ics` | 60 s | caminho + querystring `t` |

> `GET /api/solicitacoes/{id}` precisa de `CachePolicy` com TTL 0 **e**
> `Cache-Control: private, no-store` na resposta. Cachear essa rota no CloudFront
> vazaria os dados de um hóspede para outro. É o erro mais perigoso possível neste
> projeto — deve haver um teste de infraestrutura verificando a política.

### CloudFront Function (viewer request)

Uma função leve (não Lambda@Edge — Functions são muito mais baratas) para:

1. Reescrever URL sem extensão para `index.html` (`/a-casa` → `/a-casa/index.html`).
2. Rotear `/reserva/*` para a página SPA de acompanhamento.
3. Rotear `/admin/*` para a SPA do backoffice.

### Response Headers Policy

Aplicada a todas as respostas:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY            (exceto onde o mapa precisa de iframe próprio)
Content-Security-Policy: ver 05-conformidade/01-seguranca.md
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

## Camadas do backend

```
handlers/        parsing da requisição, autorização, resposta HTTP. Sem regra de negócio.
   │
   ├──▶ domain/  regras puras: preço, disponibilidade, datas, transições, cancelamento.
   │             Sem AWS SDK, sem I/O, sem Date.now() implícito. 100% testável.
   │
   └──▶ lib/     adaptadores: DynamoDB, SES, SSM, S3, iCal, log.
```

**Regra arquitetural:** `domain/` não importa nada de `lib/` nem do AWS SDK.
Essa é a única regra de dependência do projeto, e deve ser verificada por lint
(`eslint-plugin-import` com `no-restricted-paths`) — não por disciplina.

### Módulos previstos

| Arquivo | Responsabilidade |
|---|---|
| `domain/precos.ts` | `calcularCotacao` e validação da configuração de preços |
| `domain/disponibilidade.ts` | noites de uma estadia, noite livre/ocupada, merge de ocupações |
| `domain/datas.ts` | aritmética de datas em `America/Sao_Paulo`, formatação pt-BR |
| `domain/reservas.ts` | máquina de estados, transições permitidas, efeitos esperados |
| `domain/cancelamento.ts` | faixa e percentual sugerido |
| `domain/templates.ts` | validação e renderização de template (substituição + escape) |
| `lib/db.ts` | cliente DynamoDB, builders de chave, transações |
| `lib/ses.ts` | envio de e-mail com timeout e retry |
| `lib/ssm.ts` | leitura de parâmetros com cache em memória por invocação |
| `lib/s3.ts` | presigned POST, publicação de JSON |
| `lib/ical.ts` | parse e geração de `.ics` |
| `lib/auth.ts` | verificação de JWT Cognito e de token de acesso |
| `lib/log.ts` | log estruturado com mascaramento de dados pessoais |
| `lib/erros.ts` | erros de domínio → status HTTP + código |

## Pacote compartilhado

`packages/shared/src/` exporta:

- **Tipos** de todas as entidades (`Casa`, `Reserva`, `Cotacao`, `ConfigPrecos`…).
- **Schemas zod** usados tanto para validar a entrada no servidor quanto para validar
  o formulário no navegador — a mesma regra, uma só fonte.
- **Funções puras** reaproveitadas pelo frontend: formatação de moeda e data, cálculo
  de noites. `calcularCotacao` também é exportada, para o simulador dar feedback
  instantâneo sem ida ao servidor.

> O simulador no navegador usar a mesma função do servidor é conveniente, mas **não
> dispensa o recálculo no servidor**. O cliente é um atalho de UX; o servidor é a
> autoridade. Isso está escrito aqui porque é exatamente onde esse tipo de projeto
> costuma errar.

## Fluxos principais

### Criar solicitação

```
Navegador ─POST /api/solicitacoes─▶ CloudFront ─▶ api-publica
                                                      │
                                1. valida (zod) + honeypot + tempo de formulário
                                2. carrega casa e config de preços (DynamoDB)
                                3. verifica limite antiabuso por e-mail
                                4. recalcula a cotação no servidor
                                5. calcula expiraEm
                                6. TransactWriteItems:
                                     Put reserva (condicional)
                                     Put ocupação por noite (condicional)
                                     Update contador antiabuso
                                7. 409 se a condição falhar
                                8. responde { reservaId, tokenAcesso, cotacao, prazoLimite }
                                9. envia e-mails (fora do caminho crítico)
```

### Confirmar reserva

```
SPA admin ─POST /api/admin/reservas/{id}/confirmar─▶ api-admin
                                                        │
                                   1. verifica JWT Cognito
                                   2. carrega reserva
                                   3. valida transição SOLICITADA → CONFIRMADA
                                   4. TransactWriteItems:
                                        Update reserva (condicional em status)
                                        Update de cada ocupação: remove pendente/expiraEm/ttl
                                   5. responde
                                   6. envia RESERVA_CONFIRMADA
```

### `cron-diario` (de hora em hora)

```
1. Expirar: reservas SOLICITADA com expiraEm < agora
     → status EXPIRADA + apaga ocupações (transação por reserva)
     → e-mail SOLICITACAO_EXPIRADA
2. Avisar: reservas SOLICITADA que expiram em < 6 h e sem aviso enviado
     → e-mail PRAZO_EXPIRANDO_ADMIN
3. Concluir: reservas CONFIRMADA com checkout < hoje → CONCLUIDA
4. Pré-check-in: reservas CONFIRMADA com checkin == hoje + 3 → PRE_CHECKIN
5. Pós-estadia: reservas CONCLUIDA com checkout == ontem → POS_ESTADIA
6. Reenviar e-mails essenciais que falharam
7. Faxina: itens com ttl vencido que o DynamoDB ainda não removeu (opcional)

Só os passos 2 e 6 rodam a cada hora; 1 e 3 rodam a cada hora (baratos e importantes);
4 e 5 rodam apenas na execução das 09:00 America/Sao_Paulo.
```

Cada passo é **independente e idempotente**: a falha de um não impede os outros.
O handler acumula erros e, no fim, loga e envia um único `ALERTA_ADMIN` se houver falhas.

## O que deliberadamente NÃO existe

| Peça | Por quê |
|---|---|
| API Gateway | Function URL resolve de graça |
| VPC, NAT Gateway, subnets | Nenhum recurso precisa de rede privada; NAT custaria ~US$ 32/mês |
| RDS / Aurora | DynamoDB on-demand atende e cabe no free tier |
| SQS / Step Functions | Nenhum fluxo assíncrono longo o suficiente para justificar |
| WAF | ~US$ 5-8/mês. O antiabuso é feito na aplicação + concorrência reservada |
| Secrets Manager | ~US$ 0,40/segredo/mês. SSM Parameter Store padrão é grátis |
| CloudFront Lambda@Edge | CloudFront Functions custam ~1/6 e atendem |
| ElastiCache / Redis | Cache do CloudFront + cache em memória da Lambda bastam |
| Cognito Identity Pool | O JWT do User Pool é verificado direto na Lambda |
| Container / ECS / Fargate | Lambda é mais barata nesse volume |
