# 05 — Concorrência e idempotência

O documento mais importante para a **correção** do sistema. Overbooking é o único
defeito que custa dinheiro e reputação de verdade.

## A garantia central

> **Para uma casa e uma data, existe no máximo uma ocupação ativa.**

Essa garantia **não** vem de um `if` no código. Vem de uma escrita condicional do
DynamoDB dentro de uma transação. É a diferença entre "quase sempre correto" e
"correto".

## Criar solicitação — a transação

```ts
// Pseudocódigo. A implementação fica em lib/db.ts.
const agora = new Date().toISOString();

await ddb.transactWrite({
  TransactItems: [
    // 1. A reserva
    {
      Put: {
        TableName: TABELA,
        Item: itemReserva,                       // status: SOLICITADA
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },

    // 2. Uma entrada por noite — N itens
    ...noites.map((data) => ({
      Put: {
        TableName: TABELA,
        Item: {
          PK: `OCUPACAO#${casaId}`,
          SK: `NOITE#${data}`,
          casaId, data,
          tipo: "RESERVA",
          refId: reservaId,
          pendente: true,
          expiraEm,
          ttl: epochDe(expiraEm) + 7 * 86400,
        },
        // Livre, OU ocupada por uma pendência já vencida.
        ConditionExpression:
          "attribute_not_exists(PK) OR (pendente = :verdadeiro AND expiraEm < :agora)",
        ExpressionAttributeValues: { ":verdadeiro": true, ":agora": agora },
      },
    })),

    // 3. Contador antiabuso
    {
      Update: {
        TableName: TABELA,
        Key: { PK: `ANTIABUSO#${hashEmail}`, SK: "META" },
        UpdateExpression:
          "SET pendentes = if_not_exists(pendentes, :zero) + :um, ultimaEm = :agora, #ttl = :ttl",
        ConditionExpression: "attribute_not_exists(pendentes) OR pendentes < :max",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":zero": 0, ":um": 1, ":agora": agora, ":ttl": ttlAntiabuso, ":max": maxPendentes },
      },
    },
  ],
});
```

### Por que funciona

`TransactWriteItems` é **ACID**: ou todos os itens são gravados, ou nenhum.
Se duas requisições simultâneas tentarem ocupar a noite `2026-11-20`:

1. Ambas leem a disponibilidade e veem a noite livre.
2. Ambas montam a transação.
3. O DynamoDB serializa: uma commita, a outra falha a condição daquela noite.
4. A que falhou **não gravou nada** — nem a reserva, nem as outras noites.

A janela entre ler e escrever não importa, porque a condição é reavaliada no momento
da escrita.

### Tratando a falha

`TransactionCanceledException` traz `CancellationReasons` — um array **na mesma ordem**
dos `TransactItems`, com `Code: "ConditionalCheckFailed"` nos que falharam.

```
reason[0] falhou                     → reservaId colidiu (ULID duplicado, praticamente impossível)
                                       → regerar o id e tentar de novo, 1 vez
reason[i] com 1 <= i <= N falhou     → 409 DATAS_INDISPONIVEIS
                                       detalhes.noitesIndisponiveis = noites[i-1] dos que falharam
reason[N+1] falhou                   → 429 LIMITE_SOLICITACOES
```

A resposta `409` deve dizer **quais** noites estão indisponíveis, para o calendário
marcá-las imediatamente sem recarregar tudo.

> `TransactionCanceledException` também aparece em `TransactionConflict` (duas
> transações sobre o **mesmo item** ao mesmo tempo, sem relação com a condição).
> Esse caso é retentável: até 2 tentativas com backoff de 50 ms e 150 ms.
> Distinga pelo `Code` — tratar conflito como indisponibilidade recusaria uma
> solicitação válida.

### O limite de 100 itens

`TransactWriteItems` aceita no máximo **100 itens**. Nossa transação usa
`1 (reserva) + N (noites) + 1 (antiabuso)`, logo `N <= 98`.

Adotamos **`maxNoites = 60`**, com folga deliberada para absorver itens futuros
na transação sem reabrir essa conta. O limite é validado na configuração de preços
([regras de preço](../01-negocio/02-regras-de-preco.md)) e na cotação.

> Nunca "resolva" uma estadia longa quebrando em duas transações: perde-se a
> atomicidade, que é a única coisa que garante a correção. Se um dia houver demanda
> real por estadias longas, a solução é mudar a granularidade (ocupação por semana),
> não fatiar a transação.

---

## Confirmar reserva

```
TransactWriteItems:
  Update RESERVA#<id>/META
    SET status = CONFIRMADA, confirmadaEm = :agora
    REMOVE expiraEm, ttl
    ConditionExpression: status = :solicitada

  Para cada noite:
    Update OCUPACAO#<casaId>/NOITE#<data>
      REMOVE pendente, expiraEm, ttl
      ConditionExpression: refId = :reservaId
```

A condição `status = :solicitada` protege contra dois cliques no botão e contra o
`cron-diario` expirando a reserva entre a leitura e a escrita.

A condição `refId = :reservaId` em cada noite protege contra o caso sutil e real:
a solicitação expirou, a noite foi tomada por **outra** reserva, e só então o admin
clicou em confirmar. Sem essa condição, a confirmação roubaria a noite da outra reserva.

Nesse caso a resposta é `409 DATAS_INDISPONIVEIS` com uma mensagem específica:
*"Esta solicitação expirou e as datas foram tomadas por outra reserva. Veja a agenda
antes de decidir."*

---

## Liberar noites (recusar, expirar, cancelar)

```
TransactWriteItems:
  Update RESERVA#<id>/META
    SET status = <novoEstado>, ...
    ConditionExpression: status IN (<estados de origem permitidos>)

  Para cada noite:
    Delete OCUPACAO#<casaId>/NOITE#<data>
      ConditionExpression: refId = :reservaId
```

`Delete` com condição em `refId` é essencial: se a noite já pertence a outra reserva
(porque esta expirou antes), **não a apague**.

### O detalhe que quebra ingênuos

Se a noite já foi tomada por outra reserva, o `Delete` condicional falha e **a
transação inteira falha** — incluindo a mudança de status da reserva que queremos
liberar. Resultado: a reserva fica presa em `SOLICITADA` para sempre.

**Solução adotada:** antes de montar a transação, ler as noites e incluir no
`TransactItems` apenas os `Delete` das que **ainda pertencem a esta reserva**. As que
pertencem a outra são ignoradas — já não são nossas.

```ts
const ocupacoes = await lerOcupacoes(casaId, reserva.noites);
const minhas = ocupacoes.filter((o) => o.refId === reserva.reservaId);
// Transação: update da reserva + delete apenas de `minhas`.
```

Ainda há uma corrida teórica (a noite muda de dono entre a leitura e a transação),
e nesse caso a transação falha e é **retentada**: até 3 tentativas, relendo as
ocupações a cada vez. Se falhar 3 vezes, loga, gera `ALERTA_ADMIN` e responde `409` —
situação que exige olho humano.

---

## Importação iCal

Cada `VEVENT` novo é gravado individualmente (não em transação — eventos são
independentes):

```
Put OCUPACAO#<casaId>/NOITE#<data>
  Item: { tipo: "EXTERNO", refId: "<canal>:<uid>" }
  ConditionExpression: attribute_not_exists(PK)
                       OR refId = :mesmoRef
                       OR (pendente = :verdadeiro AND expiraEm < :agora)
```

- `attribute_not_exists` → noite livre, grava.
- `refId = :mesmoRef` → já é o mesmo evento externo, idempotente.
- pendência vencida → pode sobrescrever, está livre.
- **Qualquer outro caso** → falha a condição = conflito.
  A ocupação do site é preservada e um `ALERTA_ADMIN` é gerado
  ([R10](../01-negocio/01-regras-de-disponibilidade.md)).

Remoção de eventos: `Delete` com `ConditionExpression: refId = :mesmoRef` — só apaga
o que é daquele evento externo.

---

## Idempotência

| Operação | Como é idempotente |
|---|---|
| Criar solicitação | `attribute_not_exists(PK)` no ULID. Dois cliques criam duas reservas (ids diferentes) — mitigado desabilitando o botão e, em `409`, mostrando a reserva existente do mesmo e-mail/datas |
| Confirmar / recusar / cancelar | Condição no status. A segunda chamada recebe `409` com o estado atual; o cliente trata como sucesso se o estado já é o desejado |
| Cancelar (hóspede) | Se já `CANCELADA`, responde `200` — ação do usuário, não deve mostrar erro |
| Expirar (`cron-diario`) | Condição `status = SOLICITADA AND expiraEm < :agora`. Duas execuções simultâneas: uma vence, a outra falha silenciosamente |
| Enviar e-mail | `emailsEnviados` verificado antes e atualizado após o envio |
| Importar iCal | Condição em `refId`; reimportar o mesmo evento não muda nada |
| Publicar conteúdo | Condição no status de `PUBLICACAO/ATUAL`; publicação concorrente é rejeitada com `409 PUBLICACAO_EM_ANDAMENTO` |
| Upload de foto | A chave no S3 inclui um sufixo aleatório; reenviar cria outro objeto, e só o registrado no item da casa é referenciado |

### Dois cliques em "Solicitar reserva"

Vale detalhar porque é o caso mais provável de acontecer de verdade:

1. O botão é desabilitado no `submit` e só reabilita no erro.
2. Se o segundo clique passar, a segunda transação falha com `409 DATAS_INDISPONIVEIS`
   (a primeira já ocupou as noites).
3. A tela trata esse `409` verificando se há uma reserva recente do mesmo e-mail nas
   mesmas datas; se houver, mostra a tela de sucesso daquela reserva em vez do erro.

O passo 2 significa que o sistema **já está correto** sem o passo 3. O passo 3 é só
para o usuário não ver um erro assustador por causa de um clique duplo.

## Idempotência dos crons

Os dois crons podem rodar em paralelo com uma execução anterior que demorou.
Regras:

- Nenhum cron tem estado próprio. Todas as decisões vêm de condições no banco.
- Nenhum cron apaga nada sem condição em `refId`.
- Os crons **não** usam lock distribuído. Não precisam: cada operação individual é
  condicional e idempotente. Lock seria mais uma peça para dar errado.

## Testes obrigatórios de concorrência

Rodam contra **DynamoDB Local** (Docker). Ver [14 — Testes](./14-estrategia-de-testes.md).

| # | Teste | Esperado |
|---|---|---|
| 1 | 2 solicitações simultâneas, mesmas noites, mesma casa | Exatamente 1 sucesso, 1 `409` |
| 2 | 10 solicitações simultâneas, mesmas noites | Exatamente 1 sucesso, 9 `409` |
| 3 | 2 solicitações simultâneas, mesmas noites, **casas diferentes** | 2 sucessos |
| 4 | 2 solicitações simultâneas, noites **parcialmente** sobrepostas | 1 sucesso, 1 `409` com a lista correta |
| 5 | Solicitação sobre noite com pendência vencida | Sucesso; a antiga vira `EXPIRADA` |
| 6 | Confirmar e expirar simultaneamente | Exatamente um vence; estado final coerente |
| 7 | Confirmar após expiração, noites tomadas | `409` com mensagem específica; a outra reserva intacta |
| 8 | Liberar noites quando uma já pertence a outra reserva | Reserva liberada; a noite da outra **intacta** |
| 9 | iCal importa noite já reservada | Ocupação do site preservada + alerta |
| 10 | Dois cliques em confirmar | 1 sucesso, 1 `409`; um único e-mail enviado |
| 11 | Verificação de invariantes após as rodadas acima | Todas as invariantes I1–I9 válidas |

O teste 11 é o mais valioso: depois de qualquer bateria de concorrência, os
[invariantes](../01-negocio/03-ciclo-de-vida-da-reserva.md#invariantes-do-sistema)
precisam valer.
