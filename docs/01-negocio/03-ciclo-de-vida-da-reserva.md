# 03 — Ciclo de vida da reserva

Este é o documento central do sistema. Tudo gira em torno desta máquina de estados.

## Os estados

| Estado | Significado | Ocupa noites? | Pendente? |
|---|---|---|---|
| `SOLICITADA` | O hóspede pediu. O admin ainda não decidiu. | Sim | **Sim** (tem `expiraEm`) |
| `CONFIRMADA` | O admin confirmou. Reserva firme. | Sim | Não |
| `RECUSADA` | O admin recusou. | Não | — |
| `EXPIRADA` | O prazo venceu sem decisão do admin. | Não | — |
| `CANCELADA` | Cancelada depois de confirmada (pelo admin, a pedido do hóspede ou não). | Não | — |
| `CONCLUIDA` | A estadia aconteceu e o check-out já passou. | Não (histórico) | — |

**Estados finais:** `RECUSADA`, `EXPIRADA`, `CANCELADA`, `CONCLUIDA`.
De um estado final só se sai por reabertura manual explícita, que não existe nesta
versão — o admin cria uma nova reserva.

## Diagrama

```
                        ┌──────────────────────────┐
   POST /api/solicitacoes │                        │ admin cria reserva manual
   (hóspede)            ▼                          ▼  (UC-A11)
                  ┌─────────────┐             ┌──────────────┐
                  │ SOLICITADA  │             │  CONFIRMADA  │
                  │  pendente   │             │              │
                  │  expiraEm   │────────────▶│              │
                  └─────────────┘  confirmar  └──────────────┘
                    │    │   │      (UC-A07)      │       │
        recusar     │    │   │                    │       │  check-out no passado
        (UC-A08)    │    │   │ estender prazo     │       │  (cron-diario)
                    │    │   └── (UC-A09) ──┐     │       ▼
                    ▼    │                  │     │  ┌────────────┐
             ┌──────────┐│                  │     │  │ CONCLUIDA  │
             │ RECUSADA ││                  │     │  └────────────┘
             └──────────┘│  prazo venceu    │     │
                         │  (cron-diario)   │     │ cancelar (UC-A08)
                         ▼                  │     ▼
                  ┌───────────┐             │  ┌────────────┐
                  │ EXPIRADA  │◀────────────┘  │ CANCELADA  │
                  └───────────┘                └────────────┘

   hóspede desiste (UC-P06) ──▶ CANCELADA   (a partir de SOLICITADA)
```

## Transições permitidas

| De | Para | Gatilho | Quem | UC |
|---|---|---|---|---|
| — | `SOLICITADA` | formulário do site | Hóspede | [UC-P04](../02-casos-de-uso/publico/UC-P04-solicitar-reserva.md) |
| — | `CONFIRMADA` | reserva manual | Admin | [UC-A11](../02-casos-de-uso/admin/UC-A11-criar-reserva-manual.md) |
| `SOLICITADA` | `CONFIRMADA` | confirmar | Admin | [UC-A07](../02-casos-de-uso/admin/UC-A07-confirmar-reserva.md) |
| `SOLICITADA` | `RECUSADA` | recusar | Admin | [UC-A08](../02-casos-de-uso/admin/UC-A08-recusar-ou-cancelar-reserva.md) |
| `SOLICITADA` | `EXPIRADA` | `expiraEm` no passado | `cron-diario` | — |
| `SOLICITADA` | `CANCELADA` | desistência | Hóspede | [UC-P06](../02-casos-de-uso/publico/UC-P06-cancelar-solicitacao.md) |
| `SOLICITADA` | `SOLICITADA` | estender prazo (muda `expiraEm`) | Admin | [UC-A09](../02-casos-de-uso/admin/UC-A09-estender-prazo.md) |
| `CONFIRMADA` | `CANCELADA` | cancelar | Admin | [UC-A08](../02-casos-de-uso/admin/UC-A08-recusar-ou-cancelar-reserva.md) |
| `CONFIRMADA` | `CONCLUIDA` | `checkout < hoje` | `cron-diario` | — |

**Qualquer outra transição é proibida** e deve retornar `409 TRANSICAO_INVALIDA`,
informando o estado atual. A validação acontece no servidor, com escrita condicional
ao estado esperado — nunca só na interface.

## Efeitos colaterais de cada transição

Cada transição é uma unidade atômica: ou tudo acontece, ou nada acontece.
Os e-mails ficam **fora** da transação (ver abaixo).

| Transição | Noites | E-mails | Outros efeitos |
|---|---|---|---|
| → `SOLICITADA` | cria ocupações `pendente = true` com `expiraEm` | `SOLICITACAO_RECEBIDA` (hóspede) + `NOVA_SOLICITACAO_ADMIN` (admin) | gera `tokenAcesso`; incrementa contador antiabuso do e-mail |
| → `CONFIRMADA` (de solicitada) | remove `pendente`, `expiraEm` e `ttl` das ocupações | `RESERVA_CONFIRMADA` (hóspede) | registra `confirmadaEm` |
| → `CONFIRMADA` (manual) | cria ocupações firmes | `RESERVA_CONFIRMADA` (hóspede), opcional | — |
| → `RECUSADA` | **apaga** as ocupações | `SOLICITACAO_RECUSADA` (hóspede) | registra motivo (interno) |
| → `EXPIRADA` | **apaga** as ocupações | `SOLICITACAO_EXPIRADA` (hóspede) | — |
| → `CANCELADA` | **apaga** as ocupações | `RESERVA_CANCELADA` (hóspede) + aviso ao admin se foi o hóspede | registra motivo e quem cancelou |
| → `CONCLUIDA` | mantém (histórico de ocupação) | `POS_ESTADIA` em D+1 | — |

### Por que os e-mails ficam fora da transação

O SES pode estar lento ou indisponível. Se o envio estivesse dentro da transação,
uma falha do SES impediria a confirmação de uma reserva — exatamente o tipo de
bloqueio que o projeto proíbe.

Portanto:

1. A transição de estado é commitada primeiro.
2. O e-mail é enviado depois, com timeout curto.
3. Se o envio falhar, a transição **permanece válida**. O código do e-mail não entra em
   `emailsEnviados`, e o `cron-diario` tenta novamente na próxima execução.
4. A interface informa o resultado honestamente: *"Reserva confirmada. O e-mail de
   confirmação será reenviado automaticamente — houve falha no envio agora."*

Isso vale para toda transição: **o estado é a verdade, o e-mail é consequência**.

## Situação de pagamento — um eixo separado

Como o pagamento é tratado fora do site, **ele não faz parte da máquina de estados**.
É um campo independente, de controle do admin ([UC-A10](../02-casos-de-uso/admin/UC-A10-registrar-pagamento.md)):

```
pagamento: {
  situacao: "NAO_REGISTRADO" | "PARCIAL" | "TOTAL",
  valorRecebidoCentavos: number,
  metodo: string,            // texto livre: "Pix", "Transferência", "Dinheiro"
  observacao: string,
  registradoEm: ISO datetime
}
```

Regras:

- Uma reserva pode estar `CONFIRMADA` com `situacao: NAO_REGISTRADO`. É decisão do admin
  confirmar antes de receber.
- Uma reserva `SOLICITADA` **não** aceita registro de pagamento — confirme primeiro.
  (`409 TRANSICAO_INVALIDA`)
- `valorRecebidoCentavos` nunca é negativo e nunca passa de `totalCentavos` sem
  confirmação explícita na interface.
- Esse campo **nunca** aparece em endpoint público nem em log.

## Invariantes do sistema

Verdades que devem valer **sempre**. São a base dos testes de integração.

| # | Invariante |
|---|---|
| I1 | Para cada casa e data, existe no máximo uma ocupação. |
| I2 | Toda reserva em `SOLICITADA` ou `CONFIRMADA` tem exatamente uma ocupação por noite da sua estadia, referenciando o seu `reservaId`. |
| I3 | Nenhuma reserva em estado final (`RECUSADA`, `EXPIRADA`, `CANCELADA`) tem ocupações ativas. |
| I4 | Uma ocupação com `pendente = true` pertence a uma reserva em `SOLICITADA`. |
| I5 | Uma reserva `CONFIRMADA` não tem ocupações com `pendente = true`. |
| I6 | `noites` da reserva = `[checkin, checkout)`, e `noites.length >= 1`. |
| I7 | A soma do `detalhamento` da cotação = `valores.totalCentavos`. |
| I8 | Nenhum código de e-mail aparece duas vezes em `emailsEnviados`. |
| I9 | `situacao: PARCIAL` ou `TOTAL` só em reserva `CONFIRMADA` ou `CONCLUIDA`. |

O [runbook](../04-operacao/02-runbook.md) traz um script de verificação de invariantes
para rodar sob demanda, útil depois de qualquer intervenção manual no banco.

## Ordem de verificação ao processar uma transição

Padrão a seguir em **todo** handler de transição:

```
1. autenticar/autorizar
2. validar entrada (zod)
3. carregar a reserva
4. 404 se não existir
5. validar a transição contra o estado atual   → 409 TRANSICAO_INVALIDA
6. aplicar a transação condicional
   (condição inclui "status = <estado esperado>")
7. se a condição falhar → recarregar e devolver 409 com o estado atual
8. responder ao cliente
9. só então enviar e-mail (fora do caminho crítico)
```

O passo 5 existe para dar uma mensagem boa; o passo 6 existe porque **só a condição
na escrita garante** ausência de corrida. Os dois são obrigatórios.
