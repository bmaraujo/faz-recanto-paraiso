# CLAUDE.md — Recanto Paraíso

Guia para o Claude Code trabalhar neste repositório.

## O que é este projeto

Site de aluguel de casas de temporada da fazenda Recanto Paraíso.
**O site não processa pagamentos** — ele mostra disponibilidade, calcula valor estimado,
recebe solicitações de reserva (que seguram as datas por um prazo) e coloca o
interessado em contato com o administrador. O pagamento acontece fora do site.

Há um **backoffice** onde o administrador cadastra casas, fotos e preços, bloqueia
períodos, confirma/recusa reservas e **edita os textos dos e-mails**.

## Antes de codificar

1. Leia [`docs/README.md`](./docs/README.md) — índice da documentação.
2. Leia o caso de uso correspondente em [`docs/02-casos-de-uso/`](./docs/02-casos-de-uso/README.md).
   Cada UC tem regras de negócio, contrato de API, validações e critérios de aceite.
3. Confira os [ADRs](./docs/adr/README.md) antes de propor outra tecnologia — as decisões
   já estão justificadas, inclusive as que divergem da especificação inicial.
4. Respeite a [fase atual](./docs/06-planejamento/01-fases-e-criterios-de-aceite.md).
   Não implemente o que pertence a uma fase posterior.

## Regras não negociáveis

- **Custo primeiro.** Meta: até US$ 3/mês na AWS. Nenhum recurso pago recorrente
  (EC2, RDS, NAT Gateway, ALB, WAF, Secrets Manager, API Gateway) sem perguntar.
- **Dinheiro sempre em centavos (inteiro).** Nunca `float` para valores monetários.
- **Datas de estadia são `YYYY-MM-DD`** (sem hora). Todo cálculo usa `America/Sao_Paulo`.
- **A cotação é sempre recalculada no servidor.** Valor enviado pelo navegador é ignorado.
- **Nenhum segredo no código.** Use SSM Parameter Store (SecureString).
- **Testes antes** para preço, disponibilidade e concorrência — são as partes críticas.
- **Logs sem dados pessoais.** E-mail e telefone mascarados; nunca valores financeiros
  associados a pessoa identificável.
- **Templates de e-mail editáveis não executam lógica.** Apenas substituição de
  `{{variavel}}` de uma allowlist, com escape de HTML. Ver
  [`docs/03-tecnico/06-emails-e-templates.md`](./docs/03-tecnico/06-emails-e-templates.md).

## Stack

| Camada | Tecnologia |
|---|---|
| IaC | AWS CDK (TypeScript) |
| Frontend | Astro (estático) + ilhas interativas |
| Backoffice | SPA client-side em `/admin`, autenticada por Cognito |
| Backend | AWS Lambda (Node.js LTS, TypeScript, esbuild) |
| HTTP | Lambda Function URLs atrás do CloudFront em `/api/*` |
| Banco | DynamoDB on-demand, tabela única |
| E-mail | Amazon SES |
| Auth admin | Cognito User Pool + `aws-jwt-verify` |
| Agendamento | EventBridge Scheduler |
| Segredos | SSM Parameter Store (SecureString) |
| Testes | Vitest + DynamoDB Local (Docker) |

Região: `us-east-1` (ACM do CloudFront exige).

## Onde fica o quê

```
infra/lib/              stacks e constructs do CDK
backend/src/handlers/   um arquivo por Lambda (ponto de entrada fino)
backend/src/domain/     regras de negócio puras e testáveis (preço, disponibilidade, datas)
backend/src/lib/        adaptadores de infraestrutura (DynamoDB, SES, SSM, iCal)
backend/src/templates/  templates padrão de e-mail (fallback do que está no banco)
packages/shared/src/    tipos e schemas zod compartilhados entre site e backend
site/src/pages/         páginas Astro
```

**Regra de camadas:** `handlers` → `domain` + `lib`. `domain` não importa `lib` nem o
AWS SDK. Toda regra de negócio testável fica em `domain` como função pura.

## Git

- Nunca commitar ou dar push sem o usuário pedir explicitamente.
- Mensagens de commit e PR **em inglês**, alto nível.
