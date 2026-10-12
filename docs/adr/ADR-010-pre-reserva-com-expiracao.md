# ADR-010 — Pré-reserva com expiração

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | **Adapta a especificação inicial** (que usava bloqueio de 30 min, atrelado ao checkout de pagamento) |
| **Decisor** | Proprietário |

## Contexto

Sem pagamento online ([ADR-003](./ADR-003-pagamento-fora-do-site.md)), surge uma
pergunta que não existia na especificação original: **o que acontece com as datas entre
o pedido do hóspede e a decisão do proprietário?**

Na spec inicial, o bloqueio durava 30 minutos — o tempo de concluir um checkout. Agora
esse intervalo é uma **negociação humana**, que leva horas ou dias.

Sem nenhum mecanismo, o site seria apenas um formulário de contato, e duas pessoas
poderiam pedir as mesmas datas sem que nenhuma soubesse.

## Alternativas

| Opção | Risco de data travada | Atrito | Complexidade |
|---|---|---|---|
| **Pré-reserva com prazo configurável (48 h)** | Médio, limitado pelo prazo | Baixo | Média |
| Não segurar datas (só registrar o pedido) | Nenhum | **Alto** — "achei que tinha reservado" | Baixa |
| Segurar indefinidamente até o admin decidir | **Alto** — data travada para sempre | Baixo | Baixa |
| Fila de espera por data | Nenhum | Médio | **Alta** |
| Sinal online para segurar | Nenhum | Médio | Alta (reverteria o ADR-003) |

### Por que não "só registrar o pedido"

É o mais simples: o formulário manda um e-mail, as datas continuam livres, o admin
decide.

Problema: **o hóspede acredita que reservou.** Ele preencheu um formulário com datas,
viu um valor e recebeu uma confirmação de recebimento. Dizer depois "alguém pegou essa
data" é a pior experiência possível — e o proprietário é quem leva a reclamação.

Pior ainda: duas pessoas podem pedir a mesma data, ambas acreditando ter prioridade.

### Por que não segurar indefinidamente

Se o admin viajar ou esquecer, a data fica travada para sempre. Outro interessado vê
"ocupado" por nada, e o proprietário perde a reserva sem saber que a perdeu.

## Decisão

**A solicitação cria uma pré-reserva que segura as datas por um prazo configurável
(padrão 48 h). Depois do prazo, as datas são liberadas automaticamente e a reserva vira
`EXPIRADA`.**

| Regra | Valor |
|---|---|
| Prazo padrão | **48 horas** (configurável de 1 h a 30 dias) |
| Contado de | Criação da solicitação |
| Teto | Nunca passa de **12 h antes do horário de check-in** |
| Extensão | O admin pode estender caso a caso ([UC-A09](../02-casos-de-uso/admin/UC-A09-estender-prazo.md)), até 30 dias |
| Para o público | A noite pendente aparece **ocupada** |
| Liberação | Comparando `expiraEm` com o agora — **nunca** dependendo de um processo ter rodado |
| Limpeza | `cron-diario`, de hora em hora, muda o estado para `EXPIRADA` e apaga as ocupações |
| Antiabuso | Máximo 3 pendentes por e-mail |
| Desistência | O hóspede pode liberar na hora ([UC-P06](../02-casos-de-uso/publico/UC-P06-cancelar-solicitacao.md)) |
| Export iCal | Pendentes **entram** no `.ics` (conservador) |

### A decisão técnica que sustenta tudo

**A disponibilidade é decidida comparando `expiraEm` com o horário atual, não pelo
estado gravado.**

Uma noite com `pendente: true` e `expiraEm` no passado é **livre**, mesmo que o item
ainda exista no banco e a reserva ainda esteja `SOLICITADA`.

Isso elimina a dependência de o cron ter rodado e, por consequência, o bug clássico de
depender do TTL do DynamoDB — cuja exclusão pode levar até ~48 h. O TTL serve apenas
para faxina.

### Por que 48 horas

| Prazo | Efeito |
|---|---|
| 24 h | Libera datas rápido, mas pressiona o hóspede e exige resposta ágil do proprietário; um fim de semana estoura o prazo |
| **48 h** | **Cobre um fim de semana inteiro; equilibra os dois lados** |
| 72 h+ | Confortável para o proprietário, trava datas por muito tempo |

48 h é recomendação, não dogma: é configurável ([UC-A13](../02-casos-de-uso/admin/UC-A13-configuracao-geral.md))
e o admin pode estender caso a caso.

### Por que o teto de 12 h antes do check-in

Não faz sentido segurar uma data que começa em poucas horas. Se o hóspede pede uma
estadia que começa amanhã, o prazo de 48 h cairia depois do check-in. O teto garante
que a pendência sempre termine antes de a estadia começar.

## Consequências

### Positivas
- **Ninguém mais pode pedir as mesmas datas** durante a negociação — a garantia central
  do sistema vale também para solicitações.
- O hóspede tem **expectativa correta**: "guardamos até tal data e hora".
- A data **sempre volta** a estar disponível; nada trava para sempre.
- O prazo cria urgência saudável nos dois lados.
- O admin pode estender quando a negociação está em andamento.
- O export iCal com pendentes protege contra overbooking com canais externos.
- Máquina de estados simples: 6 estados, sem estado intermediário de negociação.

### Negativas
- **A data fica travada sem compromisso financeiro.** Um hóspede pode segurar 3 datas
  em 3 casas e desaparecer. Mitigado: limite de 3 pendentes por e-mail, e o admin pode
  recusar.
- **O proprietário precisa responder em 48 h.** Se não responder, perde o negócio. É um
  requisito operacional novo que o sistema impõe a ele.
- **`expiraEm` existe em dois lugares** (reserva e cada ocupação). Estender exige
  atualizar os dois — é a armadilha de [UC-A09](../02-casos-de-uso/admin/UC-A09-estender-prazo.md).
- **A filtragem por `expiraEm` acontece em todo lugar** que lê disponibilidade. Esquecer
  em um lugar faz uma data livre aparecer ocupada.
- Com cache de 60 s, uma noite recém-liberada pode aparecer ocupada por até um minuto.
- Reserva pendente no `.ics` pode fazer perder uma reserva externa por uma solicitação
  que depois expirou (trade-off assumido: melhor que overbooking).
- O contador antiabuso precisa ser decrementado em **quatro** transições diferentes;
  esquecer em uma bloqueia o hóspede sem motivo.

### O que fica mais difícil
- Permitir "lista de espera" para uma data (não é requisito).
- Explicar ao hóspede, em poucas palavras, que solicitar não é reservar — exige texto
  cuidadoso em três lugares (formulário, tela de sucesso, e-mail).

## Mitigações

| Consequência | Mitigação | Onde |
|---|---|---|
| Data travada sem compromisso | Prazo + limite de 3 pendentes por e-mail + o admin pode recusar | [UC-P04](../02-casos-de-uso/publico/UC-P04-solicitar-reserva.md) |
| Proprietário perder o prazo | Prazo destacado no painel; `PRAZO_EXPIRANDO_ADMIN` 6 h antes; taxa de expiração no relatório | [UC-A06](../02-casos-de-uso/admin/UC-A06-ver-agenda.md), [UC-A15](../02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md) |
| `expiraEm` em dois lugares | Transação única atualiza os dois; teste cobre | [UC-A09](../02-casos-de-uso/admin/UC-A09-estender-prazo.md) casos 3 e 4 |
| Esquecer a filtragem | Função única em `domain/disponibilidade.ts`; testes 3 e 4 de [regras de disponibilidade](../01-negocio/01-regras-de-disponibilidade.md) |
| Hóspede achar que reservou | Texto em três lugares + variável `{{prazoLimite}}` **obrigatória** no template | [UC-A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md) |
| Contador antiabuso divergente | TTL de 7 dias + recontagem corretiva no `cron-diario` | [02 — Modelo de dados](../03-tecnico/02-modelo-de-dados.md) |

> A variável `{{prazoLimite}}` ser **obrigatória** no template de solicitação é a
> mitigação mais elegante: o admin não consegue, nem querendo, publicar um e-mail que
> omita o prazo.

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| Muitas solicitações expirando por demora do admin | Reduzir o prazo, ou reavaliar o [ADR-003](./ADR-003-pagamento-fora-do-site.md) |
| Abuso recorrente (datas travadas sem intenção real) | Sinal online para segurar a data (reverteria parte do ADR-003) |
| Admin pedindo prazo maior sempre | Aumentar o padrão para 72 h |
| Reclamação de "pedi e não era reserva" | Reforçar o texto; é falha de comunicação, não de arquitetura |
| Demanda por lista de espera | Avaliar — é complexidade significativa para ganho incerto |
