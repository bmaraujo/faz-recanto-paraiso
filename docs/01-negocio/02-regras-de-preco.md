# 02 — Regras de preço

O site mostra uma **estimativa**. O valor final é o que o administrador combinar com o
hóspede. Isso precisa estar escrito na tela — ver [UC-P03](../02-casos-de-uso/publico/UC-P03-simular-preco.md).

Mesmo sendo estimativa, o cálculo tem de ser **correto e determinístico**: é o número
que o hóspede vai cobrar do administrador depois.

## Princípios

1. **Dinheiro em centavos, inteiro.** Nenhum `float` em nenhum lugar do caminho.
2. **Cada casa tem sua própria configuração de preços.** Não existe preço global.
3. **A cotação é recalculada no servidor** ao criar a solicitação. O valor enviado
   pelo navegador é ignorado por completo.
4. **A função de cotação é pura**: mesma entrada → mesma saída, sem I/O, sem
   `Date.now()` interno (a data atual entra como parâmetro).
5. **O detalhamento é parte do resultado**, não um extra. O hóspede e o admin precisam
   ver linha a linha de onde saiu o total.

## Configuração de preços (por casa)

```json
{
  "diariaBaseCentavos": 50000,
  "diariaFimDeSemanaCentavos": 65000,
  "diasFimDeSemana": ["SEX", "SAB"],
  "temporadas": [
    {
      "id": "ferias-julho-2027",
      "nome": "Férias de julho",
      "inicio": "2027-07-01",
      "fim": "2027-07-31",
      "diariaCentavos": 70000,
      "minNoites": 3
    }
  ],
  "feriados": [
    {
      "id": "reveillon-2026",
      "nome": "Réveillon",
      "inicio": "2026-12-29",
      "fim": "2027-01-02",
      "diariaCentavos": 120000,
      "minNoites": 4
    }
  ],
  "minNoitesPadrao": 2,
  "maxNoites": 60,
  "taxaLimpezaCentavos": 25000,
  "hospedesInclusos": 6,
  "capacidadeMaxima": 10,
  "valorHospedeExtraPorNoiteCentavos": 5000
}
```

Valores do exemplo são ilustrativos — ver [pendências](../06-planejamento/02-pendencias-definir.md).

### Semântica de `inicio` e `fim` em temporadas e feriados

`inicio` e `fim` são **inclusivos** e se referem à **noite**, não ao check-out.
Um feriado `inicio: 2026-12-29, fim: 2027-01-02` aplica a diária de feriado às noites
29, 30, 31, 01 e 02.

> Convenção diferente do check-in/check-out de propósito: aqui o proprietário pensa
> em "do dia 29 ao dia 2 é réveillon", e inclusivo é o que ele espera.

### `diasFimDeSemana`

Lista de dias da semana que usam `diariaFimDeSemanaCentavos`, pela data da **noite**.
Valores: `DOM`, `SEG`, `TER`, `QUA`, `QUI`, `SEX`, `SAB`. Padrão: `["SEX", "SAB"]`.

## Algoritmo de cotação

Função pura:

```
calcularCotacao(configPrecos, { checkin, checkout, hospedes, hoje, configGeral })
  → Cotacao | ErroDeValidacao
```

### Passo 1 — Validações (falha rápido, uma causa por vez)

Na ordem, retornando o primeiro erro encontrado:

| Ordem | Validação | Código de erro |
|---|---|---|
| 1 | `checkin` e `checkout` são datas válidas `YYYY-MM-DD` | `DATA_INVALIDA` |
| 2 | `checkout > checkin` | `INTERVALO_INVALIDO` |
| 3 | `checkin >= hoje + antecedenciaMinimaDias` | `ANTECEDENCIA_MINIMA` |
| 4 | `checkin <= hoje + janelaReservaMeses` | `FORA_DA_JANELA` |
| 5 | `noites <= maxNoites` | `MAXIMO_NOITES` |
| 6 | `1 <= hospedes <= capacidadeMaxima` | `CAPACIDADE_EXCEDIDA` |
| 7 | `noites >= minNoitesExigido` (passo 3) | `MINIMO_NOITES` |

Cada erro carrega os dados necessários para a mensagem amigável
(ex.: `MINIMO_NOITES` carrega `minimoExigido` e o nome do período que o impôs).

### Passo 2 — Diária de cada noite, por precedência

Para cada noite `N` em `[checkin, checkout)`, nesta ordem, a primeira que casar vence:

```
1. feriado cujo intervalo contém N          → diariaCentavos do feriado
2. temporada cujo intervalo contém N        → diariaCentavos da temporada
3. dia da semana de N está em diasFimDeSemana → diariaFimDeSemanaCentavos
4. caso contrário                            → diariaBaseCentavos
```

Se dois feriados (ou duas temporadas) se sobrepuserem na mesma noite, vence o de
**maior diária**, e a validação de configuração emite um aviso ao admin ao salvar
([UC-A04](../02-casos-de-uso/admin/UC-A04-gerenciar-precos.md)). Sobreposição é
provavelmente erro de cadastro, mas não deve derrubar a cotação.

### Passo 3 — Mínimo de noites exigido

```
periodosTocados = feriados ∪ temporadas que contêm qualquer noite da estadia
minNoitesExigido = max(minNoites dos periodosTocados, minNoitesPadrao)
```

### Passo 4 — Subtotal

```
subtotalDiarias = Σ diária de cada noite
hospedesExtras  = max(0, hospedes − hospedesInclusos)
acrescimoHospedes = hospedesExtras × valorHospedeExtraPorNoiteCentavos × noites
subtotal = subtotalDiarias + acrescimoHospedes
```

### Passo 5 — Desconto

Não há cupons. O **administrador** pode registrar um `descontoCentavos` manual ao
confirmar ou editar a reserva ([UC-A07](../02-casos-de-uso/admin/UC-A07-confirmar-reserva.md)).
Na cotação pública, `descontoCentavos = 0` sempre.

Quando houver desconto, ele incide sobre o `subtotal`, **nunca** sobre a taxa de limpeza,
e nunca pode deixar o total negativo:

```
descontoAplicado = min(descontoCentavos, subtotal)
```

### Passo 6 — Total

```
total = subtotal − descontoAplicado + taxaLimpezaCentavos
```

### Passo 7 — Detalhamento

O resultado inclui uma linha por noite e uma linha por componente:

```json
{
  "noites": 3,
  "subtotalDiariasCentavos": 180000,
  "acrescimoHospedesCentavos": 15000,
  "descontoCentavos": 0,
  "taxaLimpezaCentavos": 25000,
  "totalCentavos": 220000,
  "minNoitesExigido": 2,
  "detalhamento": [
    { "tipo": "NOITE", "data": "2026-11-20", "tarifa": "FIM_DE_SEMANA", "rotulo": "Sexta-feira",        "valorCentavos": 65000 },
    { "tipo": "NOITE", "data": "2026-11-21", "tarifa": "FIM_DE_SEMANA", "rotulo": "Sábado",             "valorCentavos": 65000 },
    { "tipo": "NOITE", "data": "2026-11-22", "tarifa": "BASE",          "rotulo": "Domingo",            "valorCentavos": 50000 },
    { "tipo": "HOSPEDE_EXTRA", "quantidade": 1, "rotulo": "1 hóspede extra × 3 noites", "valorCentavos": 15000 },
    { "tipo": "TAXA_LIMPEZA",  "rotulo": "Taxa de limpeza",                             "valorCentavos": 25000 }
  ]
}
```

O campo `tarifa` assume `FERIADO | TEMPORADA | FIM_DE_SEMANA | BASE`, e quando for
`FERIADO` ou `TEMPORADA` inclui também `periodoNome` — é o que explica ao hóspede
por que a noite custou mais.

## Arredondamento

Como tudo é inteiro em centavos e não há percentuais na cotação pública, **não há
arredondamento** no caminho principal.

Se um percentual for introduzido no futuro (ex.: desconto percentual pelo admin),
a regra é: `Math.round(valor × percentual / 100)` em centavos, aplicado **uma única
vez sobre o subtotal**, nunca noite a noite — somar arredondamentos por noite produz
divergência de centavos.

## Regras de validação da configuração de preços

Ao salvar ([UC-A04](../02-casos-de-uso/admin/UC-A04-gerenciar-precos.md)):

| Regra | Severidade |
|---|---|
| Todo valor em centavos é inteiro ≥ 0 | **Erro** |
| `diariaBaseCentavos > 0` | **Erro** |
| `fim >= inicio` em todo período | **Erro** |
| `minNoites >= 1` em todo período | **Erro** |
| `1 <= hospedesInclusos <= capacidadeMaxima` | **Erro** |
| `1 <= minNoitesPadrao <= maxNoites` | **Erro** |
| `maxNoites <= 60` | **Erro** (limite técnico) |
| `id` de período único | **Erro** |
| Dois feriados ou duas temporadas se sobrepõem | **Aviso** |
| Diária acima de 10× a base | **Aviso** (provável erro de centavos) |
| Período inteiramente no passado | **Aviso** (sugerir remover) |

Avisos não impedem o salvamento, mas aparecem na tela.

## Casos de teste obrigatórios

| # | Cenário | Verifica |
|---|---|---|
| 1 | Sex + Sáb + Dom | Duas noites de fim de semana e uma base |
| 2 | Estadia que atravessa o início de uma temporada | Noites antes com base, noites depois com temporada |
| 3 | Estadia que atravessa o fim de um feriado | Precedência correta noite a noite |
| 4 | Noite coberta por feriado **e** temporada | Feriado vence |
| 5 | Dois feriados sobrepostos na mesma noite | Vence a maior diária |
| 6 | Feriado com `minNoites: 4`, pedido de 3 noites | `MINIMO_NOITES` com `minimoExigido: 4` |
| 7 | `hospedes = hospedesInclusos` | Acréscimo zero |
| 8 | `hospedes = hospedesInclusos + 2`, 3 noites | `2 × valor × 3` |
| 9 | `hospedes > capacidadeMaxima` | `CAPACIDADE_EXCEDIDA` |
| 10 | Desconto maior que o subtotal | Total = taxa de limpeza, nunca negativo |
| 11 | Taxa de limpeza em estadia de 10 noites | Cobrada **uma** vez |
| 12 | Check-in ontem | `ANTECEDENCIA_MINIMA` |
| 13 | Estadia de 61 noites | `MAXIMO_NOITES` |
| 14 | Configuração sem temporadas nem feriados | Só base e fim de semana |
| 15 | Soma do `detalhamento` | Igual a `totalCentavos` — **invariante de ouro** |
| 16 | Virada de ano dentro da estadia (31/12 → 01/01) | Noites corretas, sem erro de ano |
| 17 | Fuso: cotação às 23h de `America/Sao_Paulo` | `hoje` é a data local, não UTC |

> O caso 15 deve ser um teste de propriedade (property-based ou com muitas entradas
> aleatórias): **a soma do detalhamento é sempre igual ao total**. Esse é o invariante
> que protege contra qualquer refatoração futura.
