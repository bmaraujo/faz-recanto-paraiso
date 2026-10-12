# 04 — Política de cancelamento

> ⚠️ Os prazos e percentuais abaixo são **exemplo para desenvolvimento**.
> Os valores reais são `[DEFINIR]` pelo proprietário — ver
> [pendências](../06-planejamento/02-pendencias-definir.md).

## Por que isso é um documento de negócio e não de código

Como o pagamento acontece fora do site, **o sistema não executa estorno nenhum**.
A política de cancelamento é:

1. Um **texto publicado** na página `/cancelamento`, que o hóspede declara aceitar
   ao solicitar a reserva (com registro de data/hora do aceite).
2. Uma **referência** que o administrador usa para decidir quanto devolver.
3. Um **cálculo informativo** que o backoffice mostra ao cancelar, para o admin não
   ter que fazer conta de cabeça.

O sistema **não** movimenta dinheiro. O que ele faz é liberar as datas e registrar
a decisão.

## Política de exemplo

| Quando o hóspede cancela | Devolução sugerida |
|---|---|
| Mais de 30 dias antes do check-in | 100% do que foi pago |
| De 30 a 15 dias antes | 50% do que foi pago |
| Menos de 15 dias antes | 0% |
| Cancelamento pelo proprietário, por qualquer motivo | 100% do que foi pago |
| Caso de força maior (desastre, interdição de acesso) | 100% ou reagendamento, a critério do proprietário |

A taxa de limpeza é devolvida integralmente em qualquer cancelamento, já que o serviço
não foi prestado. `[DEFINIR]`

## Desistência antes da confirmação

Uma solicitação em `SOLICITADA` não gerou compromisso financeiro. O hóspede pode
desistir livremente ([UC-P06](../02-casos-de-uso/publico/UC-P06-cancelar-solicitacao.md)),
sem nenhuma cobrança, e as datas são liberadas na hora.

Isso precisa estar claro no formulário: **solicitar não é reservar, e não gera cobrança.**

## O que o backoffice mostra ao cancelar

Ao cancelar uma reserva `CONFIRMADA` ([UC-A08](../02-casos-de-uso/admin/UC-A08-recusar-ou-cancelar-reserva.md)),
a tela exibe:

```
Reserva #01HQ...  —  Casa do Lago
Check-in: 20/11/2026 (faltam 41 dias)
Total da reserva:      R$ 2.200,00
Já registrado como recebido: R$ 1.100,00

Faixa da política: mais de 30 dias antes  →  devolução sugerida de 100%
Devolução sugerida: R$ 1.100,00

[ Motivo do cancelamento (interno) ______________ ]
[ Valor que você vai devolver (opcional) ________ ]   ← apenas registro
[ ✓ ] Enviar e-mail de cancelamento ao hóspede

        [ Cancelar reserva ]
```

O valor devolvido é **registro histórico**, não uma instrução de pagamento.
O texto da tela deve dizer isso.

## Cálculo da faixa (função pura)

```
faixaCancelamento(politica, checkin, hoje) → { faixa, percentualSugerido }
```

- `diasAteCheckin = diferençaEmDias(checkin, hoje)` em `America/Sao_Paulo`.
- Faixas avaliadas da mais distante para a mais próxima; a primeira que casar vence.
- A política é configurável ([UC-A13](../02-casos-de-uso/admin/UC-A13-configuracao-geral.md)):

```json
{
  "faixasCancelamento": [
    { "diasMinimos": 30, "percentualDevolucao": 100 },
    { "diasMinimos": 15, "percentualDevolucao": 50 },
    { "diasMinimos": 0,  "percentualDevolucao": 0 }
  ],
  "devolveTaxaLimpeza": true
}
```

Validação ao salvar: `diasMinimos` em ordem decrescente, sem repetição; última faixa
com `diasMinimos: 0`; `percentualDevolucao` entre 0 e 100.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Cancelamento a 45 dias | Faixa 100% |
| 2 | Cancelamento a exatamente 30 dias | Faixa 100% (`diasMinimos` é inclusivo) |
| 3 | Cancelamento a 29 dias | Faixa 50% |
| 4 | Cancelamento a exatamente 15 dias | Faixa 50% |
| 5 | Cancelamento a 14 dias | Faixa 0% |
| 6 | Cancelamento no dia do check-in | Faixa 0% |
| 7 | Cancelamento depois do check-in | Faixa 0%, sem erro |
| 8 | Cancelamento de reserva `SOLICITADA` | Nenhuma faixa aplicada; sem valor sugerido |
| 9 | Nada registrado como recebido | Devolução sugerida = R$ 0,00 |

## Texto para a página pública

A página `/cancelamento` deve dizer, em linguagem simples:

- Que **solicitar não é reservar** e não gera cobrança.
- Que a reserva só é confirmada depois do contato com o proprietário.
- Que o pagamento é combinado direto com o proprietário, fora do site.
- As faixas de devolução, com exemplos em reais.
- Como pedir cancelamento (link de acompanhamento, WhatsApp, e-mail).
- Em quanto tempo o proprietário responde. `[DEFINIR]`

O texto final é `[DEFINIR]` e fica na configuração geral, não no código.
