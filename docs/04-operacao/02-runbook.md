# 02 — Runbook

Procedimentos operacionais. Escrito para ser seguido **durante** um problema, por quem
está com pressa.

## Preparação inicial (uma vez)

### Parâmetros `SecureString` no SSM

O CDK não cria `SecureString` (exporia o valor no template do CloudFormation).

```bash
STAGE=prod

# Segredo do cabeçalho de origem do CloudFront (defesa em profundidade)
aws ssm put-parameter \
  --name "/recanto-paraiso/$STAGE/origem-cdn-segredo" \
  --type SecureString \
  --value "$(openssl rand -base64 32)"

# Token do GitHub para disparar o repository_dispatch (escopo: contents:write)
aws ssm put-parameter \
  --name "/recanto-paraiso/$STAGE/github/token" \
  --type SecureString --value "github_pat_..."

# Segredo do callback de publicação
aws ssm put-parameter \
  --name "/recanto-paraiso/$STAGE/publicacao/segredo-callback" \
  --type SecureString --value "$(openssl rand -base64 32)"
```

### Usuário administrador no Cognito

```bash
POOL=$(aws ssm get-parameter --name "/recanto-paraiso/prod/user-pool-id" \
        --query Parameter.Value --output text)

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL" \
  --username proprietario@exemplo.com.br \
  --user-attributes Name=email,Value=proprietario@exemplo.com.br Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL" \
  --username proprietario@exemplo.com.br \
  --group-name admin
```

O Cognito envia a senha temporária por e-mail e exige a troca no primeiro acesso.
Nenhuma senha passa pelo repositório ou pelo histórico do shell.

### Verificação de domínio no SES

```bash
aws sesv2 create-email-identity --email-identity exemplo.com.br
aws sesv2 get-email-identity --email-identity exemplo.com.br \
  --query 'DkimAttributes.Tokens'
```

Crie os 3 CNAMEs do DKIM no DNS, mais:

```
TXT  @            "v=spf1 include:amazonses.com ~all"
TXT  _dmarc       "v=DMARC1; p=none; rua=mailto:proprietario@exemplo.com.br"
```

### Saída do sandbox do SES — **bloqueador de produção**

Console → SES → Account dashboard → *Request production access*.

Informe: caso de uso transacional, volume estimado (< 500/mês), como você trata bounces
e complaints (notificação por SNS, ver abaixo) e que só envia para quem solicitou.

**A AWS leva até ~24 h para responder. Abra esse chamado na Fase 0.** Em sandbox, só é
possível enviar para endereços verificados — suficiente para desenvolver, inviável para
produção.

### Notificação de bounce e complaint

```bash
aws sesv2 put-email-identity-configuration-set-attributes \
  --email-identity exemplo.com.br \
  --configuration-set-name recanto-paraiso-prod
```

O Configuration Set criado pelo CDK já publica `Bounce` e `Complaint` em um tópico SNS
assinado pelo e-mail do admin.

---

## Verificação de invariantes

Roda a função `verificarInvariantes()` compartilhada com os testes de integração
([14 — Testes](../03-tecnico/14-estrategia-de-testes.md)).

```bash
npm run invariantes -- --stage=prod
```

Saída esperada:

```
I1 no máximo uma ocupação por casa/data ............ OK (1.482 noites)
I2 reservas ativas com ocupação completa ........... OK (37 reservas)
I3 reservas finalizadas sem ocupação ............... OK
I4 ocupação pendente ↔ reserva SOLICITADA .......... OK
I5 reserva CONFIRMADA sem pendência ................ OK
I6 noites = [checkin, checkout) .................... OK
I7 soma do detalhamento = total .................... OK
I8 nenhum e-mail duplicado em emailsEnviados ....... OK
I9 pagamento só em CONFIRMADA/CONCLUIDA ............ OK
```

**Quando rodar:** depois de qualquer intervenção manual no banco, depois de um incidente,
e uma vez por mês por higiene. É só leitura; não altera nada.

Com violação, a saída nomeia os itens envolvidos. **Não corrija direto no banco** sem
antes entender como chegou lá — a causa quase sempre é um bug de código que vai se
repetir.

---

## Incidentes

### O site está fora do ar

```bash
# 1. O S3 tem conteúdo?
aws s3 ls "s3://recanto-paraiso-site-prod/index.html"

# 2. O CloudFront responde?
curl -sI https://<dominio>/ | head -5

# 3. A distribuição está habilitada?
aws cloudfront get-distribution --id "$DIST" --query 'Distribution.Status'
```

| Causa | Sintoma | Correção |
|---|---|---|
| `index.html` ausente | 403/404 do S3 | `npm run deploy:site` |
| Certificado expirado | erro de TLS | ACM renova sozinho; verificar validação de DNS |
| DNS errado | não resolve | Conferir o registro no Route 53 / Registro.br |
| Distribuição desabilitada | 403 | Habilitar no console |

### A API está retornando erro

```bash
# Health check
curl -s https://<dominio>/api/saude | jq

# Erros da última hora
aws logs tail /aws/lambda/recanto-paraiso-api-publica-prod --since 1h --filter-pattern '"nivel":"erro"'
```

| Causa | Como confirmar | Correção |
|---|---|---|
| Erro de código | log com `erro_nao_tratado` | `git revert` + `cdk deploy` |
| Throttle | alarme de `Throttles` | Aumentar `reservedConcurrency` **e investigar o volume** |
| DynamoDB | `SystemErrors` > 0 | Problema da AWS; aguardar; verificar o health dashboard |
| SSM | erro de `GetParameter` | Verificar se o parâmetro existe e se o IAM permite |
| JWT | `401` em tudo no admin | Conferir `USER_POOL_ID` e `USER_POOL_CLIENT_ID` nas env vars |

### E-mails não estão saindo

```bash
# 1. Está fora do sandbox?
aws sesv2 get-account --query 'ProductionAccessEnabled'

# 2. Reputação
aws cloudwatch get-metric-statistics --namespace AWS/SES \
  --metric-name Reputation.BounceRate --start-time "$(date -u -v-7d +%FT%TZ)" \
  --end-time "$(date -u +%FT%TZ)" --period 86400 --statistics Average

# 3. Falhas de envio no log
aws logs tail /aws/lambda/recanto-paraiso-cron-diario-prod --since 24h --filter-pattern 'email_falhou'
```

| Causa | Correção |
|---|---|
| Ainda em sandbox | Abrir o chamado de produção |
| Domínio não verificado | Conferir os CNAMEs do DKIM |
| Bounce acima de 5% | **Urgente**: limpar endereços inválidos; risco de suspensão |
| Template inválido | Ver `template_invalido` no log; restaurar o padrão ([UC-A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md)) |
| Conta suspensa | Abrir chamado na AWS; é grave |

**Enquanto isso:** o admin consegue falar com os hóspedes pelo WhatsApp a partir do
painel. O sistema não trava por falta de e-mail — por desenho.

### Uma data aparece ocupada e não deveria

```bash
# Ver a ocupação daquela noite
aws dynamodb get-item --table-name recanto-paraiso-prod \
  --key '{"PK":{"S":"OCUPACAO#<casaId>"},"SK":{"S":"NOITE#2026-11-20"}}'
```

| `tipo` | Causa provável | Correção |
|---|---|---|
| `RESERVA` com `pendente: true` e `expiraEm` no passado | O `cron-diario` não rodou | Verificar o cron; a disponibilidade **já deveria** tratar isso — se não trata, é bug |
| `RESERVA` de reserva `CANCELADA` | Ocupação órfã (violação de I3) | Rodar a verificação de invariantes; investigar o bug |
| `BLOQUEIO` | Esperado | Remover pelo backoffice ([UC-A05](../02-casos-de-uso/admin/UC-A05-gerenciar-bloqueios.md)) |
| `EXTERNO` | Importado do iCal | Normal se o canal tem a data; senão, sincronizar manualmente |

> Se uma ocupação pendente **vencida** faz a data aparecer ocupada, o bug está na
> filtragem por `expiraEm`, não nos dados. Corrigir o código, não o banco.

### Overbooking aconteceu

**É o pior cenário. Aja em minutos, não em horas.**

```
1. Identifique as duas reservas:
   /admin/agenda, ou:
   aws dynamodb query --table-name recanto-paraiso-prod \
     --index-name GSI1 \
     --key-condition-expression "GSI1PK = :pk AND begins_with(GSI1SK, :d)" \
     --expression-attribute-values '{":pk":{"S":"RESERVA"},":d":{"S":"2026-11-20"}}'

2. Decida qual honrar. Critérios, em ordem:
   a) qual foi confirmada primeiro
   b) qual já pagou (consultar `pagamento` no detalhe)
   c) qual tem mais flexibilidade de data

3. Ligue para o hóspede que será remanejado. **Ligue, não mande e-mail.**

4. Ofereça: outra casa, outra data, ou devolução integral.

5. No sistema: cancele a reserva remanejada ([UC-A08](../02-casos-de-uso/admin/UC-A08-recusar-ou-cancelar-reserva.md)),
   com motivo interno "overbooking — remanejado para <solução>".

6. Investigue a causa:
   - veio de canal externo? → janela do iCal (limitação conhecida, ver
     [UC-A16](../02-casos-de-uso/admin/UC-A16-sincronizar-ical.md))
   - veio de duas reservas nossas? → **bug na transação**. Pare tudo, reproduza no
     teste de concorrência, corrija antes de qualquer outro trabalho.

7. Rode a verificação de invariantes.
```

> O passo 6 é a parte que importa a longo prazo. Overbooking entre o site e um canal
> externo é uma limitação de protocolo, administrável. Overbooking **entre duas
> reservas nossas** é um defeito na garantia central do sistema e tem prioridade sobre
> qualquer outra tarefa.

### Conflito de calendário externo

Chega por `ALERTA_ADMIN`. Ver [UC-A16](../02-casos-de-uso/admin/UC-A16-sincronizar-ical.md).

```
1. Abra /admin/canais e veja o conflito (casa, datas, reserva envolvida).
2. Confira no painel do canal externo se a reserva de lá é real.
3. Decida qual honrar (mesmos critérios do overbooking).
4. Cancele a que não vai honrar — no nosso sistema ou no canal.
5. Dispare a sincronização manual.
6. Confirme que o conflito desapareceu.
```

### A publicação do site falhou

```
1. /admin → status da publicação → "Ver detalhes" → link do run no GitHub Actions.
2. Erro de build → corrigir o conteúdo que causou (geralmente Markdown inválido).
3. Erro de permissão → verificar a role OIDC.
4. "Tentar novamente".
5. O site anterior continua no ar — não há urgência de minutos.
```

### Uma solicitação ficou presa em `SOLICITADA`

Sintoma: prazo vencido, mas o estado não muda.

```bash
# O cron rodou?
aws logs tail /aws/lambda/recanto-paraiso-cron-diario-prod --since 3h --filter-pattern 'cron_concluido'
```

| Causa | Correção |
|---|---|
| O agendamento está desabilitado | Habilitar no EventBridge Scheduler |
| O cron falha | Ver o log; corrigir |
| A transação falha sempre | Provável noite que mudou de dono — ver [05 — Concorrência](../03-tecnico/05-concorrencia-e-idempotencia.md#o-detalhe-que-quebra-ingênuos) |

Contorno manual: recusar a solicitação pelo backoffice ([UC-A08](../02-casos-de-uso/admin/UC-A08-recusar-ou-cancelar-reserva.md)).
Isso libera as datas e não dispara efeito indesejado.

### O custo subiu

```bash
aws ce get-cost-and-usage \
  --time-period Start=2026-10-01,End=2026-11-01 \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

| Serviço caro | Causa provável | Correção |
|---|---|---|
| CloudFront | Tráfego anormal ou imagem gigante | Verificar o tamanho das fotos; checar o cache |
| Lambda | Loop de invocação ou ataque | A concorrência reservada já limita; investigar o log |
| DynamoDB | Consulta sem índice (`Scan`?) | **Nenhum código deve usar `Scan`** |
| CloudWatch | Log excessivo | Reduzir o nível de log; conferir a retenção |
| SES | Volume inesperado | Verificar loop de reenvio |

Ver [03 — Custos](./03-custos.md) para os valores esperados.

---

## Restauração de dados (PITR)

**Só em `prod`, onde o PITR está ligado.** O PITR **não** sobrescreve a tabela atual:
ele cria uma tabela nova.

```bash
# 1. Janela disponível
aws dynamodb describe-continuous-backups --table-name recanto-paraiso-prod \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'

# 2. Restaurar para uma NOVA tabela
aws dynamodb restore-table-to-point-in-time \
  --source-table-name recanto-paraiso-prod \
  --target-table-name recanto-paraiso-prod-restauro-20261011 \
  --restore-date-time 2026-10-11T15:00:00Z

# 3. Inspecionar a tabela restaurada e extrair o que precisa
# 4. Reaplicar os itens corretos na tabela de produção, item por item
# 5. Apagar a tabela de restauro
```

> **Nunca aponte a aplicação para a tabela restaurada** nem renomeie tabelas para
> "trocar". O caminho correto é extrair os itens necessários e reaplicá-los. Trocar a
> tabela inteira descartaria tudo que aconteceu desde o ponto de restauração.

Depois de qualquer restauração: rode a verificação de invariantes.

---

## Manutenção periódica

| Quando | Tarefa |
|---|---|
| Semanal | Conferir o painel: solicitações pendentes, alertas |
| Semanal | Conferir a taxa de expiração no relatório ([UC-A15](../02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md)) |
| Mensal | Revisar o custo no Cost Explorer |
| Mensal | Rodar a verificação de invariantes |
| Mensal | Conferir a reputação no SES (bounce < 3%, complaint < 0,1%) |
| Trimestral | Revisar preços e temporadas do ano seguinte |
| Trimestral | Testar a restauração por PITR (não em produção) |
| Anual | Rotacionar o segredo `origem-cdn-segredo` |
| Anual | Rotacionar o token do GitHub |
| Anual | Revisar os textos legais e a política de privacidade |
| Anual | Conferir a validade do certificado ACM (renovação automática) |
| Anual | Revisar a retenção e a anonimização de dados ([LGPD](../05-conformidade/02-lgpd.md)) |

### Rotação do segredo de origem

```bash
NOVO=$(openssl rand -base64 32)
aws ssm put-parameter --name "/recanto-paraiso/prod/origem-cdn-segredo" \
  --type SecureString --value "$NOVO" --overwrite

# As Lambdas aceitam o valor antigo E o novo durante a transição:
aws ssm put-parameter --name "/recanto-paraiso/prod/origem-cdn-segredo-anterior" \
  --type SecureString --value "$ANTIGO" --overwrite

cd infra && npx cdk deploy RecantoParaisoFrontend-prod --context stage=prod
# Após confirmar que tudo funciona, remover o parâmetro "-anterior".
```

Aceitar os dois valores durante a troca evita indisponibilidade durante os ~15 minutos
de propagação do CloudFront.

---

## Contatos e links

| O quê | Onde |
|---|---|
| Console AWS | conta `627010764306` `[DEFINIR]`, região `us-east-1` |
| Repositório | https://github.com/bmaraujo/faz-recanto-paraiso |
| Backoffice | `https://<dominio>/admin` |
| Status da AWS | https://health.aws.amazon.com/health/status |
| Alertas | tópico SNS `alertas-prod` → e-mail do admin |
| Proprietário | `[DEFINIR]` nome e telefone |
