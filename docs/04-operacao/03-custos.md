# 03 — Custos

Meta: **até US$ 3/mês na AWS**, excluindo domínio.

> ⚠️ **Os valores abaixo foram estimados para `us-east-1`, mas a região decidida é
> `sa-east-1` ([ADR-011](../adr/ADR-011-regiao-sa-east-1.md)), tipicamente 20-40% mais
> cara por serviço — e alguns free tiers são por região e não somam entre elas. Toda
> esta página precisa ser refeita na [calculadora oficial](https://calculator.aws)
> antes de qualquer decisão.** Preços da AWS mudam, e alguns free tiers (notadamente o
> do CloudFront) foram alterados nos últimos anos. Não tenho certeza da configuração
> exata vigente de todos eles — **verifique** os itens marcados com ❓.

## Premissas de volume

| Métrica | Estimativa |
|---|---|
| Visitas/mês | 500 |
| Páginas por visita | 4 |
| Requisições de API/mês | 5.000 |
| Reservas/mês | 5 |
| E-mails/mês | 50 |
| Casas | 3 |
| Fotos | 120 (3 casas × 40) |
| Tamanho do site | ~2 MB de HTML/CSS/JS + ~24 MB de fotos |
| Tráfego/mês | ~5 GB |

## Estimativa por serviço

| Serviço | Uso | Free tier | Custo estimado |
|---|---|---|---|
| **S3** (armazenamento) | ~30 MB | 5 GB por 12 meses | **~US$ 0,001** |
| **S3** (requisições) | ~2.000 GET/mês (o resto vem do cache) | — | **~US$ 0,001** |
| **CloudFront** | ~5 GB de egress, ~25.000 req. | ❓ 1 TB + 10 M req./mês (verificar) | **US$ 0,00** |
| **Lambda** | ~10.000 invocações, 256 MB, ~200 ms | 1 M req. + 400.000 GB-s/mês (perpétuo) | **US$ 0,00** |
| **DynamoDB** (on-demand) | ~30.000 leituras, ~2.000 escritas, < 10 MB | 25 GB de armazenamento | **~US$ 0,02** |
| **DynamoDB PITR** | < 10 MB | — | **~US$ 0,002** |
| **SES** | 50 e-mails | ❓ 3.000/mês nos 12 primeiros meses | **~US$ 0,01** |
| **Cognito** | 1 usuário | 50.000 MAU | **US$ 0,00** |
| **SSM Parameter Store** | ~8 parâmetros padrão | ilimitado para `Standard` | **US$ 0,00** |
| **EventBridge Scheduler** | ~2.200 invocações/mês | ❓ 14 M/mês | **US$ 0,00** |
| **CloudWatch Logs** (ingestão) | ~50 MB | 5 GB/mês | **US$ 0,00** |
| **CloudWatch Logs** (armazenamento) | ~25 MB (retenção de 14 dias) | 5 GB | **US$ 0,00** |
| **CloudWatch Alarmes** | 12 alarmes | 10 alarmes | **~US$ 0,20** |
| **CloudWatch Métricas EMF** | 3 métricas customizadas | 10 métricas | **US$ 0,00** |
| **ACM** | 1 certificado público | sempre grátis | **US$ 0,00** |
| **Route 53** (zona hospedada) | 1 zona | — | **US$ 0,50** |
| **Route 53** (consultas) | ~10.000 | — | **~US$ 0,004** |
| **AWS Budgets** | 2 alertas | 2 alertas grátis | **US$ 0,00** |
| **Data transfer** (saída da Lambda para o MP) | — | removido do escopo | **US$ 0,00** |
| | | **Total estimado** | **~US$ 0,75/mês** |

Com `dev` e `prod` na mesma conta, o `dev` adiciona centavos (praticamente só mais
alarmes e um pouco de log).

### Fora da AWS

| Item | Custo |
|---|---|
| Domínio `.com.br` | ~R$ 40/ano (Registro.br) |
| GitHub Actions | Grátis (2.000 min/mês em repositório privado) ❓ |
| **Gateway de pagamento** | **US$ 0,00 — removido do escopo** |

## Como o custo foi mantido baixo

Decisões que custam zero e substituem serviços pagos:

| Em vez de | Usamos | Economia/mês |
|---|---|---|
| API Gateway | Lambda Function URL | ~US$ 0,01 (pequena, mas elimina uma peça) |
| NAT Gateway (Lambda em VPC) | Lambda sem VPC | **~US$ 32** |
| RDS `db.t4g.micro` | DynamoDB on-demand | **~US$ 12** |
| AWS WAF | Antiabuso na aplicação + concorrência reservada | **~US$ 6** |
| Secrets Manager (2 segredos) | SSM Parameter Store `Standard` | ~US$ 0,80 |
| Lambda@Edge | CloudFront Function | ~US$ 0,50 |
| Lambda com `sharp` para imagens | Redimensionamento no navegador | ~US$ 0,05 |
| X-Ray | Log estruturado com `requisicaoId` | ~US$ 0,50 |
| Logs de acesso do CloudFront | Desligados | ~US$ 0,50 |
| ElastiCache | Cache do CloudFront + cache em memória da Lambda | **~US$ 12** |
| EC2/Lightsail | Serverless | **~US$ 5-10** |
| Mercado Pago | Pagamento fora do site | Taxa do gateway (~4% por transação) |
| Arquitetura x86 | **arm64** (Graviton) | ~20% do custo de Lambda |

**Economia total em relação a uma arquitetura "tradicional": ~US$ 70/mês.**

## O que realmente pode estourar o orçamento

Por ordem de risco:

| # | Risco | Como se manifesta | Proteção |
|---|---|---|---|
| 1 | **Fotos grandes** | Egress do CloudFront sobe | Redimensionamento obrigatório para ~200 KB + cache de 1 ano |
| 2 | **Tráfego anormal** (bot, scraping) | Requisições e egress | Cache do CloudFront + concorrência reservada |
| 3 | **Loop de invocação** | Lambda e DynamoDB | Concorrência reservada = teto absoluto |
| 4 | **`Scan` no DynamoDB** | Leituras explodem | **Permissão de `Scan` não é concedida a ninguém** |
| 5 | **Log excessivo** | Ingestão do CloudWatch | Retenção de 14 dias + nível de log controlado |
| 6 | **Métricas customizadas** | US$ 0,30 por métrica/mês | Limitadas a 3; reavaliar na Fase 3 |
| 7 | **Loop de reenvio de e-mail** | SES | `emailsEnviados` + limite de tentativas |
| 8 | **Recurso esquecido em `dev`** | Qualquer coisa | `cdk destroy` do `dev` quando não estiver em uso |

> O item 4 merece destaque: um único `Scan` em um laço, em uma tabela que cresceu,
> transforma centavos em dezenas de dólares. A proteção não é disciplina — é **não
> conceder a permissão**, verificado por teste de infraestrutura
> ([12 — Infra](../03-tecnico/12-infraestrutura-cdk.md#testes-de-infraestrutura)).

## Proteções configuradas

### AWS Budgets

```
Orçamento: US$ 5,00/mês (custo total da conta)
Alertas:
  80% do previsto  → e-mail
  100% do real     → e-mail
```

US$ 5 é ~6× a estimativa. Se o alerta disparar, algo está errado — não é crescimento
normal.

### Concorrência reservada

| Lambda | `prod` |
|---|---|
| `api-publica` | 5 |
| `api-admin` | 2 |
| crons | 1 cada |

É o **teto absoluto** de gasto com Lambda. Efeito colateral: um pico legítimo recebe
`429`. Aceitável no volume esperado, e muito melhor que uma fatura surpresa.

### Teste de infraestrutura contra recursos caros

`infra/test/custo.test.ts` **falha o build** se o template contiver NAT Gateway, ALB,
RDS, EC2, WAF, Secrets Manager, ElastiCache ou Lambda@Edge.

> É a defesa mais eficaz do orçamento: um recurso caro adicionado por descuido falha
> no CI, em vez de aparecer na fatura 30 dias depois.

## Monitoramento de custo

```bash
# Custo do mês por serviço
aws ce get-cost-and-usage \
  --time-period Start=2026-10-01,End=2026-11-01 \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE

# Previsão do mês
aws ce get-cost-forecast \
  --time-period Start=2026-10-12,End=2026-11-01 \
  --metric UNBLENDED_COST --granularity MONTHLY
```

Revisão **mensal**, no [runbook](./02-runbook.md).

## Gatilhos de revisão da arquitetura

Nenhuma decisão de custo é permanente. Quando um destes acontecer, reavalie:

| Gatilho | O que reconsiderar |
|---|---|
| Custo mensal > US$ 5 por 2 meses | Investigar a causa antes de qualquer mudança |
| Egress do CloudFront > 50 GB/mês | Compressão das fotos; avaliar AVIF |
| Tráfego de bot significativo | AWS WAF com regra de rate limit (~US$ 6/mês) |
| > 5.000 reservas/ano | Adicionar `GSI2` no DynamoDB |
| > 30 casas | Item agregado de agenda por mês |
| Egress acima do free tier com `PRICE_CLASS_ALL` | Comprimir mais as fotos; avaliar AVIF — **não** voltar a servir de edge no exterior |
| Demanda por AVIF/múltiplos tamanhos | Lambda com `sharp` acionada por evento do S3 |
| Volume de e-mail > 5.000/mês | Revisar o custo do SES (segue baixo) |

## Comparação honesta com as alternativas

Para dar contexto à meta de US$ 3:

| Opção | Custo/mês | Observação |
|---|---|---|
| **Esta arquitetura** | ~US$ 0,75 | Controle total, sem taxa por reserva |
| Vercel/Netlify (free) + Supabase (free) | US$ 0 | Grátis até certos limites; menos controle; o free tier pode mudar |
| WordPress gerenciado + plugin de reserva | ~US$ 15-30 | Mais rápido de montar, menos flexível, manutenção de plugins |
| Lodgify / Hostaway / Stays.net | ~US$ 20-60 | Pronto, com canais integrados; mensalidade e menos controle |
| Só Airbnb | US$ 0 fixo | ~15% de comissão por reserva; nenhuma marca própria |

> Para 5 reservas/mês a R$ 2.000, 15% de comissão são **R$ 1.500/mês**. O site próprio
> se paga no primeiro mês, e é por isso que a conta fecha mesmo com o esforço de
> desenvolvimento.
