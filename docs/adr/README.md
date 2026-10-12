# ADR — Decisões de arquitetura

Um registro por decisão relevante: o contexto, as alternativas, a escolha e as
**consequências** — incluindo as ruins.

## Para que serve

Daqui a um ano, alguém (talvez você) vai olhar uma escolha estranha e pensar "por que
não usaram X?". Se a resposta não estiver escrita, ou se refaz o trabalho de analisar,
ou se muda sem saber o que se perde.

## Formato

```
# ADR-NNN — Título (a decisão, não o problema)

| Status | Proposto | Aceito | Substituído por ADR-NNN |
| Data   | AAAA-MM-DD |

## Contexto          qual o problema e quais as restrições
## Alternativas      o que foi considerado, com os trade-offs
## Decisão           o que foi escolhido, e por quê
## Consequências     positivas, negativas e o que fica mais difícil
## Quando revisar    o gatilho concreto que justificaria mudar
```

A seção **Quando revisar** é a mais útil: nenhuma dessas decisões é permanente, e dizer
o gatilho evita tanto a mudança precipitada quanto a teimosia.

## Índice

| ADR | Decisão | Status |
|---|---|---|
| [001](./ADR-001-hospedagem-estatica.md) | Site estático em S3 + CloudFront | Aceito |
| [002](./ADR-002-dynamodb-tabela-unica.md) | DynamoDB em tabela única | Aceito |
| [003](./ADR-003-pagamento-fora-do-site.md) | **Pagamento tratado fora do site** | Aceito |
| [004](./ADR-004-multiplas-casas.md) | **Suportar múltiplas casas** | Aceito |
| [005](./ADR-005-cdk-como-iac.md) | **AWS CDK como IaC** | Aceito |
| [006](./ADR-006-lambda-function-urls.md) | Lambda Function URLs em vez de API Gateway | Aceito |
| [007](./ADR-007-templates-email-no-banco.md) | **Templates de e-mail no banco, editáveis** | Aceito |
| [008](./ADR-008-cognito-para-admin.md) | Cognito para autenticar o admin | Aceito |
| [009](./ADR-009-conteudo-no-banco-com-publicacao.md) | **Conteúdo no banco + publicação estática** | Aceito |
| [010](./ADR-010-pre-reserva-com-expiracao.md) | **Pré-reserva com expiração** | Aceito |

Em **negrito**, as decisões que **divergem** da especificação inicial
(`../_referencia/especificacao-inicial-v0.md`).
