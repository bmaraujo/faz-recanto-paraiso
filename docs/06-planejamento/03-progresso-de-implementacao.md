# 03 — Progresso de implementação

Registro do que já foi **construído em código** — diferente de
[01 — fases e critérios de aceite](./01-fases-e-criterios-de-aceite.md) (o que *deveria*
existir em cada fase) e de [02 — pendências do proprietário](./02-pendencias-definir.md)
(o que falta *decidir*, não construir).

Atualize este arquivo a cada entrega (um commit = uma entrega, por convenção deste
projeto). Sem isso, a única forma de saber "o que já existe" é reler código ou `git log`.

---

## Como ler esta tabela

- **Fase**: a fase do [plano](./01-fases-e-criterios-de-aceite.md) a que a entrega pertence.
- **UC**: caso de uso relacionado, quando houver.
- **Commit**: hash curto em `main`. Todos os commits até aqui foram mergeados por PR
  (o fluxo deste projeto é: implementar numa branch `feat/...`, revisar, mergear pela
  UI do GitHub — nunca `git push` direto para `main`).

| # | Data | Fase | UC | Entrega | Commit |
|---|---|---|---|---|---|
| 1 | 2026-10-12 | 0 | — | Monorepo (npm workspaces, TS `strict`, Vitest) + `dominio/datas.ts` | `62587e8` |
| 2 | 2026-10-12 | 0 | — | Região `sa-east-1` para dados; `PRICE_CLASS_ALL` no CloudFront (só o ACM em `us-east-1`) — [ADR-011](../adr/ADR-011-regiao-sa-east-1.md) | `9e29143` |
| 3 | 2026-10-12 | 1 | UC-P03 | `dominio/precos.ts` — `calcularCotacao`, `validarConfigPrecos` | `7a40776` |
| 4 | 2026-10-12 | 1 | UC-P03 | Correção de acentuação em `nomeDoDiaDaSemana` ("Sábado", "Terça-feira") | `5cffd56` |
| 5 | 2026-10-12 | 1 | UC-P02 | `dominio/disponibilidade.ts` — noites ocupadas, conflito, agrupamento contíguo | `42d4a8d` |
| 6 | 2026-10-12 | 1 | UC-P02/P03 | Schemas zod de preço, cotação e disponibilidade (`packages/shared/src/schemas/`) | `0ec878f` |
| 7 | 2026-10-12 | 1 | UC-A02 | Parte pura de Casa: slug, URL de mapa, gate de ativação (`dominio/casas.ts`) | `be89a36` |
| 8 | 2026-10-12 | 1 | UC-P03 | `dominio/formato.ts` — formatação de moeda | `b1cb6b4` |
| 9 | 2026-10-12 | 0 | — | Scaffold do workspace `backend/` + `GET /api/saude` | `4a90499` |
| 10 | 2026-10-12 | 1 | UC-P02 | `GET /api/casas/{id}/disponibilidade` + `lib/db.ts` + `domain/` + regra de ESLint de camadas + DynamoDB Local (Docker Compose) | `9e567be` |
| 11 | 2026-10-12 | 1 | UC-P03 | `POST /api/cotacao` — recalcula preço e disponibilidade no servidor | `3a0352a` |
| 12 | 2026-10-14 | 0 | — | Registro de progresso (este arquivo) | `2b502c6` |
| 13 | 2026-10-14 | 1 | UC-A13 | `GET /api/config-publica` — projeção pública de `CONFIG/GERAL` (RN14) + `obterConfigGeral` único em `lib/db.ts` (substitui `obterConfigGeralCotacao`) | _pendente_ |

**Estado em `main` agora:** `ceed1b4` (merge do PR #6). A entrega 13 está em branch própria,
ainda não mergeada.

---

## O que existe hoje, por pacote

### `packages/shared/` — 205 testes, 100% de cobertura em `dominio/`

| Módulo | Conteúdo |
|---|---|
| `dominio/datas.ts` | Aritmética de datas em `America/Sao_Paulo`: `noitesDe`, `noitesDePeriodoInclusivo`, `dtEndDeCheckout`, `hojeEmSaoPaulo`, `formatarDataPtBr`, `formatarInstanteIso` (ISO 8601 **com offset**, não `toISOString()`) |
| `dominio/precos.ts` | `calcularCotacao` (a mesma função do navegador e do servidor), `validarConfigPrecos` |
| `dominio/disponibilidade.ts` | `verificarDisponibilidade`, `listarNoitesOcupadas`, `noitesOcupadasEm`, `agruparNoitesContiguas`, `validarIntervaloConsulta` |
| `dominio/casas.ts` + `comodidades.ts` | Slug, URL de mapa permitida, completude para ativar (parte pura de UC-A02) |
| `dominio/formato.ts` | `formatarMoeda`, `formatarValorPorNoite` |
| `dominio/configGeral.ts` | Tipo `ConfigGeral` (forma do item completo) e `projetarConfigGeralPublica` — allowlist de RN14 (UC-A13). **Só forma**: a validação de escrita (RN1–RN16) nasce com a Fase 2 |
| `schemas/*.ts` | zod: forma de preço, cotação, disponibilidade e Casa — validação de **forma**, nunca de regra de negócio (essa fica em `dominio/`) |

**Ainda não construído:** telefone (E.164) e mascaramento de e-mail — propositalmente
adiado para a Fase 2, quando UC-A13/UC-P04/UC-P05 precisarem deles de verdade.

### `backend/` — 29 testes de unidade + 11 de integração (DynamoDB Local)

| Módulo | Conteúdo |
|---|---|
| `handlers/api-publica.ts` | `GET /api/saude`, `GET /api/casas/{id}/disponibilidade`, `POST /api/cotacao`, `GET /api/config-publica` |
| `domain/` | Reexporta de `@recanto/shared` (`datas.ts`, `disponibilidade.ts`, `precos.ts`, `configGeral.ts`) — nunca duplica lógica |
| `lib/db.ts` | Cliente DynamoDB (singleton de módulo), builders de chave, `obterStatusCasa`, `obterConfigPrecos` (valida forma com `configPrecosSchema`), `obterConfigGeral` (item completo, com padrão por campo), `consultarOcupacoes` (paginada) |
| `lib/config.ts`, `lib/http.ts` | Leitura de ambiente (`STAGE`/`VERSAO`), envelope de resposta/erro do contrato |
| `test/integracao/` | `disponibilidade.test.ts`, `cotacao.test.ts`, `config-publica.test.ts` — DynamoDB Local via Docker Compose, cada arquivo com seu próprio nome de tabela (`TABELA`) para rodar em paralelo sem colidir |

**Ainda não construído:** `lib/ses.ts`, `lib/ssm.ts`, `lib/s3.ts`, `lib/ical.ts`,
`lib/auth.ts`, `lib/log.ts`, `lib/erros.ts`; as rotas `GET /api/casas`,
`GET /api/casas/{slug}`; `handlers/api-admin.ts`,
`cron-diario.ts`, `cron-ical.ts`, `publicar-conteudo.ts`; `templates/`.

### `infra/`, `site/`

Nada implementado. O CDK depende da definição de domínio (pendência 8.1/8.2 — pode
seguir com os endereços padrão da AWS) e só compensa nascer quando houver mais que
uma Lambda para empacotar.

---

## Ferramental que nasceu junto com o código (não é "código do produto", mas sustenta ele)

| Item | Onde | Por quê |
|---|---|---|
| `eslint.config.mjs` (raiz) | Regra `domain` não importa `lib`/AWS SDK, verificada por `eslint-plugin-import` | Era só documentada antes de existir `lib/db.ts`; agora é checada de verdade |
| `docker-compose.yml` (raiz) + `backend/test/esquema.ts` | DynamoDB Local para teste de integração | Testar `Query`/`GetItem`/paginação contra mock não pegaria erro de `KeyConditionExpression` ou de schema de chave |
| `backend/scripts/test-integracao.mjs` | Sobe o Docker, espera a porta responder, roda os testes, derruba o container sempre (mesmo com falha) | `npm run test:integracao -w backend` |
| `backend/test/evento-teste.ts` | Factory de evento de Function URL (payload v2.0) compartilhada entre unidade e integração | Evita que as duas suítes divirjam no formato do evento |

---

## Decisões registradas durante a implementação (que não estavam nos ADRs antes)

Estas não têm ADR próprio porque são pequenas demais, mas ficam aqui para não se
perderem — se um dia pesarem o suficiente, promovem-se a ADR.

1. **Toda data/hora da API pública usa ISO 8601 com offset de `America/Sao_Paulo`**
   (ex.: `2026-10-11T18:04:00-03:00`), nunca `Date.prototype.toISOString()` (que
   devolve UTC). É o que `docs/03-tecnico/03-api-publica.md` já dizia, mas só ficou
   **verdade no código** quando `formatarInstanteIso` nasceu (commit `9e567be`) —
   até então `GET /api/saude` violava a própria convenção.
2. **`domain/` do backend nunca contém lógica própria, só reexporta de
   `@recanto/shared`.** Mantém uma única fonte de regra de negócio e um único ponto
   de importação para a regra de camadas verificar.
3. **Handlers importam zod direto de `@recanto/shared`**, mas funções de domínio
   sempre via `../domain/*`. Parsing de requisição é responsabilidade do handler
   (não é regra de negócio); a regra de camadas só protege `domain/` ↔ `lib/`.
4. **Itens do DynamoDB mais simples (um campo) não são revalidados com zod na
   leitura** (ex.: `status` da casa) — são dados internos, escritos pelo próprio
   sistema. **Itens complexos** (`CASA#<id>/PRECOS`, com temporadas e feriados
   aninhados) **são** validados com o schema zod existente antes de chegar em
   `calcularCotacao`, porque essa função não tem guarda própria contra formato
   inesperado e um item corrompido não pode virar erro de runtime vazando na resposta.
5. **Cada arquivo de teste de integração usa seu próprio nome de tabela**
   (`process.env.TABELA = "recanto-paraiso-test-<nome>"`) — os arquivos rodam em
   paralelo (workers do Vitest) contra o mesmo DynamoDB Local, e nomes compartilhados
   colidem em `CreateTable`.
6. **`vi.useFakeTimers()` em teste que faz I/O real precisa de `{ toFake: ["Date"] }`**,
   nunca a forma sem argumento — o SDK da AWS depende de `setTimeout` internamente
   (retry, keep-alive), e fakear timers globais trava a chamada de verdade.
7. **Campo de `ConfigGeral` sem padrão documentado cai no vazio do próprio tipo**
   (`""`, `[]`, `false`), nunca num valor inventado. Só quatro campos têm "padrão"
   de fato escrito em UC-A13 (`antecedenciaMinimaDias`, `janelaReservaMeses`,
   `horarioCheckin`, `horarioCheckout`); o resto — identidade, contato, política de
   cancelamento, textos legais — é conteúdo do proprietário, `[DEFINIR]` em
   [02 — pendências](./02-pendencias-definir.md), e nenhum desses tem um "certo" de
   sistema para supor.
8. **Uma única `obterConfigGeral()` em `lib/db.ts`, não uma por consumidor.**
   Existia um `obterConfigGeralCotacao()` que só projetava dois campos para
   `POST /api/cotacao`; foi removido em favor de uma função que devolve o item
   completo (com todos os padrões aplicados), e cada chamador pega os campos que
   precisa. Duas funções de leitura da mesma configuração divergiriam nos padrões
   com o tempo — o mesmo raciocínio de "uma função, duas fontes de dados" que já
   vale para `calcularCotacao` entre navegador e servidor.

---

## Questões abertas para a próxima entrega

Nada bloqueando — apenas decisões que valem uma segunda cabeça antes de continuar:

- **`GET /api/casas` e `GET /api/casas/{slug}` têm uma tensão não resolvida**: o
  [UC-P01](../02-casos-de-uso/publico/UC-P01-navegar-vitrine.md) descreve o site
  público como **estático**, gerado em build a partir de `_dados/*.json` (produzido
  pela Lambda `publicar-conteudo`, Fase 2) — "em tempo de execução, nenhuma chamada à
  API é necessária para o conteúdo". Mas
  [03 — API pública](../03-tecnico/03-api-publica.md) documenta as mesmas rotas como
  Lambdas vivas de Fase 1. Antes de implementar qualquer uma das duas, vale confirmar
  para que elas servem de fato nesse desenho (preview do admin antes de publicar? uso
  interno da própria `publicar-conteudo`? redundância a remover?). Além disso, ao
  contrário das três rotas já construídas, estas exigem um tipo `Casa` completo
  (nome, fotos, comodidades, descrição) que ainda não existe em `packages/shared` —
  é a rota mais cara da lista que resta na Fase 1.

### Resolvida nesta entrega

~~`GET /api/config-publica` emaranhado com UC-A13~~ — resolvido construindo só o
lado de leitura: `ConfigGeral` como tipo de forma (não o schema de validação de
escrita, que é RN1–RN16 e nasce com a Fase 2) mais a projeção `projetarConfigGeralPublica`.
Quando UC-A13 chegar, o tipo já existe e só ganha o schema zod de validação por cima.

## Comandos de referência

```bash
npm test                         # unidade, todos os workspaces
npm run test:coverage            # com cobertura (gate de 95% em dominio/domain/)
npm run test:integracao -w backend  # sobe Docker, roda, derruba
npm run typecheck                # tsc --noEmit, todos os workspaces
npm run lint                     # eslint . (raiz)
npm run build -w backend         # bundle esbuild das Lambdas
```
