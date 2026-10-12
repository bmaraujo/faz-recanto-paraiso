# 14 — Estratégia de testes

## Princípio: testar onde o erro custa dinheiro

Não buscamos cobertura uniforme. Buscamos cobertura **proporcional ao custo do erro**:

| Área | Custo de um bug | Cobertura-alvo |
|---|---|---|
| Cálculo de preço | Cobrar errado do hóspede | **~100%**, com teste de propriedade |
| Disponibilidade e concorrência | **Overbooking** — o pior defeito possível | **~100%**, com teste de integração real |
| Transições de estado | Reserva presa ou data travada | ~100% |
| Datas (fuso, noites, DTEND) | Um dia a mais ou a menos em tudo | **~100%** |
| Renderização de template | Injeção de HTML no e-mail | ~100% nos casos de escape |
| Handlers de API | Erro visível, corrigível | ~80% |
| Backoffice (UI) | Admin reclama, mas percebe | Testes de fluxo crítico |
| Site público (UI) | Perda de conversão | Lighthouse + smoke test |

## Pirâmide

```
            ┌──────────────┐
            │   E2E (3)    │   fluxos críticos, Playwright, contra dev
            ├──────────────┤
            │ Integração   │   DynamoDB Local em Docker: transações,
            │    (~25)     │   concorrência, invariantes
            ├──────────────┤
            │   Unidade    │   domain/ puro: preço, datas, estados,
            │   (~200)     │   templates, cancelamento
            └──────────────┘
      +  testes de infraestrutura (CDK assertions)
      +  Lighthouse CI no build do site
```

## Ferramentas

| Camada | Ferramenta |
|---|---|
| Unidade e integração | **Vitest** |
| Propriedade | **fast-check** (apenas no cálculo de preço e nas datas) |
| Banco local | **DynamoDB Local** via Docker Compose |
| Infraestrutura | `aws-cdk-lib/assertions` |
| E2E | **Playwright** |
| Performance / acessibilidade | **Lighthouse CI** |
| Cobertura | `vitest --coverage` (v8) |

## Unidade — `domain/`

Alvo: **toda** função de `backend/src/domain/`. Zero mocks, porque não há I/O.

| Arquivo | Casos obrigatórios |
|---|---|
| `precos.test.ts` | Os 17 casos de [regras de preço](../01-negocio/02-regras-de-preco.md) |
| `datas.test.ts` | Ver abaixo |
| `disponibilidade.test.ts` | Os 14 casos de [regras de disponibilidade](../01-negocio/01-regras-de-disponibilidade.md) |
| `reservas.test.ts` | Toda transição permitida e **toda** proibida |
| `cancelamento.test.ts` | Os 9 casos de [política de cancelamento](../01-negocio/04-politica-de-cancelamento.md) |
| `templates.test.ts` | Os 16 casos de [e-mails](./06-emails-e-templates.md) |
| `formato.test.ts` | Moeda, data, telefone, mascaramento |

### `datas.test.ts` — a base de tudo

Erros de data são os mais sorrateiros do sistema. Casos obrigatórios:

| # | Caso | Verifica |
|---|---|---|
| 1 | `noitesDe("2026-11-20", "2026-11-23")` | `["20","21","22"]` — check-out excluído |
| 2 | `noitesDe(d, d)` | `[]` |
| 3 | Virada de mês (30/11 → 02/12) | Noites corretas |
| 4 | Virada de ano (31/12 → 02/01) | Ano correto nas duas pontas |
| 5 | Ano bissexto (28/02/2028 → 01/03) | Inclui 29/02 |
| 6 | `hojeEmSaoPaulo()` às 23:30 BRT | Data **local**, não a de UTC (que já é o dia seguinte) |
| 7 | `hojeEmSaoPaulo()` às 00:30 BRT | Data local correta |
| 8 | `diaDaSemana("2026-11-20")` | `SEX` |
| 9 | `diferencaEmDias` atravessando mudança de horário | Correto (o Brasil não tem horário de verão hoje, mas o teste protege de uma volta) |
| 10 | Período inclusivo de bloqueio (10 a 15) | 6 noites |
| 11 | Período exclusivo de reserva (10 a 15) | 5 noites |
| 12 | `DTEND` do iCal | Exclusivo, igual ao check-out |
| 13 | Data inválida (`2026-02-30`) | Erro, não silenciosamente 01/03 |
| 14 | Formato inválido (`20/11/2026`) | Erro |

Os casos 10, 11 e 12 testam juntos as **três convenções** que coexistem no sistema.
É aqui que o bug mora.

### Teste de propriedade — a invariante de ouro

```ts
// Para qualquer configuração e qualquer estadia válida:
//   soma(detalhamento) === totalCentavos
test.prop([arbConfigPrecos(), arbEstadiaValida()])(
  "a soma do detalhamento é sempre igual ao total",
  (config, estadia) => {
    const c = calcularCotacao(config, estadia);
    if ("erro" in c) return;
    const soma = c.detalhamento.reduce((s, l) => s + l.valorCentavos, 0);
    expect(soma).toBe(c.totalCentavos);
  },
);
```

Outras propriedades que valem o esforço:

| Propriedade |
|---|
| `totalCentavos >= taxaLimpezaCentavos` (desconto nunca come a limpeza) |
| `totalCentavos` é inteiro ≥ 0 |
| Aumentar `hospedes` nunca diminui o total |
| Aumentar o número de noites nunca diminui o total |
| `noitesDe(a, b).length === diferencaEmDias(a, b)` |
| Toda cotação válida tem `detalhamento.length >= 2` (ao menos uma noite + limpeza) |

## Integração — DynamoDB Local

```yaml
# docker-compose.yml
services:
  dynamodb:
    image: amazon/dynamodb-local
    command: -jar DynamoDBLocal.jar -inMemory -sharedDb
    ports: ["8000:8000"]
```

Cada arquivo de teste cria a tabela com o mesmo schema do CDK, roda e destrói.
O schema vem de um módulo compartilhado (`test/esquema.ts`), para não divergir do
que o CDK cria — divergência aqui produz testes que passam e produção que quebra.

| Arquivo | Cobre |
|---|---|
| `solicitacao.test.ts` | Criação, transação, antiabuso, `409` |
| `concorrencia.test.ts` | Os 11 casos de [concorrência](./05-concorrencia-e-idempotencia.md) |
| `transicoes.test.ts` | Confirmar, recusar, cancelar, expirar, incluindo as corridas |
| `liberacao-noites.test.ts` | O caso da noite que mudou de dono |
| `cron-diario.test.ts` | Expiração, conclusão, idempotência de execuções repetidas |
| `ical.test.ts` | Import, diff, conflito, export, round-trip |
| `invariantes.test.ts` | I1–I9 após cada cenário |

### Como testar concorrência de verdade

```ts
// Não serializar com await em sequência — isso não testa nada.
const resultados = await Promise.allSettled([
  criarSolicitacao(dadosA),
  criarSolicitacao(dadosB),   // mesmas noites, mesma casa
]);

const sucessos = resultados.filter((r) => r.status === "fulfilled");
const conflitos = resultados.filter(
  (r) => r.status === "rejected" && r.reason.codigo === "DATAS_INDISPONIVEIS",
);
expect(sucessos).toHaveLength(1);
expect(conflitos).toHaveLength(1);
await verificarInvariantes();   // sempre, no fim
```

Para 10 requisições simultâneas, repetir o cenário **20 vezes** — uma corrida que
falha em 1 de 20 execuções é um bug real que um teste único não pega.

### `verificarInvariantes()`

Função compartilhada entre os testes e o [runbook](../04-operacao/02-runbook.md):
lê a tabela inteira (aceitável em teste e em manutenção pontual) e valida I1–I9,
retornando a lista de violações com detalhe suficiente para corrigir.

É a rede de segurança mais valiosa do projeto: qualquer refatoração de transação é
validada por ela.

## Testes de infraestrutura

Em `infra/test/`, com `aws-cdk-lib/assertions`. Ver
[12 — Infraestrutura](./12-infraestrutura-cdk.md#testes-de-infraestrutura).

Os quatro que **não podem faltar**:

1. `/api/solicitacoes/*` tem política de cache com TTL 0. *(vazamento de dados pessoais)*
2. A tabela de `prod` tem `RETAIN` e PITR. *(perda total de dados)*
3. Nenhuma policy tem `Action: "*"` ou `dynamodb:Scan`. *(privilégio excessivo)*
4. Nenhum recurso de custo recorrente alto no template. *(fatura surpresa)*

## E2E — Playwright

Apenas **três** fluxos, contra o ambiente `dev`:

| # | Fluxo |
|---|---|
| 1 | Visitante: abre a home → casa → escolhe datas → vê a cotação → solicita → vê a tela de acompanhamento |
| 2 | Admin: faz login → vê a solicitação no painel → confirma → a reserva aparece como confirmada |
| 3 | Admin: cria um bloqueio → a data fica indisponível no site público |

Por que só três: E2E é caro de manter e frágil. Esses três cobrem a ponta a ponta do
valor do sistema. O resto é coberto mais barato e mais rápido nas camadas de baixo.

Dados de teste: o fluxo 1 usa uma casa de teste e um e-mail `+teste@` descartável;
um `afterAll` limpa as reservas criadas.

## Lighthouse CI

No build do site, contra o `dist` servido localmente:

| Página | Mínimo |
|---|---|
| `/` | 90 em Performance, Acessibilidade, Melhores Práticas, SEO |
| `/casas` | 90 nas quatro |
| `/casas/<slug de exemplo>` | 90 nas quatro |

Perfil **mobile**, com throttling padrão. Abaixo de 90 **falha o build** — é critério
de aceite, não meta aspiracional.

## O que NÃO testamos

| Item | Por quê |
|---|---|
| SDK da AWS | É responsabilidade da AWS |
| Cognito (fluxo interno) | Serviço gerenciado; testamos a verificação do JWT |
| SES (entrega real) | Testamos a chamada e o conteúdo renderizado, com o cliente mockado |
| Renderização visual pixel a pixel | Custo de manutenção alto demais para o retorno |
| Astro (geração estática) | É o framework |

## Comandos

```bash
npm test                     -w backend          # unidade (rápido, sem Docker)
npm run test:integracao      -w backend          # sobe o DynamoDB Local
npm run test:coverage        -w backend
npm test                     -w infra            # testes de CDK
npm run test:e2e                                 # Playwright contra dev
npm run test:lighthouse      -w site
```

## Portão de qualidade

Nenhum código entra na `main` sem:

1. `npm test` verde em `backend` e `infra`.
2. `npm run test:integracao` verde.
3. Cobertura de `backend/src/domain/` ≥ 95% em linhas e branches.
4. `tsc --noEmit` sem erro (modo `strict`).
5. ESLint sem erro, incluindo as regras de arquitetura (`domain` não importa `lib`)
   e de log (`no-console`).
6. Lighthouse ≥ 90 quando o `site/` muda.

Os itens 3 e 5 são o que impede a erosão silenciosa: cobertura de domínio e fronteira
de camadas são as duas coisas que degradam primeiro em projeto pequeno sem revisor.
