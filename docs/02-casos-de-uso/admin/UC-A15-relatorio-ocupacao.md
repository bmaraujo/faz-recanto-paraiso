# UC-A15 — Consultar relatório de ocupação

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado |
| Gatilho | O admin abre `/admin/relatorio` |
| Fase | 3 |
| Relacionados | [UC-A10](./UC-A10-registrar-pagamento.md), [UC-A06](./UC-A06-ver-agenda.md), [04 — API admin](../../03-tecnico/04-api-admin.md) |

## Objetivo de negócio

Responder às perguntas que o proprietário hoje não consegue responder:

1. **Quanto a fazenda rendeu neste mês?** (do que foi registrado como recebido)
2. **Qual casa rende mais?** E qual fica mais vazia?
3. **Estou perdendo negócio?** Quantas solicitações expiraram sem eu responder?
4. **Qual canal traz mais reserva** — site, WhatsApp, Airbnb, indicação?
5. **Qual a taxa de ocupação?** Faz sentido ajustar preço?

A pergunta 3 é a mais valiosa e a que nenhum caderno responde: **solicitação expirada
é dinheiro que passou pela porta e foi embora**. Se o número for alto, o problema não
é o preço — é o tempo de resposta.

## Fluxo principal

1. O admin abre `/admin/relatorio`.
2. Escolhe o período (padrão: mês atual) e, opcionalmente, uma casa.
3. Vê:
   - **Receita registrada** no período;
   - **Ocupação** por casa (noites ocupadas, taxa, diária média);
   - **Funil**: solicitações → confirmadas / recusadas / expiradas, com a taxa de conversão;
   - **Por canal**: reservas e receita por origem;
   - **Comparação** com o mesmo mês do ano anterior, se houver dados.
4. Pode exportar a tabela em CSV.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Período sem dados | Relatório zerado, com mensagem explicativa, não erro |
| A2 | Admin escolhe um ano inteiro | Agregado por mês, com gráfico simples de barras |
| A3 | Admin filtra por casa | Todos os números recalculados para aquela casa |
| A4 | Admin compara dois meses | Seletor de período de comparação |
| A5 | Admin exporta CSV | Gerado **no cliente**, a partir dos dados já carregados |
| A6 | Primeiro mês de uso | Sem comparação histórica; só o período atual |

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Período inválido (`ate < de`) | `422` | Campos marcados |
| E2 | Período acima de 24 meses | `422` | "Escolha um período de até 24 meses." |
| E3 | Mês no futuro | `200` | Relatório com zeros e aviso de período futuro |
| E4 | Falha da API | — | "Não conseguimos carregar o relatório." + Tentar novamente |
| E5 | Uma casa foi excluída | `200` | As reservas dela aparecem com o nome denormalizado |

> E5 funciona porque `casaNome` é **denormalizado** no item da reserva
> ([02 — Modelo de dados](../../03-tecnico/02-modelo-de-dados.md)). Sem isso, excluir
> uma casa quebraria o histórico.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | **Receita registrada** = soma dos lançamentos de pagamento das reservas do período |
| RN2 | A receita é atribuída ao mês do **check-in**, não ao do recebimento |
| RN3 | Noites ocupadas contam todas as origens (`RESERVA`, `BLOQUEIO`, `EXTERNO`), discriminadas |
| RN4 | Taxa de ocupação = noites ocupadas ÷ noites do mês, por casa |
| RN5 | Reservas `CANCELADA`, `RECUSADA` e `EXPIRADA` **não** contam como ocupação |
| RN6 | Reservas canceladas aparecem no funil, não na ocupação |
| RN7 | Diária média = receita ÷ noites de reserva (exclui bloqueio e externo) |
| RN8 | O funil conta por data de **criação** da solicitação |
| RN9 | Taxa de conversão = confirmadas ÷ solicitações criadas |
| RN10 | `canal` agrupa por origem comercial |
| RN11 | O relatório é **informativo**, não contábil — a tela diz isso |
| RN12 | Valores sempre formatados em reais |
| RN13 | O CSV é gerado no cliente |

> **RN2 é uma escolha que precisa estar explícita na tela.** Atribuir a receita ao mês
> do check-in responde "quanto a casa rendeu em novembro", que é a pergunta do
> proprietário. Atribuir ao mês do recebimento responderia "quanto entrou no caixa em
> outubro", que é pergunta de contador. Como o relatório é operacional e não contábil,
> a primeira é a correta — mas a tela precisa dizer qual critério está usando.
>
> **RN11:** o relatório usa o que o admin **registrou** como recebido. Se ele não
> registrou, o número está baixo. O texto na tela precisa deixar isso claro, senão o
> relatório parece errado quando o problema é o preenchimento.

## Contrato técnico

### `GET /api/admin/relatorio?de=2026-11-01&ate=2026-11-30&casaId=`

```json
{
  "periodo": { "de": "2026-11-01", "ate": "2026-11-30", "noitesDoPeriodo": 30 },
  "porCasa": [
    {
      "casaId": "01HQ...", "casaNome": "Casa do Lago",
      "noitesOcupadas": 12,
      "noitesPorOrigem": { "RESERVA": 10, "BLOQUEIO": 1, "EXTERNO": 1 },
      "taxaOcupacao": 0.4,
      "reservasConfirmadas": 4,
      "reservasCanceladas": 1,
      "valorCombinadoCentavos": 880000,
      "valorRecebidoCentavos": 440000,
      "diariaMediaCentavos": 88000,
      "percentualRecebido": 50
    }
  ],
  "totais": {
    "noitesDisponiveis": 90,
    "noitesOcupadas": 18,
    "taxaOcupacao": 0.2,
    "valorCombinadoCentavos": 1320000,
    "valorRecebidoCentavos": 660000,
    "reservasConfirmadas": 6
  },
  "funil": {
    "solicitacoesCriadas": 12,
    "confirmadas": 4,
    "recusadas": 2,
    "expiradas": 5,
    "canceladasPeloHospede": 1,
    "taxaConversao": 0.333,
    "tempoMedioRespostaHoras": 9.4
  },
  "porCanal": [
    { "canal": "SITE", "reservas": 4, "valorRecebidoCentavos": 440000, "noites": 10 },
    { "canal": "WHATSAPP", "reservas": 2, "valorRecebidoCentavos": 220000, "noites": 8 }
  ],
  "comparacao": {
    "periodoAnterior": { "de": "2025-11-01", "ate": "2025-11-30" },
    "variacaoReceita": 0.18,
    "variacaoOcupacao": 0.05,
    "disponivel": true
  },
  "observacao": "A receita considera apenas os pagamentos que você registrou, atribuídos ao mês do check-in. Este relatório é informativo e não é um documento contábil."
}
```

`tempoMedioRespostaHoras` (de `criadoEm` até `confirmadaEm`/recusa) é o indicador que
explica a taxa de expiração — e é acionável: se é 30 h com prazo de 48 h, o admin está
no limite.

### Erros

| Código | HTTP |
|---|---|
| `ENTRADA_INVALIDA` | 400 |
| `PERIODO_INVALIDO` | 422 |
| `PERIODO_MUITO_LONGO` | 422 |

## Implementação

### Consultas

```
1. Reservas do período:
     Query GSI1 PK=RESERVA, SK BETWEEN "<de>" AND "<ate>#~"
     (filtro por casaId na Lambda, se pedido)

2. Ocupações do período, por casa:
     Query OCUPACAO#<casaId>, SK BETWEEN NOITE#<de> AND NOITE#<ate>
     uma por casa, em paralelo

3. Funil: reservas criadas no período
     → precisa de filtro por `criadoEm`, não por check-in (ver abaixo)

4. Agregar em memória
```

### O problema do funil, e a solução

O GSI1 é ordenado por **check-in**, mas o funil precisa das solicitações **criadas** no
período. Uma solicitação criada em novembro para um check-in em março não apareceria.

Três opções avaliadas:

| Opção | Custo | Veredito |
|---|---|---|
| Novo GSI por `criadoEm` | Mais um índice (duplica a escrita) | Desnecessário nesse volume |
| `Scan` com filtro | Lê a tabela inteira | **Proibido** no projeto |
| Query ampla + filtro em memória | Lê 13 meses de reservas (~100 itens/ano) | **Escolhida** |

Como o `reservaId` é um **ULID** e ULID é ordenável por tempo de criação, a query lê o
GSI1 de `hoje − 2 meses` até `hoje + 13 meses` e filtra `criadoEm` em memória. Com
poucas centenas de reservas por ano, são alguns KB e frações de centavo.

**Gatilho de revisão:** acima de ~2.000 reservas/ano, criar
`GSI2PK = "RESERVA_CRIACAO"`, `GSI2SK = <criadoEm>`.

> Documentar o raciocínio descartado é tão útil quanto a decisão: evita que alguém
> "resolva" isso com um `Scan` seis meses depois.

### Armadilhas

1. **Receita pelo mês do check-in** (RN2) — e dizer isso na tela.
2. **Não contar cancelada como ocupação** (RN5), mas contá-la no funil (RN6).
3. **Noites do mês**, não dias: fevereiro tem 28 ou 29; um período parcial tem o que tem.
4. **Diária média exclui bloqueio e externo** (RN7): incluir distorceria o número para baixo.
5. **Divisão por zero** em todas as taxas: período sem noites, sem reservas, sem receita.
6. **CSV no cliente** (RN13): um endpoint que devolve a base inteira seria o alvo mais
   atraente do sistema.
7. **`casaNome` denormalizado** (E5): nunca resolver o nome por `GetItem` na casa — ela
   pode não existir mais.
8. **Fuso** no limite do mês: `2026-11-30` inclui a noite de 30/11.

## Interface

```
Relatório                      [ Novembro 2026 ▾ ]  [ Todas as casas ▾ ]

RESUMO
┌──────────────────────────────────────────────────────────────┐
│  Receita registrada    R$ 6.600,00     ↑ 18% vs. nov/2025    │
│  Ocupação              18/90 noites    20%    ↑ 5pp          │
│  Reservas confirmadas  6                                      │
│  Combinado             R$ 13.200,00  (50% registrado)         │
└──────────────────────────────────────────────────────────────┘

POR CASA
┌──────────────────────────────────────────────────────────────┐
│                 noites  ocupação  reservas  recebido  diária │
│ Casa do Lago     12/30     40%       4      R$4.400  R$880  │
│ Casa da Mata      6/30     20%       2      R$2.200  R$550  │
│ Chalé Mirante     0/30      0%       0      R$    0      –  │
└──────────────────────────────────────────────────────────────┘

FUNIL DE SOLICITAÇÕES
┌──────────────────────────────────────────────────────────────┐
│ Solicitações recebidas       12   ████████████               │
│ Confirmadas                   4   ████          33%          │
│ Recusadas por você            2   ██            17%          │
│ Expiradas sem resposta        5   █████         42%  ⚠       │
│ Desistências do hóspede       1   █              8%          │
│                                                               │
│ Tempo médio de resposta: 9,4 horas                           │
│ ⚠ 42% das solicitações expiraram sem resposta. Responder     │
│   mais rápido pode aumentar bastante suas reservas.          │
└──────────────────────────────────────────────────────────────┘

POR CANAL
  Site        4 reservas   R$ 4.400,00   10 noites
  WhatsApp    2 reservas   R$ 2.200,00    8 noites

ⓘ A receita considera apenas os pagamentos que você registrou,
  atribuídos ao mês do check-in. Relatório informativo — não é
  documento contábil.                        [ Exportar CSV ]
```

| Padrão | Regra |
|---|---|
| Expiradas em destaque | É o número acionável; merece o alerta |
| Alerta com recomendação | "Responder mais rápido pode aumentar suas reservas" — não só o número |
| Comparação ano a ano | Contexto; sem ela, 20% de ocupação não significa nada |
| Diária média | Base para decidir ajuste de preço |
| Observação sobre o critério | Permanente, não em nota de rodapé |
| CSV | Exportação simples, no cliente |
| Período | Seletor de mês + opção de ano inteiro |
| Mobile | Tabelas rolam na horizontal; o resumo e o funil são a visão principal |
| Casa sem reservas | Aparece com zeros, não é omitida |

> A casa com 0% aparecer na lista é intencional: é exatamente a informação que o
> proprietário precisa ver. Omitir linhas vazias esconderia o problema.

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` |
| Dados pessoais | **Nenhum.** O relatório é agregado; não lista hóspedes |
| Valores | Agregados por casa e por canal, nunca por pessoa |
| CSV | Gerado no cliente, com os mesmos agregados |
| Log | Período consultado e `sub` do admin; **nenhum** valor |
| Cache | Nenhum (`no-store`) |

> O relatório ser **puramente agregado** é uma escolha de privacidade: não há caso de
> uso que exija listar "quem pagou quanto" em um relatório. Quem precisa disso abre a
> reserva. Agregar aqui reduz a superfície do dado mais sensível do sistema.

## Critérios de aceite

- [ ] Receita registrada = soma dos lançamentos das reservas do período.
- [ ] A receita é atribuída ao mês do check-in, e a tela informa o critério.
- [ ] Noites ocupadas discriminadas por origem.
- [ ] Taxa de ocupação correta por casa e no total.
- [ ] Reservas canceladas/recusadas/expiradas não contam como ocupação.
- [ ] O funil conta por data de criação.
- [ ] Taxa de conversão e tempo médio de resposta calculados.
- [ ] Alerta quando a taxa de expiração é alta.
- [ ] Agrupamento por canal.
- [ ] Comparação com o mesmo período do ano anterior, quando houver dados.
- [ ] Período sem dados mostra zeros, não erro.
- [ ] Período acima de 24 meses retorna `422`.
- [ ] Nenhuma divisão por zero.
- [ ] Nenhum dado pessoal no relatório.
- [ ] CSV gerado no cliente.
- [ ] Casa sem reservas aparece com zeros.
- [ ] Reserva de casa excluída aparece com o nome denormalizado.
- [ ] Nenhum `Scan` é executado.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Mês com 4 reservas confirmadas | Contagem e receita corretas |
| 2 | Reserva com check-in em novembro, pago em outubro | Receita em **novembro** |
| 3 | Reserva cancelada no mês | Fora da ocupação; dentro do funil |
| 4 | Reserva confirmada sem pagamento registrado | Combinado > 0; recebido 0 |
| 5 | 12 noites ocupadas em novembro | 40% |
| 6 | Fevereiro de 2028 (bissexto) | 29 noites no denominador |
| 7 | Período parcial (1 a 15/11) | 15 noites no denominador |
| 8 | Bloqueio de 1 noite | Em `noitesPorOrigem.BLOQUEIO`; **fora** da diária média |
| 9 | Evento externo | Em `noitesPorOrigem.EXTERNO` |
| 10 | 12 solicitações, 4 confirmadas | Conversão 33,3% |
| 11 | Solicitação criada em nov para check-in em mar | No funil de **novembro** |
| 12 | 5 de 12 expiradas | Alerta exibido |
| 13 | Mês sem reservas | Zeros, sem erro, sem divisão por zero |
| 14 | Mês futuro | Zeros + aviso |
| 15 | `ate < de` | `422` |
| 16 | Período de 30 meses | `422` |
| 17 | Filtro por casa | Todos os números daquela casa |
| 18 | Casa sem reservas | Linha com zeros |
| 19 | Casa excluída com reservas antigas | Nome denormalizado exibido |
| 20 | Resposta inspecionada | Nenhum nome, e-mail ou telefone |
| 21 | Log da consulta | Nenhum valor |
| 22 | Sem dados do ano anterior | `comparacao.disponivel: false` |
| 23 | Tempo médio com 4 confirmadas | Média correta em horas |
| 24 | CSV exportado | Mesmos números da tela |
| 25 | Consultas executadas | Nenhum `Scan` |
