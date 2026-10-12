# UC-A11 — Criar reserva manual

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; casa existente; datas disponíveis |
| Gatilho | O admin fecha uma reserva por WhatsApp/telefone e a registra em `/admin/reservas/nova` |
| Fase | 3 |
| Relacionados | [UC-P04](../publico/UC-P04-solicitar-reserva.md), [UC-A07](./UC-A07-confirmar-reserva.md), [05 — Concorrência](../../03-tecnico/05-concorrencia-e-idempotencia.md) |

## Objetivo de negócio

A maioria das reservas vai continuar sendo fechada **por WhatsApp**. Se essas reservas
não entrarem no sistema, a agenda fica errada, o calendário público mostra datas que
não existem e o `.ics` não protege contra overbooking — ou seja, o sistema inteiro
perde a utilidade.

Esta é a tela que garante que **a agenda reflete a realidade**, não apenas o que passou
pelo formulário do site.

Diferença essencial em relação à solicitação do site: a reserva manual nasce
**`CONFIRMADA`**. O admin já negociou; não há nada a decidir depois.

## Fluxo principal

1. O admin abre `/admin/reservas/nova`.
2. Escolhe a casa.
3. Escolhe as datas em um calendário que já mostra as ocupações daquela casa.
4. Informa o número de hóspedes.
5. A cotação é calculada automaticamente, e o admin pode **sobrescrever o valor
   combinado** (foi negociado por fora).
6. Informa nome, telefone e, opcionalmente, e-mail.
7. Escolhe se envia o e-mail de confirmação (só se houver e-mail).
8. Confirma.
9. O servidor cria a reserva `CONFIRMADA` e ocupa as noites de forma firme, em uma
   transação.
10. Se houver e-mail e o admin pediu, envia `RESERVA_CONFIRMADA`.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Hóspede sem e-mail | Campo opcional; nenhum e-mail é enviado; a reserva funciona normalmente |
| A2 | Valor diferente da tabela | O admin sobrescreve `totalCentavos`; o detalhamento ganha a linha "Valor combinado" |
| A3 | Reserva veio do Airbnb/Booking manualmente | Campo `canal` com `SITE`/`WHATSAPP`/`AIRBNB`/`BOOKING`/`INDICACAO`/`OUTRO` |
| A4 | Vindo de uma solicitação expirada | Pré-preenchido com os dados dela ([UC-A07](./UC-A07-confirmar-reserva.md) E2) |
| A5 | Admin registra uma reserva passada | Permitido; nasce `CONCLUIDA` se o check-out já passou |
| A6 | Admin registra o pagamento na sequência | A tela de sucesso oferece [UC-A10](./UC-A10-registrar-pagamento.md) |
| A7 | Admin edita uma reserva existente | `PUT /api/admin/reservas/{id}` — ver "Editar" abaixo |
| A8 | Admin cria como `SOLICITADA` | Possível via `status`, para o caso de negociação em andamento por fora |

> A5 importa para a adoção: o proprietário vai querer lançar o histórico recente ao
> começar a usar o sistema. Bloquear datas passadas o obrigaria a deixar o histórico
> de fora, e o relatório nasceria errado.

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Datas já ocupadas | `409 DATAS_INDISPONIVEIS` | "12/12 já está ocupado pela reserva de João Souza." + link. Calendário atualizado |
| E2 | Nome vazio | `400` | Campo marcado |
| E3 | Telefone e e-mail ambos vazios | `422 CONTATO_OBRIGATORIO` | "Informe pelo menos telefone ou e-mail." |
| E4 | Hóspedes acima da capacidade | `422` | Campo limitado, com a capacidade |
| E5 | `checkout <= checkin` | `422` | Campos marcados |
| E6 | Estadia acima de 60 noites | `422` | "Máximo de 60 noites por reserva." |
| E7 | Valor combinado negativo | `422` | Campo marcado |
| E8 | Casa inexistente | `404` | — |
| E9 | Enviar e-mail sem e-mail informado | `422` | "Informe o e-mail para enviar a confirmação." |
| E10 | Falha no e-mail | `201` | "Reserva criada. O e-mail não pôde ser enviado." + reenviar |
| E11 | Falha de rede | — | Mensagem + Tentar novamente; **dados preservados** |
| E12 | Corrida com uma solicitação do site | `409` | A transação garante que só uma passa |

> **E3 é a diferença em relação ao formulário público:** lá o e-mail é obrigatório
> (é o canal de comunicação e o portador do token). Aqui o contato pode ser **só o
> telefone**, porque é como muita gente fecha reserva de verdade. O que não pode é
> ficar sem nenhum meio de contato.
>
> Reserva sem e-mail **não recebe nenhum e-mail automático** — nem confirmação, nem
> pré-check-in. A tela avisa isso claramente, para o admin decidir.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | A reserva nasce `CONFIRMADA`, com `origem = MANUAL` |
| RN2 | Se o check-out já passou, nasce `CONCLUIDA` |
| RN3 | As noites são ocupadas **sem** `pendente` e **sem** `expiraEm` |
| RN4 | `tokenAcesso` é gerado (permite enviar o link mesmo em reserva manual) |
| RN5 | Ao menos um de telefone ou e-mail é obrigatório |
| RN6 | E-mail, quando informado, é validado e normalizado |
| RN7 | A cotação é calculada, mas o `totalCentavos` pode ser sobrescrito |
| RN8 | Quando sobrescrito, o detalhamento recebe a linha "Valor combinado" e a invariante soma = total continua válida |
| RN9 | `canal` registra a origem comercial |
| RN10 | A transação é a mesma de [UC-P04](../publico/UC-P04-solicitar-reserva.md), sem pendência |
| RN11 | Datas passadas são permitidas |
| RN12 | Nenhum limite antiabuso se aplica (é o admin) |
| RN13 | O e-mail de confirmação é opcional e só possível com e-mail informado |
| RN14 | Registra `criadoPor` e a entrada no `historico` |
| RN15 | Máximo de 60 noites (limite da transação) |

### Como a sobrescrita de valor preserva a invariante (RN8)

A invariante "soma do detalhamento = total" vale para todo o sistema
([I7](../../01-negocio/03-ciclo-de-vida-da-reserva.md#invariantes-do-sistema)).
Com valor sobrescrito, o detalhamento passa a ser:

```json
{
  "totalCentavos": 200000,
  "detalhamento": [
    { "tipo": "VALOR_COMBINADO", "rotulo": "Valor combinado com o hóspede",
      "valorCentavos": 200000, "observacao": "Tabela: R$ 2.200,00" }
  ],
  "cotacaoTabela": { "totalCentavos": 220000, "detalhamento": [] }
}
```

O detalhamento da tabela fica preservado em `cotacaoTabela`, para o relatório poder
comparar o combinado com o tabelado — informação comercial útil.

## Contrato técnico

### `POST /api/admin/reservas`

```json
{
  "casaId": "01HQ...",
  "checkin": "2026-12-20",
  "checkout": "2026-12-23",
  "hospedes": 6,
  "hospede": {
    "nome": "João Souza",
    "telefone": "(11) 98888-8888",
    "email": "joao@exemplo.com"
  },
  "canal": "WHATSAPP",
  "totalCentavosCombinado": 200000,
  "observacaoInterna": "Cliente recorrente, desconto de 10%",
  "status": "CONFIRMADA",
  "enviarEmail": true
}
```

| Campo | Validação |
|---|---|
| `casaId` | ULID existente |
| `checkin`, `checkout` | `YYYY-MM-DD`, `checkout > checkin`, ≤ 60 noites |
| `hospedes` | inteiro, 1 a `capacidadeMaxima` |
| `hospede.nome` | **obrigatório**, 3–100 chars |
| `hospede.telefone` | opcional; normalizável para E.164 |
| `hospede.email` | opcional; formato válido |
| — | ao menos um de telefone/e-mail (RN5) |
| `canal` | `SITE`\|`WHATSAPP`\|`AIRBNB`\|`BOOKING`\|`INDICACAO`\|`OUTRO` |
| `totalCentavosCombinado` | opcional, inteiro ≥ 0 |
| `observacaoInterna` | opcional, ≤ 500 chars |
| `status` | `CONFIRMADA` (padrão) \| `SOLICITADA` |
| `enviarEmail` | booleano, padrão `false`; exige e-mail |

> `enviarEmail` tem padrão `false` aqui, ao contrário de
> [UC-A07](./UC-A07-confirmar-reserva.md): o admin acabou de falar com a pessoa no
> WhatsApp, e o e-mail nem sempre faz sentido.

Resposta `201`: a reserva criada, mais `linkAcompanhamento`, `whatsappLink`,
`emailEnviado` e `proximosPassos: ["REGISTRAR_PAGAMENTO"]`.

### `PUT /api/admin/reservas/{reservaId}`

Edita uma reserva existente. Regras adicionais:

| Campo | Pode mudar? |
|---|---|
| `hospede`, `observacaoInterna`, `canal`, `totalCentavosCombinado` | **Sim**, livremente |
| `hospedes` | Sim, respeitando a capacidade |
| `checkin`, `checkout` | **Sim**, mas exige realocar as noites (ver abaixo) |
| `casaId` | **Não.** Mudar de casa = cancelar e criar outra |
| `status` | **Não** por aqui; use as rotas de transição |

#### Mudança de datas em reserva existente

A operação mais delicada deste UC. Em **uma** transação:

```
noitesAtuais   = [checkin antigo, checkout antigo)
noitesNovas    = [checkin novo,   checkout novo)
aLiberar       = noitesAtuais − noitesNovas
aOcupar        = noitesNovas − noitesAtuais
manter         = interseção (nada a fazer)

TransactWriteItems:
  Update da reserva (datas, noites, valores)   ConditionExpression: versao = :lida
  Delete de cada noite em `aLiberar`           ConditionExpression: refId = :reservaId
  Put    de cada noite em `aOcupar`            ConditionExpression: attribute_not_exists(PK)
                                                   OR (pendente = :v AND expiraEm < :agora)
```

Atômico: ou a reserva muda de datas por completo, ou nada muda. Nunca libere antes e
ocupe depois em chamadas separadas — a janela entre as duas permite que outra pessoa
pegue a nova data e a reserva fique sem noites.

Se a ocupação falhar → `409 DATAS_INDISPONIVEIS` e **as datas antigas permanecem**.

### Erros

| Código | HTTP | `detalhes` |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | `campos[]` |
| `CONTATO_OBRIGATORIO` | 422 | — |
| `NAO_ENCONTRADO` | 404 | — |
| `DATAS_INDISPONIVEIS` | 409 | `conflitos[]` com `reservaId` e nome |
| `CAPACIDADE_EXCEDIDA` | 422 | `capacidadeMaxima` |
| `MAXIMO_NOITES` | 422 | — |
| `CASA_IMUTAVEL` | 422 | — |
| `CONFLITO_VERSAO` | 409 | — |

## Implementação

### Criação (transação)

Igual à de [UC-P04](../publico/UC-P04-solicitar-reserva.md), com três diferenças:

| | Site | Manual |
|---|---|---|
| `status` | `SOLICITADA` | `CONFIRMADA` |
| Ocupações | `pendente: true` + `expiraEm` + `ttl` | **nenhum** dos três |
| Condição da noite | livre OU pendência vencida | **a mesma** |
| Antiabuso | incrementa | não participa |

A condição da noite ser a mesma é o que garante que uma reserva manual não atropela uma
solicitação do site válida. O admin **vê** o conflito e decide
([UC-A08](./UC-A08-recusar-ou-cancelar-reserva.md) se quiser recusar a solicitação).

### Armadilhas

1. **Não criar ocupação pendente** (RN3). Uma reserva manual com `expiraEm` seria
   expirada pelo cron.
2. **Mudança de datas em uma transação** — ver acima. É o bug de maior impacto possível
   neste UC.
3. **Não permitir trocar de casa** (`CASA_IMUTAVEL`). Seria liberar N noites de uma
   casa e ocupar N de outra, com a reserva no meio — tecnicamente possível, mas o
   caminho correto é cancelar e criar.
4. **Reserva sem e-mail**: todo o fluxo de e-mail precisa tolerar `email` ausente, sem
   lançar exceção. Testar o `cron-diario` com uma reserva assim.
5. **`tokenAcesso` mesmo sem e-mail** (RN4): o admin pode mandar o link por WhatsApp.
6. **Invariante com valor sobrescrito** (RN8).
7. **Datas passadas** (RN11/RN2): calcular o `status` inicial a partir da data de hoje.

## Interface

```
Nova reserva                                       [ Cancelar ]
┌───────────────────────────────────────────────────────────────┐
│ Casa *     [ Casa do Lago                    ▾ ]              │
│                                                                │
│ Dezembro 2026                                                  │
│  D  S  T  Q  Q  S  S                                           │
│        1  2  3  4  5      ▓ ocupado   ▒ aguardando            │
│  6  7  8  9 10 11 12      selecione as datas                   │
│ 13 14 15 16 17 18 19                                           │
│ 20 21 22 23 ▓▓ 26                                              │
│                                                                │
│ Check-in  20/12/2026   Check-out  23/12/2026   → 3 noites     │
│ Hóspedes  [ 6 ]  (até 8)                                       │
│                                                                │
│ VALOR                                                          │
│  Pela tabela                      R$ 2.200,00                  │
│  [x] Valor combinado diferente                                 │
│      Valor combinado         R$ [ 2.000,00 ]                   │
│                                                                │
│ HÓSPEDE                                                        │
│  Nome *          [ João Souza ______________ ]                 │
│  WhatsApp        [ (11) 98888-8888 _________ ]                 │
│  E-mail          [ joao@exemplo.com ________ ]                 │
│  ⓘ Informe telefone ou e-mail. Sem e-mail, o hóspede não      │
│    recebe confirmação nem instruções de chegada.              │
│                                                                │
│ Canal *          [ WhatsApp                  ▾ ]               │
│ Observação interna [ Cliente recorrente ______ ]               │
│                                                                │
│ [ ] Enviar e-mail de confirmação                               │
│                                                                │
│                              [ Criar reserva confirmada ]      │
└───────────────────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| Calendário com as ocupações da casa | Evita o `409` antes de acontecer |
| Noites calculadas na tela | Elimina a confusão de check-out |
| Valor da tabela sempre visível | Mesmo quando sobrescrito, para comparar |
| Aviso sobre reserva sem e-mail | O admin decide informado |
| Botão nomeia o resultado | "Criar reserva confirmada", não "Salvar" |
| Conflito | Mostrado no calendário **e** no erro, com link para a outra reserva |
| Rascunho | `localStorage`; reserva perdida por sessão expirada é inaceitável |
| Mobile | Funciona: o admin fecha reserva no WhatsApp, pelo celular |

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` |
| Integridade | A mesma transação condicional do fluxo público |
| Dados pessoais | Mínimos: nome + um contato |
| `observacaoInterna` | Nunca em e-mail nem em endpoint público |
| `tokenAcesso` | Gerado; exibido só ao admin |
| Log | `reservaId`, `casaId`, datas, `canal`, `sub`. **Nunca** nome, contato ou valores |
| Auditoria | `historico` com `criadoPor` |
| LGPD | O admin coleta o dado de terceiro; a base legal é a mesma (execução de contrato) |

## Critérios de aceite

- [ ] Reserva manual nasce `CONFIRMADA` com `origem = MANUAL`.
- [ ] As noites são ocupadas **sem** `pendente`, `expiraEm` ou `ttl`.
- [ ] Datas ocupadas retornam `409` nomeando a reserva em conflito.
- [ ] Reserva manual **não** atropela solicitação do site válida.
- [ ] Nome obrigatório; telefone **ou** e-mail obrigatório.
- [ ] Sem e-mail, a reserva funciona e nenhum e-mail é tentado.
- [ ] Valor combinado sobrescreve o da tabela.
- [ ] Com valor sobrescrito, soma do detalhamento = total.
- [ ] `cotacaoTabela` preservada para comparação.
- [ ] Check-out no passado nasce `CONCLUIDA`.
- [ ] Estadia acima de 60 noites retorna `422`.
- [ ] Mudança de datas é atômica: falha mantém as datas antigas.
- [ ] Trocar de casa retorna `422 CASA_IMUTAVEL`.
- [ ] `tokenAcesso` gerado mesmo sem e-mail.
- [ ] `canal` registrado e usado no relatório.
- [ ] `cron-diario` não quebra com reserva sem e-mail.
- [ ] Rascunho preservado após falha de sessão.
- [ ] Nenhum dado pessoal em log.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Criar reserva válida | `201`; `CONFIRMADA`; 3 ocupações firmes |
| 2 | Ocupações criadas | Sem `pendente`, `expiraEm` ou `ttl` |
| 3 | Datas de reserva confirmada existente | `409` com o nome |
| 4 | Datas de solicitação pendente válida | `409` |
| 5 | Datas de pendência vencida | `201` |
| 6 | Só telefone | `201` |
| 7 | Só e-mail | `201` |
| 8 | Nem telefone nem e-mail | `422 CONTATO_OBRIGATORIO` |
| 9 | Nome vazio | `400` |
| 10 | Hóspedes 10 com capacidade 8 | `422` |
| 11 | `checkout == checkin` | `422` |
| 12 | 61 noites | `422` |
| 13 | Valor combinado R$ 2.000,00 | Total 200000; detalhamento com `VALOR_COMBINADO` |
| 14 | Soma do detalhamento com valor sobrescrito | Igual ao total |
| 15 | `cotacaoTabela` | Preservada com o valor de tabela |
| 16 | Check-out ontem | `CONCLUIDA` |
| 17 | Check-in daqui a 6 meses | `CONFIRMADA` |
| 18 | `enviarEmail: true` sem e-mail | `422` |
| 19 | `enviarEmail: true` com e-mail | E-mail enviado |
| 20 | Padrão de `enviarEmail` | `false`; nenhum e-mail |
| 21 | SES falha | `201`, `emailEnviado: false` |
| 22 | Mudar datas para período livre | `200`; noites antigas liberadas, novas ocupadas |
| 23 | Mudar datas para período ocupado | `409`; **datas antigas intactas** |
| 24 | Mudar datas com sobreposição parcial | Só o delta é alterado |
| 25 | Tentar mudar `casaId` | `422` |
| 26 | Criar com `status: SOLICITADA` | `201` com pendência e prazo |
| 27 | Reserva sem e-mail no `cron-diario` | Nenhuma exceção |
| 28 | Reserva manual simultânea a uma solicitação do site | Exatamente uma passa |
| 29 | Log da criação | Sem nome, contato ou valores |
| 30 | Invariantes após criar | I1, I2 e I5 válidas |
