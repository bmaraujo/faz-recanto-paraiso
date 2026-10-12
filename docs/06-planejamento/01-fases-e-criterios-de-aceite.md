# 01 — Fases e critérios de aceite

Princípio: **cada fase entrega algo que já tem valor sozinha.** Não se avança para a
próxima sem os critérios da atual atendidos e testados.

```
Fase 0  Fundação          infraestrutura no ar, nada visível ao público
Fase 1  Vitrine           ◀── já substitui o Airbnb como vitrine própria
Fase 2  Reservas          ◀── já substitui o caderno
Fase 3  Automação         ◀── já reduz o trabalho manual
Fase 4  Canais externos   ◀── só se houver Airbnb/Booking
```

---

## Fase 0 — Fundação

**Objetivo:** ter infraestrutura reproduzível e um endereço HTTPS no ar.

### Entregas
- Monorepo com `infra/`, `site/`, `backend/`, `packages/shared/`, `scripts/`
- CDK com as 5 stacks, nos stages `dev` e `prod`
- S3 + CloudFront + ACM + (opcional) Route 53
- DynamoDB com GSI1, TTL, PITR e deletion protection em `prod`
- Cognito User Pool, App Client, domínio e grupo `admin`
- Log groups com retenção; alerta de orçamento
- Página "em construção" no ar
- `GET /api/saude`
- CI com `tsc`, lint e testes
- README atualizado

### Em paralelo, começar já (têm prazo externo)
- [ ] Verificar o domínio no SES com DKIM, SPF e DMARC
- [ ] **Abrir o chamado de saída do sandbox do SES** — a AWS leva até ~24 h
- [ ] Registrar o domínio `[DEFINIR]`
- [ ] Criar os parâmetros `SecureString`
- [ ] Criar o usuário admin no Cognito

### Critérios de aceite
- [ ] `cdk deploy --context stage=dev --all` funciona em uma conta limpa
- [ ] `cdk deploy --context stage=prod --all` funciona
- [ ] A página "em construção" responde por HTTPS
- [ ] `GET /api/saude` retorna `200` com a `versao`
- [ ] Cabeçalhos de segurança presentes (HSTS, `nosniff`, CSP)
- [ ] Tabela de `prod` com `RETAIN`, PITR e deletion protection
- [ ] `infra/test/custo.test.ts` passando (nenhum recurso caro)
- [ ] `infra/test/seguranca.test.ts` passando
- [ ] Alerta de orçamento recebido por e-mail (testar reduzindo o limite)
- [ ] Login na Hosted UI do Cognito funciona
- [ ] CI verde
- [ ] **Custo do mês < US$ 1**

---

## Fase 1 — Vitrine

**Objetivo:** o site já serve como vitrine própria e mostra disponibilidade real.
A reserva ainda é por WhatsApp.

### Entregas

**Backend**
- `domain/datas.ts`, `domain/precos.ts`, `domain/disponibilidade.ts` — com testes
- `GET /api/casas`, `GET /api/casas/{slug}`, `GET /api/config-publica`
- `GET /api/casas/{id}/disponibilidade`
- `POST /api/cotacao`

**Backoffice (mínimo)**
- [UC-A01](../02-casos-de-uso/admin/UC-A01-autenticar.md) — login
- [UC-A02](../02-casos-de-uso/admin/UC-A02-gerenciar-casas.md) — CRUD de casas
- [UC-A03](../02-casos-de-uso/admin/UC-A03-gerenciar-fotos.md) — fotos
- [UC-A04](../02-casos-de-uso/admin/UC-A04-gerenciar-precos.md) — preços
- [UC-A05](../02-casos-de-uso/admin/UC-A05-gerenciar-bloqueios.md) — bloqueios
- [UC-A14](../02-casos-de-uso/admin/UC-A14-publicar-site.md) — publicação

**Site**
- [UC-P01](../02-casos-de-uso/publico/UC-P01-navegar-vitrine.md) — home, lista, detalhe
- [UC-P02](../02-casos-de-uso/publico/UC-P02-consultar-disponibilidade.md) — calendário
- [UC-P03](../02-casos-de-uso/publico/UC-P03-simular-preco.md) — simulador
- [UC-P07](../02-casos-de-uso/publico/UC-P07-contato-direto.md) — WhatsApp
- `/localizacao`, `/regras`, `/cancelamento`, `/faq`, `/privacidade`, `/termos`, `/404`
- SEO completo: metatags, OG, `sitemap.xml`, `robots.txt`, JSON-LD

**Pipeline**
- `publicar-conteudo` + workflow de publicação no GitHub Actions

### Critérios de aceite
- [ ] Todos os 17 casos de teste de [regras de preço](../01-negocio/02-regras-de-preco.md) passando
- [ ] Todos os 14 casos de [regras de disponibilidade](../01-negocio/01-regras-de-disponibilidade.md) aplicáveis passando
- [ ] Todos os 14 casos de `datas.test.ts` passando
- [ ] Teste de propriedade "soma do detalhamento = total" passando
- [ ] Cobertura de `domain/` ≥ 95%
- [ ] 3 casas cadastradas com fotos reais e publicadas
- [ ] O calendário mostra os bloqueios criados no backoffice
- [ ] O simulador calcula corretamente fim de semana, temporada e feriado
- [ ] **Lighthouse mobile ≥ 90** nas quatro categorias em `/`, `/casas`, `/casas/<slug>`
- [ ] Foto de 8 MB vira WebP de ~200 KB
- [ ] Foto em retrato aparece na orientação correta
- [ ] Publicar bloqueia casa ativa incompleta, nomeando o que falta
- [ ] **As fotos sobrevivem a uma publicação com `s3 sync --delete`**
- [ ] Nenhum dado pessoal em nenhum endpoint (não há reservas ainda)
- [ ] `enderecoCompleto` ausente do site público
- [ ] Com a `api-publica` desligada, o conteúdo continua visível
- [ ] **Custo do mês < US$ 1**

> Ao fim da Fase 1 o proprietário já pode divulgar o site. Ele economiza a conversa de
> "está livre?" e "quanto custa?", que é a maior parte do atrito atual.

---

## Fase 2 — Reservas

**Objetivo:** o site recebe solicitações que seguram datas, e o backoffice substitui o
caderno.

### Entregas

**Backend**
- `domain/reservas.ts` — máquina de estados, com testes
- `POST /api/solicitacoes` com a **transação** de ocupação
- `GET /api/solicitacoes/{id}?t=`, `POST .../cancelar?t=`
- Rotas de admin: painel, agenda, reservas, confirmar, recusar, cancelar, estender prazo
- `cron-diario` com expiração e conclusão
- SES com os e-mails essenciais (templates **fixos no código** nesta fase)

**Site**
- [UC-P04](../02-casos-de-uso/publico/UC-P04-solicitar-reserva.md) — solicitar
- [UC-P05](../02-casos-de-uso/publico/UC-P05-acompanhar-solicitacao.md) — acompanhar
- [UC-P06](../02-casos-de-uso/publico/UC-P06-cancelar-solicitacao.md) — desistir

**Backoffice**
- [UC-A06](../02-casos-de-uso/admin/UC-A06-ver-agenda.md) — painel e agenda
- [UC-A07](../02-casos-de-uso/admin/UC-A07-confirmar-reserva.md) — confirmar
- [UC-A08](../02-casos-de-uso/admin/UC-A08-recusar-ou-cancelar-reserva.md) — recusar/cancelar
- [UC-A09](../02-casos-de-uso/admin/UC-A09-estender-prazo.md) — estender prazo
- [UC-A13](../02-casos-de-uso/admin/UC-A13-configuracao-geral.md) — configuração

**E-mails nesta fase:** `SOLICITACAO_RECEBIDA`, `NOVA_SOLICITACAO_ADMIN`,
`RESERVA_CONFIRMADA`, `SOLICITACAO_RECUSADA`, `SOLICITACAO_EXPIRADA`,
`RESERVA_CANCELADA`, `ALERTA_ADMIN`.

### Critérios de aceite — concorrência (bloqueantes)
- [ ] 2 solicitações simultâneas, mesmas noites, mesma casa → **exatamente 1 passa**
- [ ] 10 simultâneas, mesmas noites → exatamente 1 passa
- [ ] 2 simultâneas, casas diferentes → 2 passam
- [ ] Noites parcialmente sobrepostas → 1 passa, com a lista correta no `409`
- [ ] Solicitação sobre pendência vencida → passa; a antiga vira `EXPIRADA`
- [ ] Confirmar + expirar simultaneamente → um vence, estado coerente
- [ ] Confirmar expirada com noites tomadas → `409` nomeando a outra reserva
- [ ] Liberar noites quando uma já é de outra reserva → reserva liberada, noite intacta
- [ ] Dois cliques em confirmar → 1 sucesso, **1 e-mail**
- [ ] **Invariantes I1–I9 válidas após 20 rodadas de concorrência**

### Critérios de aceite — fluxo
- [ ] Solicitação cria reserva `SOLICITADA` + ocupações pendentes com prazo
- [ ] `expiraEm` truncado a 12 h antes do check-in
- [ ] Honeypot e `_t < 3000` → `201` falso, nada gravado
- [ ] 4º pendente do mesmo e-mail → `429`
- [ ] Token inválido/ausente/de outra reserva → `404` idêntico, **sem `500`**
- [ ] `/api/solicitacoes/*` com TTL 0 no CloudFront e `no-store` na resposta
- [ ] Toda rota de admin sem JWT → `401`; sem grupo → `403`
- [ ] `cron-diario` expira e conclui corretamente, de forma idempotente
- [ ] Falha do SES **não** invalida nenhuma transição, e a tela informa
- [ ] Nenhum dado pessoal em log (verificado em uma amostra real)
- [ ] Teste E2E dos 3 fluxos críticos passando
- [ ] Lighthouse ainda ≥ 90
- [ ] **Teste real completo:** solicitar → receber e-mail → confirmar no backoffice →
      receber confirmação → ver a data ocupada no site
- [ ] **Custo do mês < US$ 2**

> Ao fim da Fase 2 o sistema já é a fonte da verdade da ocupação. É o marco mais
> importante do projeto.

---

## Fase 3 — Automação

**Objetivo:** reduzir o trabalho manual recorrente e dar autonomia total de conteúdo.

### Entregas
- [UC-A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md) — **templates de e-mail editáveis**
- [UC-A10](../02-casos-de-uso/admin/UC-A10-registrar-pagamento.md) — registro de pagamento
- [UC-A11](../02-casos-de-uso/admin/UC-A11-criar-reserva-manual.md) — reserva manual
- [UC-A15](../02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md) — relatório
- `cron-diario` completo: `PRE_CHECKIN`, `POS_ESTADIA`, `PRAZO_EXPIRANDO_ADMIN`,
  reenvio de e-mails falhos, limpeza de publicação travada
- Ação de **anonimização** no detalhe da reserva ([LGPD](../05-conformidade/02-lgpd.md))
- Notificação de bounce/complaint do SES
- Alarmes do CloudWatch e tópico SNS

### Critérios de aceite
- [ ] Todos os 30 casos de [UC-A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md) passando
- [ ] Variável inexistente rejeitada **com sugestão**
- [ ] Variável obrigatória ausente rejeitada **com a explicação do porquê**
- [ ] Nome de hóspede com `<script>` não gera HTML executável no e-mail
- [ ] Nome com sintaxe Markdown aparece como texto literal
- [ ] Envio de teste vai **sempre** ao e-mail do admin
- [ ] Template inválido no banco → e-mail com o padrão + `ALERTA_ADMIN`
- [ ] Nenhuma allowlist contém `motivoInterno`
- [ ] `PRE_CHECKIN` enviado uma única vez, em D−3
- [ ] Duas execuções do cron no mesmo dia não duplicam e-mail
- [ ] Reserva manual nasce `CONFIRMADA` com ocupações firmes
- [ ] Reserva sem e-mail funciona e não quebra o cron
- [ ] Mudança de datas de reserva existente é atômica
- [ ] CPF ou cartão nos campos de pagamento → `400`
- [ ] `pagamento` ausente de toda resposta pública
- [ ] Nenhum valor financeiro em log
- [ ] Relatório com funil, taxa de conversão e tempo médio de resposta
- [ ] Relatório sem nenhum dado pessoal
- [ ] Nenhum `Scan` executado em nenhum lugar do sistema
- [ ] Alarmes disparando e-mail (testar um)
- [ ] **Custo do mês < US$ 3**

---

## Fase 4 — Canais externos (opcional)

**Objetivo:** evitar overbooking quando houver anúncio no Airbnb/Booking.

> **Só implementar se o proprietário realmente anunciar em canal externo.**
> Sem isso, é código sem uso — e código sem uso é passivo de manutenção.

### Entregas
- [UC-P08](../02-casos-de-uso/publico/UC-P08-exportar-calendario-ical.md) — export `.ics`
- [UC-A16](../02-casos-de-uso/admin/UC-A16-sincronizar-ical.md) — configuração e sincronização
- `cron-ical`
- `lib/ical.ts` com geração e parse

### Critérios de aceite
- [ ] Todos os 31 casos de [UC-A16](../02-casos-de-uso/admin/UC-A16-sincronizar-ical.md) passando
- [ ] Todos os 19 casos de [UC-P08](../02-casos-de-uso/publico/UC-P08-exportar-calendario-ical.md) passando
- [ ] `DTEND` exclusivo (verificado nos dois sentidos)
- [ ] Teste de ida e volta: gerar `.ics` → reparsear → mesmas noites
- [ ] `.ics` importado no Google Calendar sem deslocamento de um dia
- [ ] **Sincronização testada com um calendário iCal real** do Airbnb ou Booking
- [ ] Conflito preserva a reserva do site e gera alerta
- [ ] O mesmo conflito gera **um** alerta por dia
- [ ] Falha de download **não** apaga nada
- [ ] `.ics` vazio tratado como falha
- [ ] 10 falhas desativam o canal
- [ ] URL para IP privado ou metadados rejeitada (**SSRF**)
- [ ] URL nunca aparece em log
- [ ] Export não contém nenhum evento `EXTERNO`
- [ ] Export sem nenhum dado pessoal
- [ ] Linhas em CRLF, nenhuma acima de 75 octetos
- [ ] **Custo do mês < US$ 3**

---

## Melhorias mapeadas, fora de escopo das fases

Registradas para não serem reinventadas, com o gatilho que as justificaria:

| Melhoria | Gatilho |
|---|---|
| Lambda com `sharp` para AVIF e múltiplos tamanhos | Pedido de qualidade de imagem ou `srcset` real |
| `GSI2` por status/criação no DynamoDB | > 5.000 reservas/ano |
| Item agregado de agenda por mês | > 30 casas |
| AWS WAF com rate limit | Tráfego de bot que afete o custo |
| Avaliações de hóspedes com moderação | Pedido do proprietário |
| Cupons de desconto | Se o pagamento algum dia entrar no site |
| App mobile | Nunca se paga nesse volume |
| Multi-tenant (outras fazendas) | Mudança de modelo de negócio |
| Pagamento online | Decisão explícita do proprietário — reverteria [ADR-003](../adr/ADR-003-pagamento-fora-do-site.md) |

## Portão de qualidade (vale em todas as fases)

Nenhum código entra na `main` sem:

1. `npm test` verde em `backend` e `infra`
2. `npm run test:integracao` verde
3. Cobertura de `backend/src/domain/` ≥ 95% em linhas e branches
4. `tsc --noEmit` sem erro (modo `strict`)
5. ESLint sem erro, incluindo a regra de camadas (`domain` não importa `lib`) e `no-console`
6. Lighthouse ≥ 90 quando `site/` mudou
7. Checklist de [segurança](../05-conformidade/01-seguranca.md) revisado se mexeu em handler ou IAM
