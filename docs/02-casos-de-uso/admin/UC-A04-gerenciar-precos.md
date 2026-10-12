# UC-A04 — Configurar preços de uma casa

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; casa existente |
| Gatilho | O admin abre a aba "Preços" de uma casa |
| Fase | 1 |
| Relacionados | [Regras de preço](../../01-negocio/02-regras-de-preco.md), [UC-P03](../publico/UC-P03-simular-preco.md), [UC-A14](./UC-A14-publicar-site.md) |

## Objetivo de negócio

Permitir que o proprietário ajuste a tabela sozinho — temporada de férias, réveillon,
aumento anual — sem depender de desenvolvedor. É o segundo pedido mais frequente de
mudança em qualquer site de aluguel, depois das fotos.

Risco a mitigar: um erro de digitação aqui **cobra o valor errado de todo mundo**.
Uma diária de R$ 500,00 digitada como `50000` em vez de `500` reais é 100× o preço.
Por isso a tela trabalha em **reais** e a validação tem avisos para valores fora do
esperado.

## Fluxo principal

1. O admin abre a aba "Preços" da casa.
2. Vê e edita:
   - diária base e de fim de semana;
   - quais dias contam como fim de semana;
   - taxa de limpeza;
   - hóspedes inclusos, capacidade máxima e valor do hóspede extra;
   - mínimo de noites padrão e máximo de noites;
   - lista de **temporadas**;
   - lista de **feriados**.
3. Adiciona, edita ou remove temporadas e feriados.
4. Usa o **simulador embutido** para conferir: escolhe datas e hóspedes e vê a cotação
   resultante antes de salvar.
5. Salva. O servidor valida e retorna erros e avisos.
6. Publica para que os preços exibidos no site mudem ([UC-A14](./UC-A14-publicar-site.md)).

> O simulador embutido (passo 4) é o que transforma essa tela de arriscada em segura:
> o admin **vê o efeito** antes de confirmar.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Admin adiciona temporada | Formulário com nome, início, fim, diária, mínimo de noites |
| A2 | Admin remove temporada já passada | Permitido; aviso de que reservas antigas mantêm o valor cobrado |
| A3 | Admin não usa temporadas | Listas vazias; só base e fim de semana |
| A4 | Admin copia os preços de outra casa | Botão "Copiar de outra casa", com confirmação |
| A5 | Admin quer aumento linear | Botão "Reajustar em %": aplica o percentual a todas as diárias, com pré-visualização antes de confirmar |
| A6 | Admin salva com avisos | Salvamento concluído; os avisos ficam visíveis na tela |

> A5 é o fluxo do aumento anual. Sem ele, o admin edita 12 valores à mão e erra um.

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Diária base zero ou negativa | `422` | "A diária base precisa ser maior que zero." |
| E2 | Temporada com `fim` antes de `inicio` | `422` | Campo marcado |
| E3 | `minNoites` da temporada igual a 0 | `422` | "O mínimo de noites precisa ser ao menos 1." |
| E4 | `hospedesInclusos` acima da capacidade | `422` | Campos marcados |
| E5 | `maxNoites` acima de 60 | `422` | "O máximo permitido é 60 noites (limite técnico)." |
| E6 | Dois feriados sobrepostos | `200` + **aviso** | "Réveillon e Ano Novo se sobrepõem em 01/01. Será usado o de maior valor." |
| E7 | Diária 10× maior que a base | `200` + **aviso** | "R$ 5.000,00 é 10× a diária base. Confirme se está correto." |
| E8 | Período inteiramente no passado | `200` + **aviso** | "Esta temporada já passou. Quer removê-la?" |
| E9 | `id` de período duplicado | `422` | Erro interno de consistência |
| E10 | Sessão expirada ao salvar | `401` | Renova; rascunho preservado |
| E11 | Casa com reservas futuras | `200` | Aviso: "3 reservas futuras mantêm o valor já combinado." |

> **E11 é uma regra de negócio importante:** mudar a tabela **não** altera o valor de
> reservas já criadas. Os `valores` ficam congelados no item da reserva no momento da
> solicitação. A tela precisa deixar isso explícito para o admin não achar que precisa
> renegociar.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Cada casa tem sua própria tabela de preços |
| RN2 | Todos os valores são armazenados em **centavos inteiros** |
| RN3 | A tela trabalha em **reais**, com máscara; a conversão acontece na borda |
| RN4 | `diariaBaseCentavos > 0` |
| RN5 | `inicio` e `fim` de períodos são **inclusivos** e referem-se à noite |
| RN6 | `minNoites >= 1` em todo período |
| RN7 | `1 <= hospedesInclusos <= capacidadeMaxima` |
| RN8 | `1 <= minNoitesPadrao <= maxNoites <= 60` |
| RN9 | `id` de período único dentro da casa |
| RN10 | Sobreposição de períodos do mesmo tipo é **aviso**, não erro; vence a maior diária |
| RN11 | Precedência: feriado > temporada > fim de semana > base |
| RN12 | Mudança de tabela **não** altera reservas existentes |
| RN13 | Toda alteração marca `publicacaoPendente = true` |
| RN14 | Toda escrita guarda uma versão anterior recuperável (últimas 5) |
| RN15 | Casa sem preços válidos não pode ser `ATIVA` |

> RN14: cinco versões de histórico custam alguns KB e salvam o dia em que o admin
> aplica um reajuste de 50% por engano.

## Contrato técnico

### `GET /api/admin/casas/{casaId}/precos`

```json
{
  "diariaBaseCentavos": 50000,
  "diariaFimDeSemanaCentavos": 65000,
  "diasFimDeSemana": ["SEX", "SAB"],
  "taxaLimpezaCentavos": 25000,
  "hospedesInclusos": 6,
  "capacidadeMaxima": 8,
  "valorHospedeExtraPorNoiteCentavos": 5000,
  "minNoitesPadrao": 2,
  "maxNoites": 60,
  "temporadas": [
    { "id": "ferias-julho-2027", "nome": "Férias de julho",
      "inicio": "2027-07-01", "fim": "2027-07-31",
      "diariaCentavos": 70000, "minNoites": 3 }
  ],
  "feriados": [
    { "id": "reveillon-2026", "nome": "Réveillon",
      "inicio": "2026-12-29", "fim": "2027-01-02",
      "diariaCentavos": 120000, "minNoites": 4 }
  ],
  "versao": 7,
  "valido": true,
  "avisos": [],
  "atualizadoEm": "2026-10-11T18:04:00-03:00",
  "atualizadoPor": "proprietario@exemplo.com.br"
}
```

### `PUT /api/admin/casas/{casaId}/precos`

Mesmo corpo (sem os campos derivados), com `versao` para controle otimista.

Resposta `200`:

```json
{
  "precos": { },
  "avisos": [
    { "codigo": "PERIODOS_SOBREPOSTOS", "mensagem": "Réveillon e Ano Novo se sobrepõem em 01/01/2027.",
      "campos": ["feriados[0]", "feriados[1]"] },
    { "codigo": "VALOR_SUSPEITO", "mensagem": "R$ 5.000,00 é 10× a diária base.",
      "campos": ["temporadas[2].diariaCentavos"] }
  ],
  "reservasFuturasAfetadas": 0,
  "publicacaoPendente": true
}
```

### `POST /api/admin/casas/{casaId}/precos/validar`

Valida e simula **sem salvar**. Corpo: a configuração + opcionalmente
`{ "simulacao": { "checkin", "checkout", "hospedes" } }`.
Resposta: `erros[]`, `avisos[]` e a `cotacao` resultante. É o que alimenta o simulador
embutido.

### Erros

| Código | HTTP | |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | falha de schema |
| `CONFIGURACAO_INVALIDA` | 422 | `detalhes.erros[]` com campo e mensagem |
| `CONFLITO_VERSAO` | 409 | editado em outra aba |
| `NAO_ENCONTRADO` | 404 | |

## Implementação

| Arquivo | O que faz |
|---|---|
| `packages/shared/src/precos.ts` | `calcularCotacao` e `validarConfigPrecos` — puras |
| `backend/src/handlers/api-admin.ts` | Rotas |
| `site/src/components/admin/FormularioPrecos.tsx` | Formulário + simulador |
| `site/src/components/admin/CampoMoeda.tsx` | Entrada em reais → centavos |

### `validarConfigPrecos` — pura, retorna erros **e** avisos

```ts
export function validarConfigPrecos(
  config: ConfigPrecos,
  hoje: string,
): { erros: Problema[]; avisos: Problema[] };
```

A mesma função roda no cliente (feedback imediato) e no servidor (autoridade).
**Nenhuma duplicação de regra.**

### Campo de moeda

```
Digitação do admin  →  "500,00"  →  50000 centavos
Exibição            →  50000     →  "R$ 500,00"
```

| Regra | Valor |
|---|---|
| Entrada | Máscara que aceita só dígitos, vírgula e ponto |
| Conversão | `Math.round(parseFloat(normalizado) * 100)` — **uma única vez**, na borda |
| Exibição | `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })` |
| Interno | **Sempre centavos inteiros**; nenhum `float` persistido |
| Limite | R$ 100.000,00 por diária (sanidade) |

> A conversão reais→centavos é o ponto onde o `float` entra. Fazê-la **uma vez na
> borda**, com `Math.round`, e nunca mais tocar em ponto flutuante é o que garante a
> exatidão de todo o resto.

### Armadilhas

1. **Erro de centavos vs. reais** é o bug mais provável. Mitigação em três camadas:
   campo com máscara e prefixo `R$`, aviso de valor suspeito (E7), e o simulador.
2. **`id` dos períodos** gerado no cliente ao adicionar (slug do nome + ano) e
   **estável** — se mudar a cada salvamento, o histórico perde o rastro.
3. **Períodos inclusivos.** Réveillon `29/12` a `02/01` cobre 5 noites, inclusive a de
   02/01. Diferente do check-out de reserva. Testar as duas convenções.
4. **Não recalcular reservas existentes** (RN12). Os valores estão congeladas no item
   da reserva, de propósito.
5. **`publicacaoPendente`.** O preço aparece na página da casa; sem publicar, o site
   continua mostrando o antigo.
6. **Histórico.** Grave a versão anterior em `CASA#<id>/PRECOS#V#<ISO>` antes de
   sobrescrever, mantendo as 5 últimas.

## Interface

```
Preços — Casa do Lago                             versão 7
┌──────────────────────────────────────────────────────────┐
│ DIÁRIAS                                                   │
│   Diária base            R$ [   500,00 ]                 │
│   Diária fim de semana   R$ [   650,00 ]                 │
│   Fim de semana é:  [ ] Dom [ ] Seg ... [x] Sex [x] Sáb  │
│                                                            │
│ VALORES FIXOS                                             │
│   Taxa de limpeza        R$ [   250,00 ]  (por estadia)  │
│                                                            │
│ HÓSPEDES                                                  │
│   Inclusos no valor      [ 6 ]                            │
│   Capacidade máxima      [ 8 ]                            │
│   Hóspede extra/noite    R$ [    50,00 ]                 │
│                                                            │
│ NOITES                                                    │
│   Mínimo padrão          [ 2 ]                            │
│   Máximo                 [ 60 ]  (limite do sistema)      │
├──────────────────────────────────────────────────────────┤
│ FERIADOS                                   [ + Adicionar ]│
│  Réveillon    29/12/2026 – 02/01/2027  R$1.200,00  mín 4 ⋮│
│ TEMPORADAS                                 [ + Adicionar ]│
│  Férias julho 01/07/2027 – 31/07/2027  R$  700,00  mín 3 ⋮│
├──────────────────────────────────────────────────────────┤
│ SIMULADOR                                                 │
│  Check-in [20/11/2026]  Check-out [23/11/2026]  [7] hósp.│
│                                                            │
│  Sex 20/11  fim de semana           R$   650,00           │
│  Sáb 21/11  fim de semana           R$   650,00           │
│  Dom 22/11  diária                  R$   500,00           │
│  1 hóspede extra × 3 noites         R$   150,00           │
│  Taxa de limpeza                    R$   250,00           │
│  TOTAL                              R$ 2.200,00           │
├──────────────────────────────────────────────────────────┤
│ ⚠ Réveillon e Ano Novo se sobrepõem em 01/01/2027.        │
│                                                            │
│  [ Reajustar em % ]   [ Ver histórico ]   [ Salvar ]      │
└──────────────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| Moeda | Prefixo `R$` visível; nunca pedir centavos |
| Simulador | Atualiza a cada mudança, **sem salvar** |
| Avisos | Faixa amarela; não bloqueiam |
| Erros | Vermelho no campo; bloqueiam |
| Reajuste em % | Pré-visualização antes/depois antes de confirmar |
| Histórico | Lista das 5 versões com data, autor e botão de restaurar |
| Salvar | Explícito; sem autossalvamento |
| Rascunho | `localStorage` por casa |

## Segurança e privacidade

- Rotas só para admin autenticado.
- Validação por schema no servidor; o cliente nunca é fonte de verdade.
- Valores limitados por sanidade (R$ 100.000,00 por diária) — evita overflow e erro grosseiro.
- Nenhum dado pessoal envolvido.
- Log registra `casaId`, `versao` e `sub` do admin; **não** registra a tabela inteira
  (é informação comercial, e log tem retenção e acesso diferentes do banco).

## Critérios de aceite

- [ ] Preços são por casa.
- [ ] Todos os valores persistidos em centavos inteiros.
- [ ] A tela trabalha em reais com máscara.
- [ ] Diária base zero rejeitada.
- [ ] `fim < inicio` rejeitado.
- [ ] `hospedesInclusos > capacidadeMaxima` rejeitado.
- [ ] `maxNoites > 60` rejeitado.
- [ ] Sobreposição gera aviso e salva.
- [ ] Valor 10× a base gera aviso e salva.
- [ ] Período passado gera aviso.
- [ ] O simulador reflete a configuração **não salva**.
- [ ] Salvar marca `publicacaoPendente`.
- [ ] Reservas existentes **não** mudam de valor.
- [ ] A tela informa quantas reservas futuras existem.
- [ ] Histórico com 5 versões e restauração.
- [ ] Reajuste em % tem pré-visualização.
- [ ] Edição concorrente gera `409 CONFLITO_VERSAO`.
- [ ] Casa sem preços válidos não pode ser ativada.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Salvar configuração válida | `200`; `versao` incrementada |
| 2 | Digitar `500,00` | Persistido `50000` |
| 3 | Digitar `500` | Persistido `50000` |
| 4 | Digitar `0,50` | Persistido `50` |
| 5 | Diária base `0` | `422` |
| 6 | Diária base `R$ 200.000,00` | `422` (limite de sanidade) |
| 7 | Temporada `fim < inicio` | `422` |
| 8 | `minNoites: 0` | `422` |
| 9 | `hospedesInclusos: 10`, capacidade 8 | `422` |
| 10 | `maxNoites: 90` | `422` |
| 11 | Dois feriados sobrepostos | `200` + aviso; cotação usa a maior diária |
| 12 | Diária de temporada 15× a base | `200` + aviso |
| 13 | Temporada de 2024 | `200` + aviso |
| 14 | Simulador com feriado | Diária de feriado nas noites corretas |
| 15 | Feriado 29/12–02/01, estadia 31/12–02/01 | Noites 31 e 01 com diária de feriado |
| 16 | Salvar | `publicacaoPendente: true` |
| 17 | Reserva criada antes do reajuste | Valor inalterado |
| 18 | Resposta do `PUT` | `reservasFuturasAfetadas` correto |
| 19 | Reajuste de 10% | Todas as diárias com `Math.round` correto |
| 20 | Restaurar versão anterior | Valores voltam; nova versão criada |
| 21 | `PUT` com `versao` antiga | `409` |
| 22 | Ativar casa com preços inválidos | `422` |
| 23 | Nenhum `float` no item do banco | Todos os valores inteiros |
