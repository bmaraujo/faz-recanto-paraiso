# ADR-004 — Suportar múltiplas casas

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | **Diverge da especificação inicial** (que previa uma única casa) |
| **Decisor** | Proprietário |

## Contexto

A especificação inicial dizia: *"O proprietário tem uma fazenda e aluga **uma única
casa** por temporada"*, e colocava explicitamente fora de escopo *"múltiplas
propriedades / multi-tenant"*.

O proprietário pediu que o backoffice permita **cadastrar as casas** (plural), com
fotos e preços. Confirmado: o escopo é **N casas na mesma fazenda, com um único
proprietário**.

Não é multi-tenant: há um dono, um administrador, uma marca.

## Alternativas

| Opção | Esforço inicial | Custo de migrar depois |
|---|---|---|
| **N casas desde o início** | +15% no modelo e nas telas | — |
| 1 casa agora, generalizar depois | Menor | **Alto**: mudam as chaves do DynamoDB, as rotas da API, o modelo de preços e todas as telas; com dados em produção, exige migração escrita à mão |
| Multi-tenant completo (várias fazendas, vários donos) | +60% | — |

## Decisão

**Suportar N casas na mesma instalação**, com uma entidade `Casa` de primeira classe.

Multi-tenant (vários proprietários) **permanece fora de escopo**.

### O que a decisão implica no modelo

| Aspecto | Consequência |
|---|---|
| Entidade `Casa` | `CASA#<casaId>` com `META`, `PRECOS` e índice de slug |
| Ocupação | `OCUPACAO#<casaId> / NOITE#<data>` — a agenda é **por casa** |
| Preços | Item `PRECOS` **por casa**. Não existe tabela global |
| Bloqueios | Por casa, com opção de aplicar a todas |
| Reservas | `casaId` + `casaNome` denormalizado |
| API pública | `/api/casas`, `/api/casas/{slug}`, `/api/casas/{id}/disponibilidade` |
| Site | `/casas` e `/casas/<slug>`, uma página por casa |
| iCal | Um token e uma URL de export **por casa** |
| Agenda do admin | Uma linha por casa, lado a lado |
| Relatório | Por casa e consolidado |

### Por que a generalização é quase grátis

O custo real de "N casas" está concentrado na chave de ocupação:
`OCUPACAO#<casaId>` em vez de `OCUPACAO`. Tudo o mais — preços, páginas, agenda — é
consequência natural disso.

Fazer essa escolha **antes** de existirem dados custa uma linha de código. Fazê-la
depois custa migrar todos os itens de ocupação, todas as reservas e todas as rotas,
com o site no ar.

> Este é o caso raro em que "generalizar antes de precisar" é a decisão certa, porque o
> requisito **já é conhecido** — não é especulação sobre o futuro.

## Consequências

### Positivas
- Cadastrar a segunda casa é um formulário, não um projeto.
- Preços por casa permitem diferenciar tamanho e padrão.
- A vitrine com várias casas aumenta a chance de conversão (quem não cabe em uma, cabe
  em outra).
- Bloqueio e agenda por casa refletem a realidade da fazenda.
- O relatório mostra qual casa rende mais — informação que o proprietário não tem hoje.

### Negativas
- **Mais telas e mais navegação** no backoffice: escolher a casa é um passo a mais em
  quase toda operação.
- A agenda consolidada é mais complexa (uma `Query` por casa; uma linha por casa na
  tela).
- O site precisa de uma hierarquia a mais (`/casas` → `/casas/<slug>`).
- Com **uma só** casa cadastrada, a interface tem um passo desnecessário. Mitigado:
  quando há uma casa, a home leva direto ao conteúdo dela
  ([UC-P01](../02-casos-de-uso/publico/UC-P01-navegar-vitrine.md) A1).
- A agenda com muitas casas fica apertada no celular.

### O que fica mais difícil
- Nada significativo. A principal consequência é interface, não arquitetura.

## Limites explícitos

| Limite | Valor | Por quê |
|---|---|---|
| Casas por instalação | Sem limite rígido; **otimizado para até ~10** | Acima disso, a agenda consolidada faz N queries e a tela fica difícil |
| Proprietários | **1** | Não é multi-tenant |
| Fotos por casa | 40 | Limite do item do DynamoDB, com folga |
| Canais externos por casa | Sem limite prático | Uma configuração por casa × canal |

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| > 30 casas | Item agregado de agenda por mês; paginação na agenda |
| Pedido para gerenciar a fazenda de um terceiro | Aí sim, multi-tenant — e é uma reescrita do modelo de autorização, não um ajuste |
| Casas em locais diferentes (não na mesma fazenda) | Revisar a página de localização e o SEO (seria mais próximo de multi-propriedade) |
