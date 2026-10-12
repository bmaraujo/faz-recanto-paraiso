# UC-A07 — Confirmar uma reserva

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; reserva em `SOLICITADA` |
| Gatilho | O admin clica em "Confirmar" no painel ou no detalhe da reserva |
| Fase | 2 |
| Relacionados | [Ciclo de vida](../../01-negocio/03-ciclo-de-vida-da-reserva.md), [05 — Concorrência](../../03-tecnico/05-concorrencia-e-idempotencia.md), [UC-A10](./UC-A10-registrar-pagamento.md), [06 — E-mails](../../03-tecnico/06-emails-e-templates.md) |

## Objetivo de negócio

É o **ato central do negócio**. Como o pagamento acontece fora do site, a confirmação
é uma decisão humana: o proprietário conversou com o hóspede, combinou o valor e a
forma de pagamento, e agora registra o compromisso.

A confirmação faz três coisas de uma vez:

1. **Fixa a ocupação** — as noites deixam de ser pendentes e não expiram mais.
2. **Comunica ao hóspede** — o e-mail `RESERVA_CONFIRMADA` é o "contrato" dele.
3. **Encerra a janela de risco** — ninguém mais pode pedir aquelas datas.

## Fluxo principal

1. O admin vê a solicitação no painel ([UC-A06](./UC-A06-ver-agenda.md)).
2. Conversa com o hóspede pelo WhatsApp e combina valor e pagamento.
3. Clica em **"Confirmar"**.
4. A tela mostra um resumo e campos opcionais:
   - desconto combinado (em reais);
   - observação interna;
   - enviar ou não o e-mail de confirmação (marcado por padrão).
5. Confirma.
6. O servidor:
   1. valida o JWT;
   2. carrega a reserva;
   3. valida a transição `SOLICITADA → CONFIRMADA`;
   4. executa a **transação**: muda o status e remove `pendente`/`expiraEm`/`ttl` de
      cada ocupação;
   5. responde;
   6. envia `RESERVA_CONFIRMADA`.
7. A tela mostra "Reserva confirmada" e a reserva sai da fila de pendentes.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Admin aplica desconto | `descontoCentavos` recalcula o total; o detalhamento ganha a linha de desconto |
| A2 | Admin não quer enviar e-mail agora | Desmarca o envio; pode reenviar depois no detalhe |
| A3 | Admin confirma direto do painel, sem abrir o detalhe | Diálogo compacto com as mesmas opções |
| A4 | Admin confirma e registra o pagamento na sequência | A tela de sucesso oferece "Registrar pagamento" ([UC-A10](./UC-A10-registrar-pagamento.md)) |
| A5 | Admin ajusta datas ou hóspedes antes de confirmar | É **outra** operação (`PUT` da reserva), feita antes; ver [UC-A11](./UC-A11-criar-reserva-manual.md) |
| A6 | Admin confirma sem ter recebido nada | Permitido; `pagamento.situacao` fica `NAO_REGISTRADO` |

> A6 é deliberado: a decisão de confiar antes de receber é do proprietário, não do
> sistema. Forçar o registro de pagamento para confirmar engessaria o negócio real
> (onde às vezes se confirma por telefone e o Pix chega no dia seguinte).

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Reserva já `CONFIRMADA` | `409 TRANSICAO_INVALIDA` | "Esta reserva já foi confirmada em 11/10 às 15h30." A tela atualiza |
| E2 | Reserva `EXPIRADA`, **noites ainda livres** | `409` | "Esta solicitação expirou. Quer criar uma reserva com estas datas?" → leva a [UC-A11](./UC-A11-criar-reserva-manual.md) com os dados preenchidos |
| E3 | Reserva `EXPIRADA`, **noites tomadas por outra** | `409 DATAS_INDISPONIVEIS` | "Esta solicitação expirou e as datas foram tomadas pela reserva de João Souza. Veja a agenda." + link |
| E4 | Reserva `RECUSADA` ou `CANCELADA` | `409` | Tela atualiza para o estado real |
| E5 | Expirou **durante** o clique (corrida com o cron) | `409` | Mesmo tratamento de E2/E3 |
| E6 | Dois cliques no botão | 1 sucesso, 1 `409` | O segundo clique mostra "já confirmada"; **um único e-mail** |
| E7 | Falha no envio do e-mail | `200` | "Reserva confirmada. O e-mail não pôde ser enviado agora e será reenviado automaticamente." + botão de reenviar |
| E8 | Desconto maior que o subtotal | `422` | "O desconto não pode ser maior que o valor das diárias." |
| E9 | Falha de rede | — | "Não conseguimos confirmar." + Tentar novamente. A ação **não** é repetida automaticamente |
| E10 | Sessão expirada | `401` | Renova e reenvia a ação uma vez |

> **E3 é o cenário mais delicado do sistema.** A condição `refId = :reservaId` em cada
> ocupação é o que impede a confirmação de **roubar** a noite de outra reserva. Sem
> ela, o admin confirmaria uma solicitação expirada e criaria overbooking silencioso.
>
> **E9 é importante:** nunca retentar automaticamente uma ação de escrita depois de
> timeout. A requisição pode ter sido processada e a resposta se perdido; retentar
> poderia duplicar efeitos. A condição no status protege, mas a regra geral é deixar a
> decisão ao humano.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Só `SOLICITADA → CONFIRMADA` |
| RN2 | A transação remove `pendente`, `expiraEm` e `ttl` de **todas** as ocupações |
| RN3 | Cada ocupação é atualizada com condição `refId = :reservaId` |
| RN4 | A reserva é atualizada com condição `status = SOLICITADA` |
| RN5 | Registra `confirmadaEm`, `confirmadaPor` e a entrada no `historico` |
| RN6 | O desconto é opcional e nunca deixa o total abaixo da taxa de limpeza |
| RN7 | Envia `RESERVA_CONFIRMADA` ao hóspede (a menos que o admin desmarque) |
| RN8 | Falha de e-mail **não** invalida a confirmação |
| RN9 | A reserva deixa de ter prazo — não expira mais |
| RN10 | O contador antiabuso do e-mail é decrementado |
| RN11 | `pagamento.situacao` continua `NAO_REGISTRADO` até o admin registrar |
| RN12 | A confirmação é idempotente do ponto de vista do efeito: a segunda chamada falha, mas o estado final é correto e **não** há segundo e-mail |

## Contrato técnico

### `POST /api/admin/reservas/{reservaId}/confirmar`

```json
{
  "descontoCentavos": 0,
  "observacaoInterna": "Combinado 50% no Pix hoje",
  "enviarEmail": true
}
```

| Campo | Validação |
|---|---|
| `descontoCentavos` | opcional, inteiro ≥ 0, ≤ subtotal de diárias |
| `observacaoInterna` | opcional, ≤ 500 chars |
| `enviarEmail` | booleano, padrão `true` |

Resposta `200`:

```json
{
  "reserva": { "status": "CONFIRMADA", "confirmadaEm": "...", "valores": { } },
  "emailEnviado": true,
  "avisoEmail": null,
  "proximosPassos": ["REGISTRAR_PAGAMENTO"]
}
```

Com falha de e-mail:

```json
{
  "reserva": { "status": "CONFIRMADA" },
  "emailEnviado": false,
  "avisoEmail": "O e-mail de confirmação não pôde ser enviado agora. Ele será reenviado automaticamente."
}
```

### Erros

| Código | HTTP | `detalhes` |
|---|---|---|
| `NAO_AUTENTICADO` | 401 | — |
| `NAO_ENCONTRADO` | 404 | — |
| `TRANSICAO_INVALIDA` | 409 | `statusAtual`, `confirmadaEm` se aplicável |
| `DATAS_INDISPONIVEIS` | 409 | `noitesIndisponiveis[]`, `reservaConflitante` |
| `ENTRADA_INVALIDA` | 400 | `campos[]` |
| `DESCONTO_INVALIDO` | 422 | `subtotalDiariasCentavos` |

## Implementação

### A transação

```ts
const itens = [
  {
    Update: {
      Key: { PK: `RESERVA#${reservaId}`, SK: "META" },
      UpdateExpression:
        "SET #s = :confirmada, confirmadaEm = :agora, confirmadaPor = :quem, " +
        "valores = :valores, atualizadoEm = :agora, " +
        "#h = list_append(if_not_exists(#h, :vazio), :entrada) " +
        "REMOVE expiraEm, #ttl",
      ConditionExpression: "#s = :solicitada",
      ExpressionAttributeNames: { "#s": "status", "#h": "historico", "#ttl": "ttl" },
      // ...
    },
  },
  ...reserva.noites.map((data) => ({
    Update: {
      Key: { PK: `OCUPACAO#${reserva.casaId}`, SK: `NOITE#${data}` },
      UpdateExpression: "REMOVE pendente, expiraEm, #ttl",
      ConditionExpression: "refId = :reservaId",       // ← impede roubar a noite
      // ...
    },
  })),
  // decremento do contador antiabuso
];
```

Tamanho: `1 + N + 1` itens, com `N <= 60` — dentro do limite de 100.

### Tratando `TransactionCanceledException`

```
reason[0] falhou                      → a reserva não está mais SOLICITADA
                                        → reler e devolver 409 TRANSICAO_INVALIDA
reason[i], 1 <= i <= N                → uma noite pertence a outra reserva
                                        → carregar a reserva conflitante e devolver
                                          409 DATAS_INDISPONIVEIS com o nome dela
TransactionConflict                   → retentar até 2 vezes com backoff
```

A mensagem de E3 precisa do **nome do hóspede da reserva conflitante** — buscar o
`refId` da noite que falhou e carregar aquela reserva. É esse detalhe que transforma
um erro técnico em informação acionável.

### E-mail (fora da transação)

```ts
await responder(200, resultado);   // conceitualmente: a resposta vem primeiro
try {
  if (corpo.enviarEmail !== false) {
    await enviarEmail("RESERVA_CONFIRMADA", reservaId);   // timeout 5 s
    resultado.emailEnviado = true;
  }
} catch (e) {
  registrarFalhaEmail(reservaId, "RESERVA_CONFIRMADA", e);
  await gerarAlertaAdmin(...);
  resultado.emailEnviado = false;
  resultado.avisoEmail = "...";
}
```

Na Lambda não há como responder antes de terminar o handler, então na prática a ordem é:
commitar a transação → tentar o e-mail com timeout curto → responder com o resultado do
envio. O essencial é que **a falha do e-mail nunca propague** para o status HTTP.

### Armadilhas

1. **A condição `refId = :reservaId`** em cada noite é obrigatória (E3).
2. **A condição `status = SOLICITADA`** na reserva protege de duplo clique e da corrida
   com o cron.
3. **`list_append` com `if_not_exists`** para o histórico — sem o `if_not_exists`, a
   primeira entrada falha em reserva criada antes do campo existir.
4. **Decrementar o contador antiabuso** (RN10). Esquecer bloqueia o hóspede de pedir
   outra reserva.
5. **`emailsEnviados` só depois do sucesso do SES**, nunca antes.
6. **Não retentar automaticamente após timeout** (E9).
7. **Recalcular `valores` com o desconto** antes de gravar, e manter a invariante
   "soma do detalhamento = total" incluindo a linha de desconto.

## Interface

```
┌────────────────────────────────────────────────────────┐
│  Confirmar reserva                                      │
│                                                          │
│  Casa do Lago                                            │
│  Maria Silva · (11) 99999-9999 · maria@exemplo.com       │
│  20 a 23/11/2026 · 3 noites · 7 hóspedes                 │
│                                                          │
│  Valor estimado                        R$ 2.200,00       │
│  Desconto combinado (opcional)  R$ [      0,00 ]         │
│  ─────────────────────────────────────────────           │
│  Valor combinado                       R$ 2.200,00       │
│                                                          │
│  Observação interna (opcional)                           │
│  [ Combinado 50% no Pix hoje ___________________ ]       │
│                                                          │
│  [x] Enviar e-mail de confirmação para o hóspede         │
│                                                          │
│  ⓘ Ao confirmar, as datas ficam reservadas de forma      │
│    definitiva e deixam de expirar.                       │
│                                                          │
│              [ Voltar ]  [ Confirmar reserva ]           │
└────────────────────────────────────────────────────────┘
```

| Estado | Comportamento |
|---|---|
| Diálogo | Foco em "Voltar" (ação não destrutiva primeiro) |
| Enviando | Botão desabilitado com "Confirmando..."; **sem timeout visual infinito** |
| Sucesso | "Reserva confirmada ✓" + atalhos: registrar pagamento, enviar WhatsApp, ver reserva |
| Sucesso com falha de e-mail | Faixa amarela com o aviso e botão "Reenviar e-mail" |
| `409` | Fecha o diálogo, recarrega a reserva e explica o estado real |
| `409` de datas tomadas | Mensagem com o nome da outra reserva e link para a agenda |
| Falha de rede | Mensagem no diálogo + Tentar novamente; diálogo permanece aberto |

> O resumo com nome, telefone e datas dentro do diálogo é intencional: o admin confirma
> olhando os dados, não a memória. Um "Confirmar?" genérico levaria a confirmar a
> reserva errada no meio de uma fila de pendentes.

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin`; verificado antes de qualquer leitura |
| Integridade | Escrita condicional em status e em `refId` de cada noite |
| `observacaoInterna` | Nunca sai no e-mail nem em endpoint público |
| Log | `reservaId`, estado anterior e novo, `sub` do admin. **Nunca** nome, e-mail, telefone ou valores |
| E-mail | O conteúdo é renderizado de template com escape ([06 — E-mails](../../03-tecnico/06-emails-e-templates.md)) |
| Auditoria | `historico` guarda quem confirmou e quando |

## Critérios de aceite

- [ ] `SOLICITADA → CONFIRMADA` funciona e remove a pendência de todas as noites.
- [ ] A reserva confirmada **não** expira mais.
- [ ] Reserva já confirmada retorna `409` com a data da confirmação original.
- [ ] Reserva expirada com noites livres retorna `409` e oferece criar reserva manual.
- [ ] Reserva expirada com noites tomadas retorna `409` **nomeando a outra reserva**.
- [ ] A noite de outra reserva **nunca** é alterada.
- [ ] Dois cliques: 1 sucesso, 1 `409`, **um** e-mail.
- [ ] Desconto maior que o subtotal retorna `422`.
- [ ] Com desconto, a soma do detalhamento continua igual ao total.
- [ ] O e-mail `RESERVA_CONFIRMADA` é enviado.
- [ ] Falha de e-mail mantém a confirmação e informa na tela.
- [ ] `enviarEmail: false` não envia.
- [ ] Contador antiabuso decrementado.
- [ ] `historico` registra quem confirmou e quando.
- [ ] Nenhum dado pessoal em log.
- [ ] Timeout de rede não retenta automaticamente.
- [ ] A reserva sai da fila de pendentes do painel.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Confirmar `SOLICITADA` | `200`; 3 ocupações sem `pendente` |
| 2 | Confirmar duas vezes | `200` + `409`; 1 e-mail |
| 3 | Confirmar `CONFIRMADA` | `409` com `confirmadaEm` |
| 4 | Confirmar `RECUSADA` | `409` |
| 5 | Confirmar `EXPIRADA`, noites livres | `409` com sugestão de reserva manual |
| 6 | Confirmar `EXPIRADA`, noites de outra reserva | `409 DATAS_INDISPONIVEIS` com o nome |
| 7 | Noite de outra reserva após a tentativa | **Intacta** |
| 8 | Confirmar e expirar simultaneamente | Um vence; estado final coerente |
| 9 | Desconto de R$ 200,00 | Total R$ 2.000,00; detalhamento com a linha |
| 10 | Desconto maior que o subtotal | `422` |
| 11 | Desconto negativo | `400` |
| 12 | SES falha | `200`, `emailEnviado: false`, `ALERTA_ADMIN` |
| 13 | `enviarEmail: false` | Nenhum e-mail; `emailsEnviados` sem o código |
| 14 | Reenviar manualmente depois | Enviado; `historicoEnvios` com 1 entrada manual |
| 15 | Contador antiabuso antes/depois | Decrementado |
| 16 | Sem JWT | `401` |
| 17 | JWT sem grupo admin | `403` |
| 18 | Log da operação | Sem nome, e-mail, telefone ou valor |
| 19 | `historico` após confirmar | Entrada com `para: CONFIRMADA` e o e-mail do admin |
| 20 | Invariantes após confirmar | I2 e I5 válidas |
| 21 | Disponibilidade pública após confirmar | Noites continuam ocupadas |
| 22 | `.ics` após confirmar | Reserva presente |
