# UC-A05 — Bloquear e liberar períodos

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; casa existente |
| Gatilho | O admin abre `/admin/bloqueios` ou clica em um período na agenda |
| Fase | 1 |
| Relacionados | [Regras de disponibilidade](../../01-negocio/01-regras-de-disponibilidade.md), [UC-A06](./UC-A06-ver-agenda.md), [05 — Concorrência](../../03-tecnico/05-concorrencia-e-idempotencia.md) |

## Objetivo de negócio

O proprietário precisa reservar a casa para si: uso da família, manutenção, reforma,
período em que o caseiro está de férias. Sem isso, o site ofereceria datas que não
existem — e o constrangimento recairia sobre ele.

É também o mecanismo usado na **Fase 1**, antes de o fluxo de reservas existir: o
calendário mostra disponibilidade real porque o admin bloqueia o que já está alugado
por fora.

## Fluxo principal

1. O admin abre `/admin/bloqueios` (ou arrasta sobre um período na agenda).
2. Clica em **"Novo bloqueio"**.
3. Escolhe a casa, a data de início, a data de fim e o motivo.
4. A tela mostra quantas noites serão bloqueadas e avisa se há conflito.
5. Confirma.
6. O servidor cria o bloqueio e as ocupações das noites, em **uma transação**.
7. As datas ficam indisponíveis no site público (após o cache de 60 s) e no `.ics`.

### Liberar

1. O admin localiza o bloqueio na lista ou na agenda.
2. Clica em **"Remover bloqueio"** e confirma (a confirmação nomeia casa e datas).
3. O servidor apaga o bloqueio e as ocupações, em uma transação.
4. As datas voltam a ficar disponíveis.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Bloqueio de uma única noite | `inicio == fim`; 1 noite |
| A2 | Admin bloqueia várias casas no mesmo período | Um bloqueio **por casa**; a tela permite marcar várias e cria N bloqueios |
| A3 | Admin arrasta na agenda | Datas pré-preenchidas no formulário |
| A4 | Admin edita um bloqueio existente | Implementado como remover + criar, em uma transação |
| A5 | Bloqueio no passado | Permitido (registro histórico), com aviso |
| A6 | Admin bloqueia um período com noites já bloqueadas | Cria apenas as noites livres, informando quais foram ignoradas |

> A6 evita o atrito de ter que calcular manualmente qual trecho ainda está livre.
> O resultado é informado explicitamente, nunca silenciosamente.

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | `fim` antes de `inicio` | `422 INTERVALO_INVALIDO` | Campos marcados |
| E2 | Noite com **reserva** (`SOLICITADA` ou `CONFIRMADA`) | `409 DATAS_INDISPONIVEIS` | "Há reservas nesse período: Maria Silva (20–23/11). Cancele a reserva antes de bloquear." com link |
| E3 | Noite com evento **externo** | `409` | "Há reserva do Airbnb em 25/11." |
| E4 | Período acima de 60 noites | `422 MAXIMO_NOITES` | "Bloqueie em períodos de até 60 noites." |
| E5 | Casa inexistente | `404` | — |
| E6 | Remover bloqueio inexistente | `404` | Lista recarregada |
| E7 | Remover bloqueio duas vezes | `200` na segunda | Idempotente; sem erro |
| E8 | Falha de rede | — | "Não conseguimos salvar." + Tentar novamente; **dados preservados** |
| E9 | Noite do bloqueio já pertence a outra coisa na hora de remover | — | Remoção conclui; aquela noite não é apagada |

> **E2 é a decisão de produto central deste UC:** bloquear **não** passa por cima de
> reserva. O admin tem de cancelar a reserva explicitamente
> ([UC-A08](./UC-A08-recusar-ou-cancelar-reserva.md)), com o e-mail que isso implica.
> Deixar o bloqueio sobrescrever faria o hóspede chegar e encontrar a casa ocupada,
> sem ninguém ter avisado.
>
> O erro precisa **nomear as reservas em conflito e dar o link** — é o que torna o
> `409` acionável em vez de frustrante.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | `inicio` e `fim` são **inclusivos** e referem-se à noite |
| RN2 | `fim >= inicio` |
| RN3 | Máximo de 60 noites por bloqueio (limite da transação) |
| RN4 | Bloqueio **não** sobrescreve `RESERVA` nem `EXTERNO` |
| RN5 | Bloqueio **pode** sobrescrever noite pendente **vencida** |
| RN6 | O motivo é obrigatório (3–200 chars) e **interno** — nunca aparece no site |
| RN7 | A criação é atômica: bloqueio + todas as noites, ou nada |
| RN8 | Remover apaga só as ocupações cujo `refId` é deste bloqueio |
| RN9 | Remover é idempotente |
| RN10 | Bloqueios entram no `.ics` exportado como `Indisponível` |
| RN11 | Para o público, bloqueio é indistinguível de reserva |
| RN12 | Bloqueio não dispara nenhum e-mail |
| RN13 | Bloqueio é por casa |
| RN14 | Registra `criadoPor` e `criadoEm` |

> RN1 merece atenção: aqui `inicio`/`fim` são **inclusivos** ("de 10 a 15 está
> bloqueado" = 6 noites), enquanto reserva usa check-out **exclusivo** (10 a 15 = 5
> noites). As duas convenções coexistem de propósito, porque cada uma é a natural para
> quem a usa. A conversão fica em `domain/datas.ts`, com teste para as duas.

## Contrato técnico

### `POST /api/admin/bloqueios`

```json
{
  "casaId": "01HQ...",
  "inicio": "2026-12-10",
  "fim": "2026-12-15",
  "motivo": "Manutenção da bomba d'água"
}
```

Resposta `201`:

```json
{
  "bloqueioId": "01HR2A...",
  "casaId": "01HQ...",
  "inicio": "2026-12-10",
  "fim": "2026-12-15",
  "noites": ["2026-12-10","2026-12-11","2026-12-12","2026-12-13","2026-12-14","2026-12-15"],
  "totalNoites": 6,
  "motivo": "Manutenção da bomba d'água",
  "noitesIgnoradas": [],
  "criadoEm": "2026-10-11T18:04:00-03:00"
}
```

`409 DATAS_INDISPONIVEIS`:

```json
{
  "erro": "DATAS_INDISPONIVEIS",
  "mensagem": "Há reservas nesse período.",
  "detalhes": {
    "conflitos": [
      { "data": "2026-12-12", "tipo": "RESERVA", "reservaId": "01HQ8X...",
        "hospedeNome": "Maria Silva", "status": "CONFIRMADA" },
      { "data": "2026-12-13", "tipo": "EXTERNO", "canal": "AIRBNB" }
    ]
  }
}
```

### `GET /api/admin/bloqueios?casaId=&de=&ate=`

Lista com `bloqueioId`, casa, datas, total de noites, motivo, autor e data de criação.
Intervalo máximo: 13 meses.

### `DELETE /api/admin/bloqueios/{bloqueioId}`

Resposta `200` com `{ "bloqueioId", "noitesLiberadas": 6 }`. Idempotente.

### Erros

| Código | HTTP |
|---|---|
| `ENTRADA_INVALIDA` | 400 |
| `NAO_ENCONTRADO` | 404 |
| `DATAS_INDISPONIVEIS` | 409 |
| `INTERVALO_INVALIDO` | 422 |
| `MAXIMO_NOITES` | 422 |

## Implementação

### Criação

```
1. zod + validações de intervalo         → 400 / 422
2. GetItem da casa                       → 404
3. noites = noitesInclusivas(inicio, fim)
4. Query das ocupações dessas noites
5. separar: livres | pendentes vencidas | conflitos (RESERVA/EXTERNO/BLOQUEIO ativo)
6. se houver conflito E o admin não pediu "ignorar" → 409 com o detalhamento
7. TransactWriteItems:
     Put BLOQUEIO#<id>/META
     Put OCUPACAO#<casaId>/NOITE#<data> para cada noite bloqueável
       ConditionExpression: attribute_not_exists(PK)
                            OR (pendente = :verdadeiro AND expiraEm < :agora)
8. se a condição falhar (corrida) → reler e devolver 409 atualizado
9. 201 com noitesIgnoradas
```

Os passos 4–6 existem para a **mensagem** (nomear as reservas em conflito); a condição
do passo 7 é o que garante a **correção**. Os dois são necessários, por motivos
diferentes.

### Remoção

```
1. GetItem do bloqueio                   → 404 (ou 200 se já removido: idempotente)
2. Query das ocupações das noites dele
3. filtrar apenas as com refId = bloqueioId
4. TransactWriteItems:
     Delete BLOQUEIO#<id>/META
     Delete de cada ocupação própria (ConditionExpression: refId = :bloqueioId)
5. em falha de transação: reler e repetir, até 3 vezes
6. 200
```

O passo 3 é o mesmo cuidado do cancelamento de reserva: filtrar antes evita que uma
noite que mudou de dono derrube a transação inteira.

### Armadilhas

1. **Convenção inclusiva.** `noitesInclusivas(inicio, fim)` é uma função **diferente**
   de `noitesDe(checkin, checkout)`. Nomes distintos, testes distintos. Reutilizar a
   errada bloqueia um dia a mais ou a menos.
2. **Não sobrescrever reserva** (RN4). A condição da escrita só permite noite livre ou
   pendência vencida.
3. **Limite de 60 noites.** `1 (bloqueio) + 60 (noites)` = 61 itens, dentro dos 100 da
   transação. Um bloqueio de "o ano todo" precisa ser quebrado — a tela deve orientar,
   não falhar com erro técnico.
4. **Motivo nunca vai ao público.** Está em um item que só a `api-admin` lê, e o
   endpoint público de disponibilidade não devolve `tipo` nem `refId`.
5. **Nenhum e-mail.** Bloqueio é operação interna.

## Interface

```
Bloqueios                                    [ + Novo bloqueio ]
┌─────────────────────────────────────────────────────────────┐
│ Casa do Lago                                                 │
│   10 a 15/12/2026   6 noites   Manutenção da bomba      🗑  │
│   24 a 26/12/2026   3 noites   Natal em família          🗑  │
│ Casa da Mata                                                 │
│   01 a 31/07/2027  31 noites   Reforma                   🗑  │
└─────────────────────────────────────────────────────────────┘

Novo bloqueio
┌─────────────────────────────────────────────────────────────┐
│ Casa *      [ Casa do Lago            ▾ ]                   │
│             [ ] Aplicar a todas as casas                     │
│ De *        [ 10/12/2026 ]   Até *  [ 15/12/2026 ]          │
│             → 6 noites bloqueadas (10, 11, 12, 13, 14, 15)  │
│ Motivo *    [ Manutenção da bomba d'água ______________ ]    │
│             (uso interno — não aparece no site)              │
│                                                               │
│ ⚠ Há 1 reserva confirmada em 12/12: Maria Silva.             │
│   [ Ver reserva ]   Cancele-a antes de bloquear.             │
│                                                               │
│                        [ Cancelar ]  [ Bloquear ]            │
└─────────────────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| Contagem de noites | Visível **antes** de confirmar — elimina o erro de convenção |
| Lista das noites | Exibida para períodos curtos; é a confirmação visual |
| Conflito | Verificado ao escolher as datas, não só no envio |
| Conflito | Nomeia as reservas e dá link para elas |
| "Todas as casas" | Cria um bloqueio por casa; mostra o resultado por casa |
| Remover | Confirmação que nomeia casa e datas |
| Agenda | Arrastar sobre dias livres abre este formulário preenchido |
| Mobile | Funciona; é uma operação que o admin faz no sítio, do celular |

> "→ 6 noites bloqueadas (10, 11, 12, 13, 14, 15)" é a melhor defesa contra a confusão
> inclusivo/exclusivo: o admin **vê** exatamente o que vai acontecer.

## Segurança e privacidade

- Rota só para admin autenticado.
- O `motivo` é interno; nunca exposto em endpoint público nem no `.ics`.
- O público não distingue bloqueio de reserva (regra R11 de disponibilidade).
- Nenhum dado pessoal envolvido, exceto o nome do hóspede **na mensagem de conflito**,
  que só o admin vê.
- Log registra `bloqueioId`, `casaId`, datas e `sub` do admin; não registra o motivo.

## Critérios de aceite

- [ ] Bloqueio de 10 a 15 cria **6** noites.
- [ ] Bloqueio de uma única noite funciona.
- [ ] Não sobrescreve reserva `SOLICITADA` nem `CONFIRMADA`.
- [ ] Não sobrescreve evento externo.
- [ ] Sobrescreve noite pendente vencida.
- [ ] O `409` nomeia as reservas em conflito e dá o `reservaId`.
- [ ] Período acima de 60 noites rejeitado com orientação.
- [ ] Motivo obrigatório e ausente de toda saída pública.
- [ ] Criação atômica (falha não deixa bloqueio sem noites nem noites sem bloqueio).
- [ ] Remover libera exatamente as noites deste bloqueio.
- [ ] Remover duas vezes não gera erro.
- [ ] Noite que mudou de dono não é apagada na remoção.
- [ ] Nenhum e-mail é enviado.
- [ ] As datas bloqueadas aparecem indisponíveis no site e no `.ics`.
- [ ] A tela mostra a contagem e a lista de noites antes de confirmar.
- [ ] Erro preserva os dados do formulário.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | 10 a 15/12 | 6 ocupações `BLOQUEIO` |
| 2 | 10 a 10/12 | 1 ocupação |
| 3 | `fim < inicio` | `422` |
| 4 | 1º/01 a 15/03 (74 noites) | `422 MAXIMO_NOITES` |
| 5 | Sobre reserva confirmada | `409` nomeando a reserva |
| 6 | Sobre solicitação pendente válida | `409` |
| 7 | Sobre pendência vencida | `201`; noite sobrescrita |
| 8 | Sobre evento externo | `409` com o canal |
| 9 | Sobre outro bloqueio | `409` ou `noitesIgnoradas`, conforme a opção |
| 10 | Motivo vazio | `400` |
| 11 | Motivo de 300 chars | `400` |
| 12 | Disponibilidade pública após bloquear | Noites ocupadas, sem revelar motivo |
| 13 | `.ics` após bloquear | `VEVENT` com `SUMMARY: Indisponível` |
| 14 | Remover bloqueio | 6 noites liberadas |
| 15 | Remover duas vezes | `200` nas duas |
| 16 | Remover quando 1 noite virou de outra reserva | Bloqueio removido; aquela noite intacta |
| 17 | Transação falha no meio | Nada gravado |
| 18 | "Todas as casas" com 3 casas | 3 bloqueios; resultado por casa |
| 19 | Bloqueio no passado | `201` + aviso |
| 20 | Nenhum e-mail após criar/remover | Confirmado |
| 21 | Invariantes após criar e remover | I1 e I3 válidas |
