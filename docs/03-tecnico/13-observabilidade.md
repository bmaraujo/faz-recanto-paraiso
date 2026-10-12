# 13 — Observabilidade

Princípio: **observabilidade suficiente para um sistema com um administrador**.
Não há equipe de plantão, então o objetivo não é dashboard bonito — é que o
proprietário receba um e-mail quando algo que afeta reserva der errado, e que o
desenvolvedor consiga diagnosticar em minutos.

O orçamento de observabilidade é de **~US$ 0,30/mês**. Isso elimina X-Ray, Container
Insights, métricas customizadas em volume e qualquer ferramenta de APM paga.

## Log estruturado

Todo log é **JSON em uma linha**, para o CloudWatch Logs Insights poder consultar.

```json
{
  "nivel": "info",
  "em": "2026-10-11T18:04:03.221Z",
  "requisicaoId": "a1b2c3...",
  "rota": "POST /api/solicitacoes",
  "evento": "solicitacao_criada",
  "reservaId": "01HQ...",
  "casaId": "01HR...",
  "checkin": "2026-11-20",
  "noites": 3,
  "duracaoMs": 184
}
```

| Campo | Sempre presente |
|---|---|
| `nivel` | `debug` \| `info` \| `aviso` \| `erro` |
| `em` | ISO 8601 em UTC |
| `requisicaoId` | do contexto da Lambda (`awsRequestId`) |
| `evento` | nome em snake_case, de uma lista fechada |
| `duracaoMs` | nos eventos de fim de requisição |

### O que NUNCA entra no log

| Proibido | Em vez disso |
|---|---|
| E-mail completo | `ma***@exemplo.com` (3 primeiros + domínio) |
| Telefone completo | `+55119****9999` |
| Nome completo do hóspede | Omitir, ou só o primeiro nome quando essencial |
| Valores monetários associados a pessoa identificável | Omitir, ou logar só `reservaId` |
| `tokenAcesso`, `tokenIcal` | Redigido: o parâmetro `t` vira `t=[REDIGIDO]` |
| JWT, cabeçalho `Authorization` | Nunca logar cabeçalhos |
| Corpo de requisição com dados pessoais | Logar só os campos estruturais (datas, casaId, hóspedes) |
| Corpo de e-mail renderizado | Só o `codigo` e o `messageId` |
| URL de iCal | É credencial. Logar só o canal |

**A implementação é um wrapper obrigatório** (`lib/log.ts`) que:

1. Mascara campos por nome conhecido (`email`, `telefone`, `nome`, `token`, `t`,
   `authorization`, `url`).
2. Redige qualquer string que casa com o padrão de e-mail ou de JWT, onde ela estiver.
3. Lança em desenvolvimento se receber um objeto com uma chave da lista proibida sem
   passar pelo mascaramento.

> Nunca chamar `console.log` direto. Um lint rule (`no-console`) com exceção apenas em
> `lib/log.ts` garante isso.

### Eventos padronizados

| Evento | Nível | Quando |
|---|---|---|
| `requisicao_iniciada` / `requisicao_concluida` | debug / info | Entrada e saída de cada handler |
| `solicitacao_criada` | info | Nova solicitação |
| `solicitacao_rejeitada_datas` | info | `409 DATAS_INDISPONIVEIS` |
| `solicitacao_descartada_antiabuso` | aviso | Honeypot ou tempo de formulário |
| `reserva_confirmada` / `reserva_recusada` / `reserva_cancelada` / `reserva_expirada` | info | Transições |
| `email_enviado` / `email_falhou` | info / erro | Envio pelo SES |
| `template_invalido` | erro | Fallback para o padrão |
| `ical_sincronizado` | info | Fim de um ciclo por canal |
| `ical_conflito` | **erro** | Conflito de ocupação |
| `ical_falha_download` | aviso | Falha isolada |
| `publicacao_iniciada` / `publicacao_concluida` / `publicacao_falhou` | info / erro | |
| `cron_concluido` | info | Com o resumo de cada passo |
| `erro_nao_tratado` | erro | `catch` de último recurso |

## Métricas

Usamos **métricas já existentes** (grátis) em vez de métricas customizadas (US$ 0,30
por métrica/mês cada).

| Métrica | Fonte |
|---|---|
| Invocações, erros, duração, throttles | AWS/Lambda (automática) |
| Erros de usuário e de sistema, capacidade consumida | AWS/DynamoDB (automática) |
| Requisições, taxa de erro 4xx/5xx, bytes | AWS/CloudFront (automática) |
| Envios, bounces, complaints, rejeições | AWS/SES (automática) |

### As poucas métricas customizadas que valem o custo

Via **Embedded Metric Format (EMF)** — basta logar em um formato especial, sem chamada
de API, e o CloudWatch extrai a métrica:

| Métrica | Por quê |
|---|---|
| `SolicitacoesCriadas` | É o KPI do negócio |
| `SolicitacoesExpiradas` | Mede diretamente negócio perdido por demora do admin |
| `ConflitosIcal` | Mede risco de overbooking |

Três métricas ≈ US$ 0,90/mês. **Avaliar na Fase 3**: se o custo apertar, os mesmos
números saem de uma consulta do Logs Insights, de graça, sob demanda.

## Alarmes

Todos publicam no tópico SNS `alertas-<stage>`, com assinatura de e-mail do admin.

| Alarme | Condição | Severidade |
|---|---|---|
| `api-publica` com erro | ≥ 3 erros em 5 min | Alta |
| `api-admin` com erro | ≥ 3 erros em 5 min | Média |
| Lambda com throttle | ≥ 1 em 5 min | Alta (significa que alguém está sendo recusado) |
| `cron-diario` falhou | ≥ 1 erro em 1 h | Alta (e-mails param de sair) |
| `cron-ical` falhou | ≥ 3 erros em 2 h | Média |
| `publicar-conteudo` falhou | ≥ 1 erro | Baixa (o admin já vê na tela) |
| DynamoDB `SystemErrors` | ≥ 1 em 5 min | Alta |
| DynamoDB `UserErrors` | ≥ 20 em 5 min | Média (sinal de bug de código) |
| SES `Reputation.BounceRate` | > 3% | **Crítica** (risco de suspensão da conta) |
| SES `Reputation.ComplaintRate` | > 0,1% | **Crítica** |
| CloudFront 5xx | > 1% em 5 min | Alta |
| **Orçamento** | US$ 5/mês (Budgets) | Alta |

| Decisão | Valor |
|---|---|
| `treatMissingData` | `NOT_BREACHING` — sem tráfego não é problema |
| Período de avaliação | 5 min na maioria; 1 h nos crons |
| Ação | Só e-mail. Sem auto-remediação (não há o que remediar automaticamente) |

> Nenhum alarme dispara por latência. Com volume baixo, uma Lambda em cold start de
> 1,5 s é normal e um alarme de latência só produziria ruído. O que importa é erro.

### Alertas de negócio (por e-mail, não CloudWatch)

Alguns problemas não são erros técnicos, e por isso vão por `ALERTA_ADMIN` do próprio
sistema, não por alarme:

| Situação | Quando |
|---|---|
| Conflito de iCal | Imediato (máximo 1/dia por conflito) |
| Falha de envio de e-mail essencial | Imediato |
| 3 falhas consecutivas de download de iCal | Uma vez |
| Canal de iCal desativado por falhas | Imediato |
| Solicitação a expirar em menos de 6 h | `PRAZO_EXPIRANDO_ADMIN` |
| Template inválido no banco | Imediato |
| Bounce permanente de e-mail de hóspede | Imediato, com o telefone para contato |

## Consultas úteis do Logs Insights

Documentadas aqui para o dia do incidente, não para enfeitar:

```
# Erros das últimas 24 h, agrupados
fields @timestamp, evento, erro.nome, erro.mensagem, requisicaoId
| filter nivel = "erro"
| sort @timestamp desc
| limit 100

# Solicitações recusadas por indisponibilidade (mede fricção real do funil)
fields @timestamp, casaId, checkin, noitesIndisponiveis
| filter evento = "solicitacao_rejeitada_datas"
| stats count() by bin(1d)

# Funil do mês
filter evento in ["solicitacao_criada","reserva_confirmada","reserva_expirada","reserva_recusada"]
| stats count() by evento

# Latência por rota
filter evento = "requisicao_concluida"
| stats avg(duracaoMs), pct(duracaoMs, 95), max(duracaoMs), count() by rota

# Rastrear uma requisição específica
fields @timestamp, @message | filter requisicaoId = "a1b2c3..." | sort @timestamp asc
```

## Retenção e custo

| Item | Configuração | Custo estimado |
|---|---|---|
| Log groups | 14 dias (`prod`), 7 dias (`dev`) | ~US$ 0,05/mês |
| Ingestão de log | ~50 MB/mês | ~US$ 0,03/mês |
| Alarmes | 12 alarmes | Primeiros 10 grátis; ~US$ 0,20/mês |
| Métricas EMF | 3 | ~US$ 0,90/mês — **reavaliar** |
| X-Ray | **desabilitado** | US$ 0 |
| Logs de acesso do CloudFront | **desabilitados** | US$ 0 |

> Retenção de 14 dias é curta de propósito. Log é o item de observabilidade que mais
> cresce em custo. Se um incidente exigir histórico maior, a resposta é exportar
> aquele período para o S3 sob demanda, não aumentar a retenção de tudo para sempre.

## Rastreabilidade sem X-Ray

Com 5 Lambdas sem encadeamento síncrono entre si, X-Ray resolveria pouco e cobraria
por trace. O substituto:

- `requisicaoId` em todas as linhas de log de uma requisição.
- `reservaId` em toda linha relacionada a uma reserva — é a chave de correlação do
  negócio, e permite reconstruir a história inteira de uma reserva com uma consulta.
- Invocações assíncronas (`api-admin` → `publicar-conteudo`) propagam o
  `requisicaoId` de origem no payload.

## Health check

`GET /api/saude` na `api-publica`:

```json
{ "ok": true, "stage": "prod", "versao": "2026.10.11-a1b2c3", "em": "..." }
```

- **Não** consulta o banco: um health check que lê o DynamoDB gasta leitura a cada
  verificação e pode falhar por throttle, criando alarme falso.
- Não é monitorado por nenhum serviço pago. Serve para verificação manual e para o
  smoke test pós-deploy.
- `versao` vem de uma variável de ambiente preenchida no build com data e hash do
  commit — é o que responde "o deploy foi?" sem adivinhação.
