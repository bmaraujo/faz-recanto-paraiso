# 05 — Comunicação e e-mails

Regras de negócio sobre **quando** cada mensagem sai e **o que** ela precisa dizer.
A implementação (SES, renderização, segurança dos templates) está em
[03-tecnico/06](../03-tecnico/06-emails-e-templates.md).

## Princípio

**Todo texto enviado ao hóspede é editável pelo administrador**, sem deploy.
O código define *quando* enviar e *quais variáveis existem*; o admin define *o que diz*.

## Catálogo de e-mails

| Código | Quando sai | Para | Essencial? |
|---|---|---|---|
| `SOLICITACAO_RECEBIDA` | Imediatamente após a solicitação | Hóspede | **Sim** |
| `NOVA_SOLICITACAO_ADMIN` | Imediatamente após a solicitação | Admin | **Sim** |
| `RESERVA_CONFIRMADA` | O admin confirma | Hóspede | **Sim** |
| `SOLICITACAO_RECUSADA` | O admin recusa | Hóspede | Sim |
| `SOLICITACAO_EXPIRADA` | O prazo vence sem decisão | Hóspede | Sim |
| `RESERVA_CANCELADA` | Reserva confirmada é cancelada | Hóspede | Sim |
| `PRAZO_EXPIRANDO_ADMIN` | 6 h antes de uma solicitação expirar | Admin | Sim |
| `PRE_CHECKIN` | D−3 do check-in, só se `CONFIRMADA` | Hóspede | Sim |
| `POS_ESTADIA` | D+1 do check-out | Hóspede | Não |
| `ALERTA_ADMIN` | Conflito de iCal, falha de sincronização, falha de envio | Admin | **Sim** |

"Essencial" marca os e-mails cuja falha de envio precisa gerar alerta ao admin.

## Conteúdo mínimo de cada e-mail

Independente do texto que o admin escrever, **o sistema garante** que cada e-mail
carrega as variáveis abaixo, e a validação do template exige que as marcadas como
obrigatórias apareçam no corpo.

### `SOLICITACAO_RECEBIDA` (o mais importante do fluxo)

Precisa deixar três coisas absolutamente claras:

1. **Isto não é uma reserva confirmada.**
2. **Não houve e não haverá cobrança pelo site.**
3. **O prazo** em que as datas estão seguras e o que acontece depois dele.

| Variável | Obrigatória | Exemplo |
|---|---|---|
| `{{hospedeNome}}` | — | Maria |
| `{{casaNome}}` | **Sim** | Casa do Lago |
| `{{checkin}}` | **Sim** | 20/11/2026 |
| `{{checkout}}` | **Sim** | 23/11/2026 |
| `{{noites}}` | — | 3 |
| `{{hospedes}}` | — | 7 |
| `{{valorEstimado}}` | **Sim** | R$ 2.200,00 |
| `{{prazoLimite}}` | **Sim** | 13/10/2026 às 15h30 |
| `{{linkAcompanhamento}}` | **Sim** | https://.../reserva/01HQ…?t=… |
| `{{whatsappLink}}` | **Sim** | https://wa.me/55…?text=… |
| `{{adminNome}}`, `{{adminTelefone}}`, `{{adminEmail}}` | — | — |

### `NOVA_SOLICITACAO_ADMIN`
Resumo acionável: casa, datas, noites, hóspedes, valor estimado, nome, telefone com
link de WhatsApp, e-mail, prazo limite, link direto para a reserva no backoffice,
e eventuais observações do hóspede.

### `RESERVA_CONFIRMADA`
Casa, datas, horários de check-in/check-out, hóspedes, valor combinado, o que já foi
registrado como recebido `[DEFINIR se aparece]`, regras da casa, link de acompanhamento,
contato do proprietário.

### `SOLICITACAO_RECUSADA` / `SOLICITACAO_EXPIRADA`
Tom cordial, sem expor motivo interno. Devem **convidar a tentar outra data** e dar o
link da vitrine e o WhatsApp. O motivo registrado pelo admin é interno e **nunca**
entra no e-mail automaticamente.

### `PRE_CHECKIN`
O e-mail operacional mais importante para a experiência: endereço completo, link do
mapa, como chegar, condições da estrada, horário de check-in, contato do caseiro,
o que levar, sinal de celular, regras, senha/portão. Conteúdo `[DEFINIR]`.

Só sai se a reserva estiver `CONFIRMADA` em D−3. Se for confirmada depois de D−3,
o `cron-diario` envia na primeira execução seguinte, desde que o check-in não tenha
passado.

### `POS_ESTADIA`
Agradecimento e pedido de avaliação/indicação. Único e-mail opcional — o admin pode
desativá-lo.

### `ALERTA_ADMIN`
Nunca editável a ponto de perder informação técnica: o corpo sempre inclui um bloco
gerado pelo sistema com tipo do alerta, casa, datas, reserva envolvida e horário.
O admin edita apenas o texto ao redor.

## Regras gerais

| # | Regra |
|---|---|
| C1 | **Nunca enviar o mesmo código duas vezes para a mesma reserva.** Controlado por `emailsEnviados[]`. |
| C2 | O registro em `emailsEnviados` acontece **após** o SES aceitar o envio, nunca antes. |
| C3 | Falha de envio **não** bloqueia a transição de estado. |
| C4 | Toda falha de envio de e-mail essencial gera `ALERTA_ADMIN`. |
| C5 | Todo e-mail tem versão HTML **e** texto puro. |
| C6 | Todo e-mail ao hóspede tem assinatura com nome da fazenda, WhatsApp e site. |
| C7 | Nenhum e-mail contém dados de pagamento, documento ou senha. |
| C8 | O `Reply-To` dos e-mails ao hóspede é o e-mail do administrador. |
| C9 | Valores aparecem formatados em reais (`R$ 2.200,00`), nunca em centavos. |
| C10 | Datas aparecem no formato `DD/MM/AAAA`, nunca `YYYY-MM-DD`. |
| C11 | O admin pode **desativar** um e-mail não essencial; os essenciais não podem ser desativados. |
| C12 | Se o template do banco estiver inválido ou ausente, usa-se o padrão do código e gera-se `ALERTA_ADMIN`. |

## Idempotência e reenvio

O admin pode **reenviar** manualmente qualquer e-mail de uma reserva no backoffice.
O reenvio manual ignora `emailsEnviados` (é uma ação deliberada) mas registra uma
entrada em `historicoEnvios` com data e código, para ficar claro quantas vezes saiu.

Automático: nunca repete. Manual: repete sob demanda, com registro.

## Horário de envio

- E-mails de transição (solicitação, confirmação, recusa, cancelamento) saem
  **imediatamente**, a qualquer hora.
- E-mails agendados (`PRE_CHECKIN`, `POS_ESTADIA`, `SOLICITACAO_EXPIRADA`,
  `PRAZO_EXPIRANDO_ADMIN`) saem na execução do `cron-diario`, às **09:00
  `America/Sao_Paulo`**.
- `PRAZO_EXPIRANDO_ADMIN` precisa de granularidade maior que um dia. Solução: o
  `cron-diario` roda **de hora em hora** e cada tarefa decide se é a sua vez, em vez de
  criar um segundo agendamento. Custo igual (24 invocações/dia), menos peças.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Solicitação criada | Dois e-mails: hóspede e admin |
| 2 | SES falha no `SOLICITACAO_RECEBIDA` | Reserva criada; código ausente de `emailsEnviados`; `ALERTA_ADMIN` |
| 3 | `cron-diario` roda duas vezes no mesmo dia | `PRE_CHECKIN` enviado uma só vez |
| 4 | Reserva confirmada em D−1 | `PRE_CHECKIN` enviado na execução seguinte |
| 5 | Reserva confirmada em D+1 (check-in passou) | `PRE_CHECKIN` **não** enviado |
| 6 | Reenvio manual de `RESERVA_CONFIRMADA` | Enviado; `historicoEnvios` com duas entradas |
| 7 | Template com `{{variavelInexistente}}` | Salvamento rejeitado com erro de validação |
| 8 | Template do banco apagado | E-mail sai com o texto padrão + `ALERTA_ADMIN` |
| 9 | Nome do hóspede com `<script>` | Escapado no HTML; e-mail sem HTML executável |
| 10 | Admin tenta desativar `RESERVA_CONFIRMADA` | Rejeitado: e-mail essencial |
