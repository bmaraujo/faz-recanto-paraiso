# 01 — Regras de disponibilidade

Regras de negócio sobre quando uma casa pode ser reservada. Independentes de tecnologia.
A implementação está em [03-tecnico/05 — Concorrência](../03-tecnico/05-concorrencia-e-idempotencia.md).

## R1 — A noite é a unidade de ocupação

Uma estadia com check-in em `D1` e check-out em `D2` ocupa as noites
`D1, D1+1, ..., D2−1`. **O dia do check-out não é ocupado** — a casa pode ser
reservada por outra pessoa com check-in nesse mesmo dia.

Exemplo: check-in 10/01, check-out 12/01 → ocupa `2026-01-10` e `2026-01-11`.
Outra reserva pode começar em `2026-01-12`.

> Isso é o que viabiliza a troca de hóspede no mesmo dia (saída 12h, entrada 14h)
> e é a mesma convenção do `DTEND` exclusivo do iCal.

## R2 — Ocupação é por casa

Cada casa tem sua própria agenda. A mesma noite pode estar livre na Casa A e
ocupada na Casa B. Nenhuma regra de disponibilidade cruza casas.

## R3 — Uma noite tem no máximo um ocupante

Para uma dada casa e data, existe **no máximo um** registro de ocupação. Não existe
"meia ocupação" nem lista de espera.

As origens possíveis de ocupação são:

| Tipo | Origem | Quem cria | Libera quando |
|---|---|---|---|
| `RESERVA` | Solicitação do site ou reserva manual | Hóspede ou admin | Expiração, recusa ou cancelamento |
| `BLOQUEIO` | Decisão do admin (manutenção, uso próprio) | Admin | Admin remove o bloqueio |
| `EXTERNO` | Calendário iCal de Airbnb/Booking | `cron-ical` | O evento desaparece do iCal de origem |

## R4 — Ocupação pendente conta como ocupada

Uma solicitação ainda não decidida marca as noites como ocupadas **pendentes**.
Para o público, essas noites aparecem como indisponíveis — ninguém mais consegue
pedir as mesmas datas.

A pendência tem **prazo** (`expiraEm`). Depois dele:

- a noite volta a estar disponível para uma nova solicitação;
- a reserva passa a `EXPIRADA`.

**A disponibilidade é decidida comparando `expiraEm` com o horário atual**, nunca
confiando em um processo de limpeza ter rodado. Uma noite pendente e vencida é
**livre**, mesmo que o item ainda exista no banco.

> Isso evita o bug clássico de depender do TTL do DynamoDB, cuja exclusão pode levar
> até ~48 h. O TTL serve apenas para faxina de itens antigos.

## R5 — Prazo da pré-reserva

- Configurável em `CONFIG/GERAL.prazoSolicitacaoHoras`. Padrão: **48 horas**.
- Contado a partir da criação da solicitação.
- O admin pode **estender** o prazo de uma solicitação específica ([UC-A09](../02-casos-de-uso/admin/UC-A09-estender-prazo.md)).
- Se o check-in for muito próximo, o prazo é truncado: `expiraEm` nunca passa de
  **12 h antes do horário de check-in**. Não faz sentido segurar uma data que já começou.

## R6 — Antecedência mínima

Não se aceita solicitação com check-in anterior a `hoje + antecedenciaMinimaDias`
(padrão: 1 dia). Reserva para "hoje" vai pelo WhatsApp.

## R7 — Janela de reserva

Não se aceita solicitação com check-in além de `hoje + janelaReservaMeses`
(padrão: 12 meses). Evita compromisso com preço de um futuro distante.

## R8 — Duração da estadia

| Regra | Valor |
|---|---|
| Mínimo de noites padrão | `minNoitesPadrao` da casa (padrão 2) |
| Mínimo de noites em feriado/temporada | o **maior** `minNoites` entre os períodos que a estadia toca |
| Máximo de noites | `maxNoites` da casa (padrão 60, **limite técnico rígido**) |

O máximo de 60 noites não é uma regra comercial: é o limite da transação que garante
a R3. Ver [05 — Concorrência](../03-tecnico/05-concorrencia-e-idempotencia.md).

### R8.1 — Como o mínimo de noites interage com os períodos

Se a estadia toca um feriado com `minNoites: 4` e uma temporada com `minNoites: 3`,
o mínimo exigido é **4**. A regra é deliberadamente conservadora: basta tocar o
período para o mínimo valer.

## R9 — Capacidade

- `hospedes` deve ser ≥ 1 e ≤ `capacidadeMaxima` da casa.
- Acima de `hospedesInclusos`, cada hóspede extra gera acréscimo por noite
  ([regras de preço](./02-regras-de-preco.md)).
- Crianças: `[DEFINIR]` se contam para a capacidade. Até a decisão, **contam**.

## R10 — Precedência em conflito de origem

Quando a importação iCal traz uma noite já ocupada por `RESERVA` ou `BLOQUEIO`
do site:

1. **Nunca sobrescrever.** A ocupação do site permanece.
2. Registrar o conflito.
3. Enviar e-mail `ALERTA_ADMIN` **imediato**, identificando casa, datas, canal externo
   e a reserva do site envolvida.
4. O admin resolve manualmente (cancelar num lado ou no outro).

Motivo: sobrescrever automaticamente poderia descartar uma reserva paga.
A decisão é humana porque o custo do erro é alto.

## R11 — O que o público pode ver da agenda

O endpoint público de disponibilidade e o `.ics` exportado devolvem **apenas datas**.
Nunca: nome do hóspede, e-mail, telefone, valor, tipo de ocupação ou motivo do bloqueio.

Para o público, "ocupado é ocupado" — não há distinção entre reserva, bloqueio e
evento externo.

## R12 — Exportação iCal não ecoa o que foi importado

O `.ics` exportado por casa inclui ocupações de tipo `RESERVA` (confirmadas e
pendentes não vencidas) e `BLOQUEIO`. **Exclui** as de tipo `EXTERNO`.

Motivo: se o Airbnb nos manda uma data e nós a devolvemos para o Booking, que a
devolve para o Airbnb, cria-se um eco que nunca se limpa quando a reserva original é
cancelada.

## Casos de teste obrigatórios

| # | Cenário | Esperado |
|---|---|---|
| 1 | Check-out no dia do check-in de outra reserva | Ambas válidas |
| 2 | Noite ocupada na Casa A, livre na Casa B | Solicitação na Casa B passa |
| 3 | Solicitação sobre noite pendente **não vencida** | `409 DATAS_INDISPONIVEIS` |
| 4 | Solicitação sobre noite pendente **vencida** | Aceita; a reserva antiga vira `EXPIRADA` |
| 5 | Duas solicitações simultâneas nas mesmas noites | Exatamente uma passa |
| 6 | Estadia de 1 noite com `minNoitesPadrao = 2` | `422 MINIMO_NOITES` |
| 7 | Estadia que toca feriado com `minNoites: 4`, pedindo 3 | `422 MINIMO_NOITES` com o mínimo exigido na mensagem |
| 8 | Estadia de 61 noites | `422 MAXIMO_NOITES` |
| 9 | Check-in = hoje, `antecedenciaMinimaDias = 1` | `422 ANTECEDENCIA_MINIMA` |
| 10 | Check-in a 13 meses, janela 12 | `422 FORA_DA_JANELA` |
| 11 | `hospedes` acima da capacidade | `422 CAPACIDADE_EXCEDIDA` |
| 12 | iCal traz noite já reservada no site | Reserva preservada + `ALERTA_ADMIN` |
| 13 | `.ics` exportado | Não contém nenhum evento de origem `EXTERNO` |
| 14 | Disponibilidade pública | Resposta sem nenhum dado pessoal |
