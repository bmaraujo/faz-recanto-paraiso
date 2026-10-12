# UC-A10 — Registrar pagamento recebido fora do site

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; reserva em `CONFIRMADA` ou `CONCLUIDA` |
| Gatilho | O admin recebe o valor (Pix, transferência, dinheiro) e registra no detalhe da reserva |
| Fase | 3 |
| Relacionados | [ADR-003](../../adr/ADR-003-pagamento-fora-do-site.md), [Ciclo de vida](../../01-negocio/03-ciclo-de-vida-da-reserva.md), [UC-A15](./UC-A15-relatorio-ocupacao.md), [LGPD](../../05-conformidade/02-lgpd.md) |

## Objetivo de negócio

O site **não processa pagamentos**. Mas o proprietário precisa saber, olhando a
reserva: **já recebi?** É a informação que ele hoje guarda na cabeça ou no caderno e
que gera o erro mais caro do dia a dia — cobrar duas vezes, ou não cobrar.

Este é um **registro de controle interno**, não um sistema financeiro:

| O que é | O que **não** é |
|---|---|
| Anotação de "recebi tanto, por tal meio, em tal data" | Contabilidade |
| Base para o relatório de receita | Nota fiscal |
| Sinal visual no painel ("50% pago") | Conciliação bancária |
| Histórico de lançamentos da reserva | Cobrança automática |

Essa fronteira precisa estar escrita **na tela**, não só aqui: o proprietário não pode
usar isso como se fosse contabilidade.

## Fluxo principal

1. O admin abre o detalhe de uma reserva `CONFIRMADA`.
2. Vê o bloco "Pagamento" com o total combinado e o que já foi registrado.
3. Clica em **"Registrar recebimento"**.
4. Informa:
   - valor recebido (em reais);
   - meio (lista sugerida + texto livre);
   - data do recebimento (padrão: hoje);
   - observação opcional.
5. Confirma.
6. O servidor acrescenta um **lançamento** à lista e recalcula o total recebido e a
   `situacao`.
7. O painel e a lista de reservas passam a mostrar a situação atualizada.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Pagamento em duas parcelas | Dois lançamentos; `situacao` vai de `PARCIAL` a `TOTAL` |
| A2 | Admin corrige um lançamento errado | Edita o lançamento pelo `lancamentoId` |
| A3 | Admin remove um lançamento | Exclusão com confirmação; os totais são recalculados |
| A4 | Registro em reserva `CONCLUIDA` | Permitido (pagamento atrasado) |
| A5 | Valor recebido acima do total | Permitido **com confirmação explícita**; `situacao` fica `TOTAL` e um aviso marca a diferença |
| A6 | Devolução após cancelamento | Registrada em [UC-A08](./UC-A08-recusar-ou-cancelar-reserva.md), como `valorDevolvidoCentavos` |
| A7 | Admin só quer marcar "pago" sem detalhar | Atalho "Marcar como pago integralmente": cria um lançamento com o valor total e meio "não informado" |

> A7 existe porque o atrito importa: se registrar exigir quatro campos, o admin não
> registra, e o recurso morre. O atalho cobre o caso mais comum em um clique.

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Reserva `SOLICITADA` | `409 TRANSICAO_INVALIDA` | "Confirme a reserva antes de registrar o pagamento." |
| E2 | Reserva `RECUSADA`/`EXPIRADA` | `409` | "Esta reserva não está ativa." |
| E3 | Reserva `CANCELADA` | `409` | "Reserva cancelada. Registre a devolução na tela de cancelamento." |
| E4 | Valor zero ou negativo | `422 VALOR_INVALIDO` | Campo marcado |
| E5 | Valor acima do total **sem** confirmação | `422 VALOR_EXCEDE_TOTAL` | "R$ 2.500,00 é maior que o total de R$ 2.200,00. Confirme se está correto." |
| E6 | Data do recebimento no futuro | `422` | "A data não pode ser no futuro." |
| E7 | Data mais de 2 anos no passado | `422` | Provável erro de digitação |
| E8 | Excluir lançamento inexistente | `404` | Lista recarregada |
| E9 | Falha de rede | — | Mensagem + Tentar novamente; dados preservados |
| E10 | Dois registros simultâneos (duas abas) | `409 CONFLITO_VERSAO` | "Esta reserva foi alterada. Recarregue." |

> **E1 é a regra de consistência:** `pagamento` só existe em reserva com compromisso
> assumido. Registrar recebimento de uma solicitação não confirmada deixaria o sistema
> em um estado que não significa nada — e permitiria "pago mas não reservado", que é a
> pior combinação possível.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Só reservas `CONFIRMADA` ou `CONCLUIDA` aceitam registro |
| RN2 | O pagamento é uma **lista de lançamentos**, não um campo único |
| RN3 | `valorRecebidoCentavos` = soma dos lançamentos |
| RN4 | `situacao` é **derivada**: `NAO_REGISTRADO` (lista vazia), `PARCIAL` (0 < soma < total), `TOTAL` (soma ≥ total) |
| RN5 | Valores em centavos inteiros |
| RN6 | O meio é texto livre, com sugestões — **nunca** dados do instrumento de pagamento |
| RN7 | A data do recebimento não pode ser futura nem mais de 2 anos no passado |
| RN8 | Valor acima do total exige confirmação explícita |
| RN9 | Cada lançamento registra quem e quando o criou |
| RN10 | Lançamentos podem ser editados e excluídos, com registro no `historico` |
| RN11 | `pagamento` **nunca** aparece em endpoint público |
| RN12 | Valores **nunca** aparecem em log associados a pessoa identificável |
| RN13 | Nenhum e-mail é disparado por este UC |
| RN14 | O relatório usa a soma dos lançamentos como "receita registrada" |
| RN15 | A tela deixa claro que **não é contabilidade** |

> RN2 — lista em vez de campo único — é o que permite "metade na reserva, metade no
> check-in", que é como o negócio funciona de verdade. Um campo único forçaria o admin
> a sobrescrever e perder o histórico.
>
> RN6 é regra de segurança: **nunca** registrar número de cartão, chave Pix, conta
> bancária ou comprovante. O campo é `"Pix"`, não `"Pix 11999999999"`. A tela precisa
> avisar e a validação precisa rejeitar padrões que pareçam cartão ou CPF.

## Contrato técnico

### `POST /api/admin/reservas/{reservaId}/pagamento`

```json
{
  "valorCentavos": 110000,
  "meio": "Pix",
  "recebidoEm": "2026-10-11",
  "observacao": "Metade do valor, conforme combinado",
  "confirmaExcedente": false
}
```

| Campo | Validação |
|---|---|
| `valorCentavos` | inteiro > 0, ≤ R$ 1.000.000,00 |
| `meio` | 2–50 chars; **rejeitado** se contiver sequência de 13+ dígitos ou padrão de CPF/CNPJ |
| `recebidoEm` | `YYYY-MM-DD`, ≤ hoje, ≥ hoje − 2 anos |
| `observacao` | opcional, ≤ 300 chars, sem HTML, mesma rejeição de padrões sensíveis |
| `confirmaExcedente` | booleano; obrigatório `true` se a soma passar do total |

Resposta `200`:

```json
{
  "pagamento": {
    "situacao": "PARCIAL",
    "valorRecebidoCentavos": 110000,
    "valorRecebidoFormatado": "R$ 1.100,00",
    "totalCentavos": 220000,
    "faltaCentavos": 110000,
    "percentualRecebido": 50,
    "lancamentos": [
      { "lancamentoId": "01HS...", "valorCentavos": 110000,
        "valorFormatado": "R$ 1.100,00", "meio": "Pix",
        "recebidoEm": "2026-10-11", "observacao": "Metade do valor...",
        "registradoEm": "2026-10-11T18:04:00-03:00",
        "registradoPor": "proprietario@exemplo.com.br" }
    ]
  },
  "versao": 4
}
```

### Outras rotas

| Rota | Corpo |
|---|---|
| `PUT .../pagamento/{lancamentoId}` | mesmos campos |
| `DELETE .../pagamento/{lancamentoId}` | — |
| `POST .../pagamento/marcar-pago` | `{ "recebidoEm": "2026-10-11" }` — atalho A7 |

### Erros

| Código | HTTP | `detalhes` |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | `campos[]` |
| `DADO_SENSIVEL_DETECTADO` | 400 | `campo` |
| `NAO_ENCONTRADO` | 404 | — |
| `TRANSICAO_INVALIDA` | 409 | `statusAtual` |
| `CONFLITO_VERSAO` | 409 | — |
| `VALOR_INVALIDO` | 422 | — |
| `VALOR_EXCEDE_TOTAL` | 422 | `totalCentavos`, `somaAtual` |
| `DATA_INVALIDA` | 422 | — |

## Implementação

### Modelo (dentro do item da reserva)

```json
{
  "pagamento": {
    "lancamentos": [
      { "lancamentoId": "01HS...", "valorCentavos": 110000, "meio": "Pix",
        "recebidoEm": "2026-10-11", "observacao": "",
        "registradoEm": "...", "registradoPor": "..." }
    ],
    "valorDevolvidoCentavos": 0
  }
}
```

`situacao`, `valorRecebidoCentavos`, `faltaCentavos` e `percentualRecebido` são
**derivados na leitura**, nunca persistidos. Persistir um total ao lado da lista é
convite a divergência: o dia em que alguém editar a lista sem recalcular o total,
os dois discordam para sempre.

### Escrita

```
1. exigirAdmin()
2. zod + detecção de dado sensível          → 400
3. GetItem da reserva                       → 404
4. status ∉ {CONFIRMADA, CONCLUIDA}         → 409
5. somaNova = soma(lancamentos) + valor
   se somaNova > total && !confirmaExcedente → 422
6. Update RESERVA#<id>/META
     SET pagamento.lancamentos = list_append(...), versao = versao + 1,
         historico = list_append(...)
     ConditionExpression: #s IN (:confirmada, :concluida) AND versao = :versaoLida
7. 200 com os derivados recalculados
```

`list_append` dentro de um mapa (`pagamento.lancamentos`) funciona, desde que
`pagamento` exista. Crie `pagamento: { lancamentos: [], valorDevolvidoCentavos: 0 }`
na confirmação da reserva, para não precisar de `if_not_exists` aninhado.

### Detecção de dado sensível (RN6)

```ts
const PADROES_PROIBIDOS = [
  /\d{13,}/,                                  // número de cartão
  /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,             // CPF
  /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/,     // CNPJ
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // cartão formatado
];
```

Aplicado a `meio` e `observacao`. Rejeitar com `400 DADO_SENSIVEL_DETECTADO` e uma
mensagem que **explica**: *"Não registre números de cartão, CPF ou conta. Use apenas
o meio de pagamento (ex.: Pix, Transferência)."*

> Isso é prevenção de dano, não paranoia: o admin naturalmente colaria "Pix
> 123.456.789-00" se não fosse impedido, e aí o sistema passa a armazenar CPF — com
> todas as obrigações de LGPD que isso cria, sem nenhuma necessidade.

### Armadilhas

1. **Não persistir os derivados** (RN4/RN3).
2. **Detectar dado sensível** (RN6) — e testar os padrões.
3. **Log sem valores.** O log registra `reservaId` e a ação; **nunca** o valor, o meio
   ou o nome. Regra do CLAUDE.md global: nada de valores financeiros associados a
   pessoa identificável.
4. **Nenhum e-mail** (RN13). O hóspede não precisa de confirmação automática de um
   registro interno.
5. **`pagamento` fora de toda resposta pública** (RN11) — verificado por teste no
   endpoint de acompanhamento.
6. **Centavos.** Mesma disciplina de [UC-A04](./UC-A04-gerenciar-precos.md): conversão
   reais→centavos uma única vez, na borda.
7. **Versão otimista** (E10): duas abas registrando o mesmo pagamento criariam dois
   lançamentos iguais sem a condição em `versao`.

## Interface

```
PAGAMENTO                                    [ Registrar recebimento ]
┌──────────────────────────────────────────────────────────────┐
│  Total combinado          R$ 2.200,00                         │
│  Recebido                 R$ 1.100,00   (50%)                 │
│  Falta                    R$ 1.100,00                         │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░                                        │
│                                                                │
│  LANÇAMENTOS                                                   │
│  11/10/2026   Pix              R$ 1.100,00    ✏ 🗑           │
│               "Metade do valor, conforme combinado"            │
│                                                                │
│  [ Marcar como pago integralmente ]                            │
│                                                                │
│  ⓘ Este registro é só para seu controle. O site não recebe    │
│    pagamentos e isto não é um documento contábil.             │
└──────────────────────────────────────────────────────────────┘
```

Diálogo de registro:

```
┌──────────────────────────────────────────────────┐
│  Registrar recebimento                            │
│                                                    │
│  Maria Silva · Casa do Lago · 20 a 23/11/2026      │
│  Total R$ 2.200,00 · já registrado R$ 0,00         │
│                                                    │
│  Valor recebido *     R$ [  1.100,00 ]             │
│                       [ 50% ] [ 100% ]  ← atalhos  │
│  Meio *               [ Pix              ▾ ]       │
│                         Pix / Transferência /      │
│                         Dinheiro / Outro           │
│  Recebido em *        [ 11/10/2026 ]               │
│  Observação           [ ______________________ ]   │
│                                                    │
│  ⚠ Não escreva número de cartão, CPF ou conta.    │
│                                                    │
│            [ Voltar ]  [ Registrar ]               │
└──────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| Atalhos 50% / 100% | O caso mais comum em um clique |
| Barra de progresso | Leitura instantânea da situação |
| Aviso "não é contábil" | **Permanente** no bloco, não só no diálogo |
| Aviso sobre dado sensível | Antes do envio, não só no erro |
| Meio com lista + livre | Sugestões cobrem 95%; livre cobre o resto |
| Excluir lançamento | Confirmação que mostra valor e data |
| Situação no painel e na lista | "50% pago" visível sem abrir a reserva |
| Mobile | Funciona: o Pix chega no celular, o registro acontece ali |

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` |
| Dados proibidos | Cartão, CPF, CNPJ e conta **rejeitados na entrada** |
| Exposição pública | `pagamento` nunca em endpoint público (testado) |
| Log | Sem valor, sem meio, sem nome. Só `reservaId`, ação e `sub` |
| Auditoria | Cada lançamento com autor e data; edições e exclusões no `historico` |
| LGPD | Nenhum dado financeiro identificável além do valor agregado por reserva |
| E-mail | Nenhum |

> A combinação "valor + nome + telefone" é o conjunto mais sensível do sistema. Ele
> existe no banco (necessário) e na tela do admin (necessário), mas **não** em log,
> **não** em e-mail e **não** em endpoint público.

## Critérios de aceite

- [ ] Registro só em reserva `CONFIRMADA` ou `CONCLUIDA`.
- [ ] Reserva `SOLICITADA` retorna `409`.
- [ ] Reserva `CANCELADA` retorna `409`.
- [ ] Dois lançamentos somam corretamente.
- [ ] `situacao` derivada: `NAO_REGISTRADO` / `PARCIAL` / `TOTAL`.
- [ ] Derivados não são persistidos.
- [ ] Valor zero ou negativo retorna `422`.
- [ ] Valor acima do total exige `confirmaExcedente`.
- [ ] Data futura retorna `422`.
- [ ] Data de 3 anos atrás retorna `422`.
- [ ] CPF no campo `meio` retorna `400 DADO_SENSIVEL_DETECTADO`.
- [ ] Número de cartão na observação retorna `400`.
- [ ] Editar e excluir lançamento recalcula os totais.
- [ ] `pagamento` ausente de toda resposta pública.
- [ ] Nenhum valor financeiro em log.
- [ ] Nenhum e-mail disparado.
- [ ] Atalho "marcar como pago" cria lançamento com o total.
- [ ] Duas abas registrando ao mesmo tempo geram `409 CONFLITO_VERSAO`.
- [ ] A tela exibe o aviso de que não é documento contábil.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Registrar R$ 1.100,00 de R$ 2.200,00 | `situacao: PARCIAL`, 50% |
| 2 | Registrar o restante | `situacao: TOTAL`, 100% |
| 3 | Registrar o total de uma vez | `situacao: TOTAL` |
| 4 | Reserva sem lançamentos | `situacao: NAO_REGISTRADO` |
| 5 | Registrar em `SOLICITADA` | `409` |
| 6 | Registrar em `CANCELADA` | `409` |
| 7 | Registrar em `CONCLUIDA` | `200` |
| 8 | Valor `0` | `422` |
| 9 | Valor negativo | `422` |
| 10 | Valor R$ 2.500,00 sem `confirmaExcedente` | `422 VALOR_EXCEDE_TOTAL` |
| 11 | Valor R$ 2.500,00 com `confirmaExcedente: true` | `200`; `TOTAL` + aviso |
| 12 | `recebidoEm` amanhã | `422` |
| 13 | `recebidoEm` em 2023 | `422` |
| 14 | `meio: "Pix 123.456.789-00"` | `400 DADO_SENSIVEL_DETECTADO` |
| 15 | `observacao` com 16 dígitos | `400` |
| 16 | `meio: "Pix"` | `200` |
| 17 | Excluir um de dois lançamentos | Soma recalculada; `PARCIAL` |
| 18 | Editar valor de um lançamento | Soma recalculada |
| 19 | Item do banco inspecionado | Sem `situacao` nem `valorRecebidoCentavos` persistidos |
| 20 | `GET /api/solicitacoes/{id}?t=` | Sem `pagamento` |
| 21 | Log do registro | Sem valor, meio ou nome |
| 22 | E-mails após registrar | Nenhum |
| 23 | Atalho "marcar como pago" | Lançamento com o valor total |
| 24 | Duas requisições simultâneas | 1 sucesso, 1 `409` |
| 25 | Relatório do mês | Usa a soma dos lançamentos |
| 26 | Digitar `1.100,00` | Persistido `110000` |
