# UC-A09 — Estender o prazo de uma solicitação

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; reserva em `SOLICITADA` |
| Gatilho | O admin clica em "+48h" no painel ou em "Estender prazo" no detalhe |
| Fase | 2 |
| Relacionados | [UC-A07](./UC-A07-confirmar-reserva.md), [Regras de disponibilidade](../../01-negocio/01-regras-de-disponibilidade.md), [Ciclo de vida](../../01-negocio/03-ciclo-de-vida-da-reserva.md) |

## Objetivo de negócio

A negociação real nem sempre cabe em 48 horas: o hóspede está consultando a família,
o proprietário está viajando, é fim de semana. Sem a extensão, a solicitação expira
no meio de uma conversa em andamento — as datas são liberadas, outra pessoa pode
pegá-las, e o negócio quase fechado se perde.

É uma operação pequena que evita a perda mais frustrante do sistema.

**Por que isso não é um novo estado:** poderia existir um `EM_NEGOCIACAO`, mas ele
teria exatamente o mesmo comportamento de `SOLICITADA` com outro prazo. Estender
`expiraEm` resolve o problema sem adicionar um estado à máquina — e estado a menos é
um caminho a menos para dar errado.

## Fluxo principal

1. O admin vê a solicitação com prazo curto no painel.
2. Clica em **"+48h"** (atalho) ou em "Estender prazo" no detalhe, onde pode escolher
   o novo prazo.
3. O servidor:
   1. valida o JWT;
   2. carrega a reserva;
   3. valida que está `SOLICITADA`;
   4. calcula o novo `expiraEm`;
   5. atualiza, em **uma transação**, a reserva **e todas as ocupações pendentes**;
   6. responde.
4. O painel atualiza o tempo restante.
5. Opcionalmente, avisa o hóspede do novo prazo.

> O passo 5 é **opcional e desmarcado por padrão**: na maioria dos casos o admin está
> no meio de uma conversa por WhatsApp e um e-mail automático seria ruído. Mas se a
> extensão é longa, avisar é educado — então a opção existe.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Atalho "+48h" no painel | Soma 48 h ao prazo **atual** (não ao agora) |
| A2 | Admin escolhe data e hora específicas | Campo de data/hora no detalhe |
| A3 | Admin estende uma solicitação já vencida (cron ainda não rodou) | Permitido: o prazo passa a contar do **agora**, não do vencido |
| A4 | Admin estende várias vezes | Permitido; cada extensão fica no `historico` |
| A5 | Admin avisa o hóspede | `PRAZO_ESTENDIDO` enviado com o novo prazo |
| A6 | Admin quer **reduzir** o prazo | Permitido pelo campo de data/hora, com aviso |

> A3 é um detalhe de experiência que importa: o admin abre o painel às 9h e vê uma
> solicitação que venceu às 7h, mas que ele estava negociando. Se a extensão somasse
> ao prazo vencido, o resultado já estaria no passado. Somar ao `agora` é o que ele
> espera. (As noites ainda estão lá: o cron pode não ter rodado, e mesmo que tenha,
> ver E3.)

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Reserva `CONFIRMADA` | `409 TRANSICAO_INVALIDA` | "Esta reserva já está confirmada e não tem prazo." |
| E2 | Reserva `RECUSADA`/`CANCELADA` | `409` | Tela atualiza |
| E3 | Reserva já processada como `EXPIRADA` (noites liberadas) | `409` | "Esta solicitação expirou e as datas foram liberadas. Crie uma nova reserva." → leva a [UC-A11](./UC-A11-criar-reserva-manual.md) com os dados preenchidos |
| E4 | Noite já tomada por outra reserva | `409 DATAS_INDISPONIVEIS` | "As datas foram tomadas pela reserva de João Souza." + link |
| E5 | Novo prazo depois de 12 h antes do check-in | `422 PRAZO_INVALIDO` | "O prazo não pode passar de 12 h antes do check-in (18/11 às 02h00)." |
| E6 | Novo prazo no passado | `422 PRAZO_INVALIDO` | Campo marcado |
| E7 | Extensão acima de 30 dias | `422 PRAZO_INVALIDO` | "Prazo máximo de 30 dias. Para segurar mais tempo, confirme a reserva." |
| E8 | Expirou **durante** o clique | `409` | Mesmo tratamento de E3 |
| E9 | Falha de rede | — | Mensagem + Tentar novamente |

> **E3 vs. A3** é a distinção fina deste UC: se a reserva está `SOLICITADA` com prazo
> vencido mas as noites **ainda são dela**, estender funciona (A3). Se o cron já a
> marcou `EXPIRADA` e liberou as noites, não há o que estender (E3) — e a saída é criar
> uma reserva nova.
>
> **E7 existe para evitar o uso errado da ferramenta.** Segurar uma data por 90 dias
> "pendente" é, na prática, uma reserva confirmada sem os efeitos de uma — sem e-mail
> de confirmação para o hóspede e sem sair da fila de pendentes. O limite força a
> decisão correta.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Só reservas em `SOLICITADA` |
| RN2 | O atalho soma ao prazo atual, ou ao agora se o prazo já passou |
| RN3 | O novo `expiraEm` precisa estar no futuro |
| RN4 | O novo `expiraEm` nunca passa de **12 h antes do horário de check-in** |
| RN5 | Extensão máxima: **30 dias** a partir do agora |
| RN6 | A atualização cobre a reserva **e todas as ocupações pendentes dela** |
| RN7 | Operação atômica |
| RN8 | Cada ocupação é atualizada com condição `refId = :reservaId AND pendente = true` |
| RN9 | O `ttl` das ocupações é recalculado (`novo expiraEm + 7 dias`) |
| RN10 | Cada extensão entra no `historico` com o prazo anterior e o novo |
| RN11 | O e-mail ao hóspede é **opcional**, desmarcado por padrão |
| RN12 | Estender **não** muda o estado da reserva |
| RN13 | Reduzir o prazo é permitido, com aviso |

> RN6 é a armadilha central: `expiraEm` existe em **dois lugares** — na reserva e em
> cada ocupação. Atualizar só a reserva deixaria as ocupações expirando no prazo
> antigo, e o calendário público liberaria as datas enquanto o painel mostraria a
> solicitação ativa. Divergência silenciosa, difícil de diagnosticar.

## Contrato técnico

### `POST /api/admin/reservas/{reservaId}/estender-prazo`

Duas formas de uso:

```json
{ "horasAdicionais": 48, "avisarHospede": false }
```

```json
{ "novoPrazo": "2026-10-20T18:00:00-03:00", "avisarHospede": true }
```

| Campo | Validação |
|---|---|
| `horasAdicionais` | inteiro 1–720 (30 dias); exclusivo com `novoPrazo` |
| `novoPrazo` | ISO 8601 com offset; exclusivo com `horasAdicionais` |
| `avisarHospede` | booleano, padrão `false` |

Exatamente um dos dois primeiros é obrigatório → `400` se ambos ou nenhum.

Resposta `200`:

```json
{
  "reservaId": "01HQ8X...",
  "prazoAnterior": "2026-10-13T18:04:00-03:00",
  "novoPrazo": "2026-10-15T18:04:00-03:00",
  "novoPrazoFormatado": "15/10/2026 às 18h04",
  "horasRestantes": 89,
  "noitesAtualizadas": 3,
  "emailEnviado": false
}
```

### Erros

| Código | HTTP | `detalhes` |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | `campos[]` |
| `NAO_ENCONTRADO` | 404 | — |
| `TRANSICAO_INVALIDA` | 409 | `statusAtual` |
| `DATAS_INDISPONIVEIS` | 409 | `noitesIndisponiveis[]`, `reservaConflitante` |
| `PRAZO_INVALIDO` | 422 | `prazoMaximo`, `motivo` |

## Implementação

```
 1. exigirAdmin()
 2. zod: exatamente um de horasAdicionais | novoPrazo
 3. GetItem da reserva                              → 404
 4. status !== SOLICITADA                           → 409
 5. base = max(expiraEm atual, agora)                 ← regra A3/RN2
    novoPrazo = horasAdicionais ? base + horas : novoPrazo informado
 6. validar:
      novoPrazo > agora                              → 422
      novoPrazo <= checkin − 12 h                    → 422
      novoPrazo <= agora + 30 dias                   → 422
 7. TransactWriteItems:
      Update RESERVA#<id>/META
        SET expiraEm = :novo, ttl = :novoTtl, atualizadoEm = :agora,
            historico = list_append(...)
        ConditionExpression: #s = :solicitada
      Para cada noite:
        Update OCUPACAO#<casaId>/NOITE#<data>
          SET expiraEm = :novo, #ttl = :novoTtl
          ConditionExpression: refId = :reservaId AND pendente = :verdadeiro
 8. tratar CancellationReasons:
      reason[0]  → 409 TRANSICAO_INVALIDA (recarregar)
      reason[i]  → 409 DATAS_INDISPONIVEIS (buscar o refId da noite que falhou)
 9. 200
10. se avisarHospede: enviar PRAZO_ESTENDIDO (try/catch)
```

O `checkin − 12 h` do passo 6 precisa do horário de check-in da configuração da casa,
em `America/Sao_Paulo` — não é meia-noite.

### Armadilhas

1. **Atualizar as ocupações também** (RN6). É o erro mais provável deste UC.
2. **`base = max(expiraEm, agora)`** (RN2/A3). Somar ao prazo vencido geraria prazo no
   passado.
3. **Recalcular o `ttl`** (RN9). Se o `ttl` continuar o antigo, o DynamoDB pode apagar
   a ocupação de uma solicitação ativa — e aí a noite fica livre sem que nada no
   sistema saiba. É o pior bug possível porque não gera erro nenhum.
4. **Condição `pendente = true`** na ocupação: se já não é pendente, a reserva não está
   `SOLICITADA` e algo está inconsistente.
5. **`PRAZO_ESTENDIDO` é um e-mail novo** — precisa de template padrão e entrada na
   allowlist de variáveis.
6. **Não permitir prazo ilimitado** (RN5/E7).
7. **Fuso.** Todo cálculo em `America/Sao_Paulo`; a resposta já formatada.

## Interface

### Atalho no painel

```
│ ⏱ 4h restantes          Casa do Lago                      │
│ Maria Silva · (11) 99999-9999                             │
│ [ Confirmar ] [ Recusar ] [ +48h ] [ WhatsApp ] [ Abrir ] │
```

Um clique em `+48h` executa direto, sem diálogo, e mostra o resultado em um aviso
discreto: *"Prazo estendido para 15/10 às 18h04."* — com **desfazer** por 10 segundos.

> Sem diálogo porque é uma ação de **baixo risco e alta frequência**: no pior caso o
> admin estendeu um prazo sem querer, o que não quebra nada. Pedir confirmação em cada
> clique treinaria o admin a confirmar sem ler — e aí ele confirmaria também os
> diálogos que importam.
>
> O "desfazer" é implementado como uma nova chamada com `novoPrazo` = prazo anterior.

### Detalhe

```
┌────────────────────────────────────────────────────┐
│  Estender prazo                                     │
│                                                      │
│  Maria Silva · Casa do Lago · 20 a 23/11/2026        │
│  Prazo atual: 13/10/2026 às 18h04 (faltam 4 horas)   │
│                                                      │
│  Novo prazo:                                         │
│   ( ) +24 horas   → 14/10 às 18h04                   │
│   (•) +48 horas   → 15/10 às 18h04                   │
│   ( ) +7 dias     → 20/10 às 18h04                   │
│   ( ) Data específica  [ __/__/____ ] [ __:__ ]      │
│                                                      │
│  Prazo máximo: 18/11/2026 às 02h00                   │
│  (12 horas antes do check-in)                        │
│                                                      │
│  [ ] Avisar o hóspede por e-mail                     │
│                                                      │
│  ⓘ As datas continuam guardadas até o novo prazo.    │
│    Para garantir definitivamente, confirme a reserva.│
│                                                      │
│            [ Voltar ]  [ Estender ]                  │
└────────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| Opções com o prazo resultante já calculado | O admin vê a data, não faz conta |
| Prazo máximo visível | Explica a limitação antes do erro |
| Aviso ao hóspede desmarcado | Padrão menos intrusivo |
| Nota sobre confirmar | Empurra para a ação correta quando a negociação já está madura |
| Desfazer no atalho | Reverte o erro de clique sem diálogo |

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` |
| Integridade | Condição em status e em `refId`/`pendente` por noite |
| Limite | 30 dias — evita travar datas indefinidamente |
| Auditoria | Toda extensão no `historico`, com prazo anterior e novo |
| Log | `reservaId`, prazo anterior e novo, `sub` do admin. Nenhum dado pessoal |
| Impacto no hóspede | Só positivo (mais tempo); e-mail opcional |

## Critérios de aceite

- [ ] Estender atualiza `expiraEm` na reserva **e em todas as ocupações**.
- [ ] O `ttl` das ocupações é recalculado.
- [ ] O atalho `+48h` soma ao prazo atual.
- [ ] Com prazo já vencido, soma ao agora.
- [ ] Reserva `CONFIRMADA` retorna `409`.
- [ ] Reserva `EXPIRADA` processada retorna `409` e oferece criar reserva.
- [ ] Noite tomada por outra reserva retorna `409` nomeando-a.
- [ ] Prazo acima de 12 h antes do check-in retorna `422` informando o máximo.
- [ ] Prazo no passado retorna `422`.
- [ ] Extensão acima de 30 dias retorna `422`.
- [ ] Múltiplas extensões ficam no `historico`.
- [ ] O estado da reserva **não** muda.
- [ ] `avisarHospede: false` (padrão) não envia e-mail.
- [ ] `avisarHospede: true` envia `PRAZO_ESTENDIDO`.
- [ ] O atalho tem desfazer.
- [ ] Disponibilidade pública continua mostrando as noites ocupadas.
- [ ] Todo cálculo em `America/Sao_Paulo`.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | `+48h` com prazo em 4 h | Novo prazo = prazo atual + 48 h |
| 2 | `+48h` com prazo vencido há 2 h | Novo prazo = agora + 48 h |
| 3 | `expiraEm` das 3 ocupações após estender | Igual ao da reserva |
| 4 | `ttl` das ocupações | Recalculado para novo prazo + 7 dias |
| 5 | Estender `CONFIRMADA` | `409` |
| 6 | Estender `RECUSADA` | `409` |
| 7 | Estender `EXPIRADA` com noites liberadas | `409` com sugestão |
| 8 | Noite tomada por outra reserva | `409` com o nome |
| 9 | Prazo 6 h antes do check-in | `422` com o máximo |
| 10 | Prazo ontem | `422` |
| 11 | `horasAdicionais: 800` | `422` |
| 12 | `horasAdicionais` **e** `novoPrazo` juntos | `400` |
| 13 | Nenhum dos dois | `400` |
| 14 | Estender 3 vezes | 3 entradas no `historico` |
| 15 | Estado após estender | Continua `SOLICITADA` |
| 16 | `avisarHospede: true` | `PRAZO_ESTENDIDO` enviado |
| 17 | `avisarHospede` padrão | Nenhum e-mail |
| 18 | Desfazer após `+48h` | Prazo volta ao anterior |
| 19 | Reduzir o prazo | Aceito; aviso na tela |
| 20 | Disponibilidade pública | Noites ocupadas |
| 21 | `cron-diario` após estender | **Não** expira a reserva |
| 22 | Estender e expirar simultaneamente | Um vence; estado coerente |
| 23 | Invariantes após estender | I2 e I4 válidas |
