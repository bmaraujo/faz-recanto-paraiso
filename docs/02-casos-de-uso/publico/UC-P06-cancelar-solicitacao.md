# UC-P06 — Desistir da solicitação

| Campo | Valor |
|---|---|
| Ator | Hóspede (identificado pelo token de acesso) |
| Pré-condições | Reserva em `SOLICITADA` e token válido |
| Gatilho | O hóspede clica em "Desistir da solicitação" em `/reserva/<id>` |
| Fase | 2 |
| Relacionados | [UC-P05](./UC-P05-acompanhar-solicitacao.md), [Ciclo de vida](../../01-negocio/03-ciclo-de-vida-da-reserva.md), [UC-A06](../admin/UC-A06-ver-agenda.md) |

## Objetivo de negócio

Liberar as datas **imediatamente** quando o hóspede já sabe que não vai.
Sem isso, as datas ficariam travadas por até 48 h sem necessidade, e outra pessoa
interessada veria "ocupado" por nada.

Benefício secundário: dar ao hóspede uma saída limpa evita o constrangimento de
"cancelar" por WhatsApp, o que muita gente simplesmente não faz — deixa expirar e
nunca mais volta.

## Fluxo principal

1. Em `/reserva/<id>?t=<token>` com `podeCancelar: true`, o hóspede clica em
   **"Desistir da solicitação"**.
2. Abre uma confirmação que **nomeia o que será desfeito**:
   *"Desistir da solicitação da Casa do Lago, de 20 a 23/11? As datas serão liberadas."*
3. Campo opcional de motivo.
4. O hóspede confirma.
5. `POST /api/solicitacoes/<id>/cancelar?t=<token>`.
6. O servidor valida o token, valida a transição e executa a transação que muda o
   estado para `CANCELADA` e **libera as noites**.
7. A tela atualiza para o estado `CANCELADA`, com um convite a escolher outra data.
8. O admin recebe um aviso por e-mail.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Hóspede não informa motivo | Segue; motivo fica vazio |
| A2 | Hóspede desiste da confirmação (fecha o diálogo) | Nada acontece |
| A3 | Já está `CANCELADA` | Responde `200` com o estado atual (idempotente) — não mostrar erro para uma ação que o usuário já conseguiu |
| A4 | Reserva já expirou mas o cron ainda não processou | Cancelamento aceito; o efeito é o mesmo (noites liberadas) |

## Fluxos de exceção

| # | Situação | Resposta | O que o hóspede vê |
|---|---|---|---|
| E1 | Token inválido/ausente | `404` | "Não encontramos esta solicitação." |
| E2 | Reserva `CONFIRMADA` | `409 TRANSICAO_INVALIDA` | "Esta reserva já foi confirmada. Para cancelar, fale com o proprietário." + WhatsApp |
| E3 | Reserva `RECUSADA` ou `EXPIRADA` | `409` | Tela atualiza para o estado real |
| E4 | Reserva `CONCLUIDA` | `409` | Tela atualiza |
| E5 | Falha de rede | — | "Não conseguimos cancelar agora." + Tentar novamente + WhatsApp |
| E6 | Noite já pertence a outra reserva | — | Cancelamento **conclui**; aquela noite não é apagada (ver [05 — Concorrência](../../03-tecnico/05-concorrencia-e-idempotencia.md#o-detalhe-que-quebra-ingênuos)) |

> **E2 é a decisão de produto deste UC:** uma reserva **confirmada** não é cancelável
> pelo hóspede no site. Há compromisso financeiro combinado por fora e política de
> cancelamento envolvida — a decisão passa pelo proprietário
> ([UC-A08](../admin/UC-A08-recusar-ou-cancelar-reserva.md)). A tela não mostra o botão
> nesse estado, e o servidor recusa de qualquer forma.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Só `SOLICITADA` → `CANCELADA` é permitido ao hóspede |
| RN2 | Token obrigatório; inválido → `404` |
| RN3 | As noites são liberadas na **mesma transação** da mudança de estado |
| RN4 | Apaga-se apenas a ocupação cujo `refId` é desta reserva |
| RN5 | Idempotente: já `CANCELADA` → `200` |
| RN6 | Registra `canceladoPor = "HOSPEDE"`, `canceladaEm` e o motivo |
| RN7 | O admin é notificado por e-mail |
| RN8 | O hóspede **não** recebe `RESERVA_CANCELADA` (ele acabou de fazer isso; e-mail seria ruído) |
| RN9 | O contador antiabuso do e-mail é decrementado |
| RN10 | Não gera cobrança nem devolução — não houve pagamento pelo site |

## Contrato técnico

```http
POST /api/solicitacoes/{reservaId}/cancelar?t=<tokenAcesso>
Content-Type: application/json

{ "motivo": "Mudamos a data da viagem" }
```

| Campo | Regra |
|---|---|
| `motivo` | opcional, ≤ 500 chars, sem HTML |

Resposta `200`: o mesmo payload de [UC-P05](./UC-P05-acompanhar-solicitacao.md),
já com `status: "CANCELADA"`, `podeCancelar: false` e a nova `mensagemStatus`.

| Erro | HTTP |
|---|---|
| `NAO_ENCONTRADO` (token/reserva) | 404 |
| `TRANSICAO_INVALIDA` (com `detalhes.statusAtual`) | 409 |
| `ENTRADA_INVALIDA` | 400 |

## Implementação

```
1. validar token               → 404
2. parse + zod do motivo       → 400
3. GetItem da reserva          → 404
4. se status === CANCELADA     → 200 (idempotente)
5. se status !== SOLICITADA    → 409 com statusAtual
6. ler as ocupações das noites e filtrar as que têm refId = reservaId
7. TransactWriteItems:
     Update reserva  (ConditionExpression: status = SOLICITADA)
     Delete de cada ocupação própria (ConditionExpression: refId = :reservaId)
     Update decremento do contador antiabuso
8. em TransactionCanceledException: recarregar e repetir até 3 vezes
9. responder 200 com o payload de acompanhamento
10. enviar aviso ao admin (fora do caminho crítico)
```

### Armadilhas

1. **Passo 6 é obrigatório.** Sem filtrar as ocupações próprias, o `Delete`
   condicional de uma noite que já virou de outra reserva faz a **transação inteira**
   falhar, prendendo a reserva em `SOLICITADA` para sempre.
2. **Decremento do contador.** Esquecê-lo faz o hóspede atingir o limite de 3
   pendentes mesmo tendo cancelado tudo — e ele não entende por que não consegue pedir.
3. **Não enviar e-mail ao hóspede.** Ele fez a ação e está vendo o resultado na tela.
4. **Idempotência (passo 4) antes da validação de transição (passo 5).** A ordem
   inversa mostraria `409` para quem clicou duas vezes num cancelamento bem-sucedido.

## Interface

```
┌──────────────────────────────────────────────┐
│  Desistir da solicitação?                    │
│                                               │
│  Casa do Lago · 20 a 23/11/2026               │
│  As datas serão liberadas para outras pessoas.│
│                                               │
│  Não houve nenhuma cobrança, então não há     │
│  nada a devolver.                             │
│                                               │
│  Quer nos contar o motivo? (opcional)         │
│  [_________________________________]          │
│                                               │
│      [ Voltar ]   [ Sim, desistir ]           │
└──────────────────────────────────────────────┘
```

| Estado | Comportamento |
|---|---|
| Diálogo aberto | Foco no botão "Voltar" (ação não destrutiva primeiro) |
| Enviando | Botão desabilitado com "Cancelando..." |
| Sucesso | Tela do estado `CANCELADA` + "Ver outras datas" |
| `409` | Fecha o diálogo, atualiza a tela para o estado real e explica |
| Falha de rede | Mensagem no diálogo + Tentar novamente; diálogo permanece aberto |

Acessibilidade: o diálogo é modal com `role="dialog"`, `aria-modal="true"`, foco
preso dentro dele, `Esc` fecha, e o foco retorna ao botão de origem ao fechar.

> O botão de confirmação nomeia a casa e as datas. Um "Tem certeza?" genérico leva a
> cliques automáticos — e aqui o clique libera uma data real.

## Segurança e privacidade

- Mesma proteção de token do [UC-P05](./UC-P05-acompanhar-solicitacao.md).
- O motivo é texto livre do usuário: validado sem HTML e **escapado** ao aparecer no
  backoffice e no e-mail do admin.
- Só a própria reserva pode ser cancelada com o token dela.
- Nenhum efeito financeiro.
- Log sem dado pessoal; registra `reservaId` e `canceladoPor`.

## Critérios de aceite

- [ ] Hóspede com token válido cancela uma `SOLICITADA`.
- [ ] As noites são liberadas imediatamente e o calendário público reflete isso (após o cache de 60 s).
- [ ] Reserva `CONFIRMADA` não é cancelável pelo hóspede (botão ausente **e** `409` no servidor).
- [ ] Token inválido → `404`.
- [ ] Segundo cancelamento → `200`, não erro.
- [ ] Noite que pertence a outra reserva **não** é apagada e o cancelamento conclui.
- [ ] Contador antiabuso decrementado.
- [ ] O admin é notificado.
- [ ] O hóspede **não** recebe e-mail de cancelamento.
- [ ] A confirmação nomeia casa e datas.
- [ ] O diálogo é acessível por teclado.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Cancelar `SOLICITADA` | `200`, status `CANCELADA`, 3 ocupações apagadas |
| 2 | Cancelar duas vezes | `200` nas duas |
| 3 | Cancelar `CONFIRMADA` | `409` com `statusAtual: CONFIRMADA` |
| 4 | Cancelar `EXPIRADA` | `409` |
| 5 | Token inválido | `404` |
| 6 | Sem token | `404` |
| 7 | Uma noite já pertence a outra reserva | Reserva cancelada; a noite da outra intacta |
| 8 | Contador antes/depois | Decrementado em 1 |
| 9 | Motivo com HTML | `400` |
| 10 | Motivo de 600 chars | `400` |
| 11 | Sem motivo | `200` |
| 12 | E-mails enviados | Um ao admin, nenhum ao hóspede |
| 13 | Cancelar e solicitar as mesmas datas em seguida | Nova solicitação aceita |
| 14 | Invariantes após cancelar | I3 válida (nenhuma ocupação ativa) |
