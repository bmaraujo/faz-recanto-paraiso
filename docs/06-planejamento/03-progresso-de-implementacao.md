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
| 13 | 2026-10-14 | 1 | UC-A13 | `GET /api/config-publica` — projeção pública de `CONFIG/GERAL` (RN14) + `obterConfigGeral` único em `lib/db.ts` (substitui `obterConfigGeralCotacao`) | `fe41158` |
| 14 | 2026-10-14 | 0 | UC-A01 | `infra/` nasce: stacks `dados` (DynamoDB + SSM) e `auth` (Cognito User Pool, App Client, domínio, grupo `admin`), com testes de infraestrutura (`aws-cdk-lib/assertions`) | `7374dcc` |
| 15 | 2026-10-14 | 1 | UC-A01 | `backend/src/lib/auth.ts` (`exigirAdmin`) + `lib/erros.ts` (`ErroHttp`) — verifica o JWT do Cognito, testado com JWKS de teste local via `cacheJwks` | `70bc948` |
| 16 | 2026-10-17 | 1 | UC-A02 | Tipo `Casa` completo (`Foto`, `Cama`, `Localizacao`, `Distancia`, `StatusCasa`) em `dominio/casas.ts`; `ESTADOS_CASA` extraído como fonte única do enum, compartilhado com `statusCasaSchema` | `a60bc95` |
| 17 | 2026-10-17 | 1 | UC-A02 | `POST /api/admin/casas` — `handlers/api-admin.ts` nasce; `lib/db.ts#criarCasa` (transação com unicidade de slug, RN3); `decodificarCorpo` movido para `lib/http.ts`, compartilhado com `api-publica.ts` | `b17ca47` |
| 18 | 2026-10-17 | 1 | UC-A02 | `PUT /api/admin/casas/{casaId}` (E9, RN4) — `lib/db.ts#obterCasa`/`atualizarCasa`; `ehEdicaoDeSlugPermitida` (RN4) em `dominio/casas.ts`; `casaArmazenadaSchema`/`fotoSchema` validam a forma na leitura | `70b1f6c` |
| 19 | 2026-10-17 | 1 | UC-A02 | `POST /api/admin/casas/{casaId}/status` — fecha o ciclo `RASCUNHO`→`ATIVA`↔`INATIVA`; `lib/db.ts#alterarStatusCasa` incrementa `versao` atomicamente; `avaliarCompletudeParaAtivar` (RN7) valida antes de `ATIVA` | `e9638e6` |
| 20 | 2026-10-17 | 1 | UC-A02 | `GET /api/admin/casas` (lista, via `GSI1`) e `GET /api/admin/casas/{casaId}` (detalhe) — `lib/db.ts#listarCasas`; `completa`/`temPrecos` calculados na resposta, `reservasAtivas` fixo em `0` até existir reserva de verdade | `0e1658a` |
| 21 | 2026-10-17 | 1 | UC-A02 | `DELETE /api/admin/casas/{casaId}` (RN14) — fecha o CRUD; `lib/db.ts#excluirCasa`/`existeOcupacaoFutura` (verificação real sobre `OCUPACAO#`, não um placeholder, mesmo sem reserva/bloqueio ainda escrevendo lá) | _pendente_ |

**Estado em `main` agora:** `71db149` (merge do PR #14, `GET /api/admin/casas{,/{casaId}}`).
A entrega 21 está em branch própria, ainda não mergeada. **Nenhum `cdk deploy` foi
executado ainda** — só `cdk synth`/`cdk diff` (somente leitura) contra a conta real
`627010764306`.

---

## O que existe hoje, por pacote

### `packages/shared/` — 213 testes, 100% de cobertura em `dominio/`

| Módulo | Conteúdo |
|---|---|
| `dominio/datas.ts` | Aritmética de datas em `America/Sao_Paulo`: `noitesDe`, `noitesDePeriodoInclusivo`, `dtEndDeCheckout`, `hojeEmSaoPaulo`, `formatarDataPtBr`, `formatarInstanteIso` (ISO 8601 **com offset**, não `toISOString()`) |
| `dominio/precos.ts` | `calcularCotacao` (a mesma função do navegador e do servidor), `validarConfigPrecos` |
| `dominio/disponibilidade.ts` | `verificarDisponibilidade`, `listarNoitesOcupadas`, `noitesOcupadasEm`, `agruparNoitesContiguas`, `validarIntervaloConsulta` |
| `dominio/casas.ts` + `comodidades.ts` | Slug, URL de mapa permitida, completude para ativar, `ehEdicaoDeSlugPermitida` (RN4) — parte pura de UC-A02; tipo `Casa` completo (`Foto`, `Cama`, `Localizacao`, `Distancia`, `StatusCasa`/`ESTADOS_CASA`) — a forma do item `CASA#<id>/META` persistido |
| `dominio/formato.ts` | `formatarMoeda`, `formatarValorPorNoite` |
| `dominio/configGeral.ts` | Tipo `ConfigGeral` (forma do item completo) e `projetarConfigGeralPublica` — allowlist de RN14 (UC-A13). **Só forma**: a validação de escrita (RN1–RN16) nasce com a Fase 2 |
| `schemas/*.ts` | zod: forma de preço, cotação, disponibilidade e Casa (`casaEntradaSchema`/`casaEdicaoSchema`/`casaArmazenadaSchema`, esta validando o item já persistido) — validação de **forma**, nunca de regra de negócio (essa fica em `dominio/`) |

**Ainda não construído:** telefone (E.164) e mascaramento de e-mail — propositalmente
adiado para a Fase 2, quando UC-A13/UC-P04/UC-P05 precisarem deles de verdade.

### `backend/` — 76 testes de unidade + 30 de integração (DynamoDB Local)

| Módulo | Conteúdo |
|---|---|
| `handlers/api-publica.ts` | `GET /api/saude`, `GET /api/casas/{id}/disponibilidade`, `POST /api/cotacao`, `GET /api/config-publica` |
| `handlers/api-admin.ts` | CRUD completo de casas (UC-A02): `POST`/`PUT`/`GET`/`DELETE /api/admin/casas{,/{casaId}}`, `POST .../{casaId}/status` — `exigirAdmin` é chamado antes de qualquer roteamento (RN8) |
| `domain/` | Reexporta de `@recanto/shared` (`datas.ts`, `disponibilidade.ts`, `precos.ts` incl. `validarConfigPrecos`, `configGeral.ts`, `casas.ts` incl. `avaliarCompletudeParaAtivar`) — nunca duplica lógica |
| `lib/db.ts` | Cliente DynamoDB (singleton de módulo), builders de chave, `obterStatusCasa`, `obterCasa`/`listarCasas`/`atualizarCasa`/`alterarStatusCasa`/`excluirCasa`/`existeOcupacaoFutura` (UC-A02, valida forma com `casaArmazenadaSchema`), `obterConfigPrecos` (valida forma com `configPrecosSchema`), `obterConfigGeral` (item completo, com padrão por campo), `consultarOcupacoes` (paginada), `criarCasa` (`TransactWriteItems` com unicidade de slug, RN3) |
| `lib/config.ts`, `lib/http.ts` | Leitura de ambiente (`STAGE`/`VERSAO`), envelope de resposta/erro do contrato, `decodificarCorpo` (compartilhado por toda rota que recebe JSON) |
| `lib/auth.ts` (`exigirAdmin`, `criarVerificadorAdmin`) + `lib/erros.ts` (`ErroHttp`) | Verificação do JWT do Cognito (UC-A01) — `aws-jwt-verify`. Consumida por `handlers/api-admin.ts` |
| `test/integracao/` | `disponibilidade.test.ts`, `cotacao.test.ts`, `config-publica.test.ts`, `admin-casas.test.ts` — DynamoDB Local via Docker Compose, cada arquivo com seu próprio nome de tabela (`TABELA`) para rodar em paralelo sem colidir |

**Ainda não construído:** `lib/ses.ts`, `lib/ssm.ts`, `lib/s3.ts`, `lib/ical.ts`,
`lib/log.ts`; as rotas `GET /api/casas`, `GET /api/casas/{slug}`;
`cron-diario.ts`, `cron-ical.ts`, `publicar-conteudo.ts`; `templates/`. UC-A02
(CRUD de casas) está completo.

### `infra/` — 29 testes (`aws-cdk-lib/assertions`), nada deployado ainda

| Stack | Conteúdo |
|---|---|
| `stack-dados` | Tabela única (`PK`/`SK`, GSI1, TTL, `PAY_PER_REQUEST`) + parâmetro SSM `site-url` |
| `stack-auth` | Cognito User Pool (RN1–RN3), App Client (Authorization Code + PKCE, RN4, sem segredo), domínio Hosted UI, grupo `admin` |

Config por stage em `config/dev.ts`/`config/prod.ts` (PITR, deletion protection,
`RemovalPolicy` da tabela, `siteUrl` para os callbacks do Cognito). `siteUrl` de
`dev` aponta para `localhost:4321` — não há `stack-frontend` (CloudFront) ainda para
dar um domínio real.

**Ainda não construído:** `stack-backend` (Lambdas, Function URLs, IAM,
EventBridge), `stack-frontend` (S3, CloudFront, ACM), `stack-observabilidade`
(alarmes, Budgets, SNS); nenhum `cdk deploy` foi executado — só `synth`/`diff`
(somente leitura).

### `site/`

Nada implementado.

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
9. **`CDK_DEFAULT_REGION` não pode decidir a região de nenhuma stack deste
   projeto.** O `cdk` CLI injeta essa variável a partir da região default do
   perfil AWS local (`aws configure get region`), que pode legitimamente ser
   `us-east-1` por preferência pessoal de quem está rodando — e nesse ambiente
   era. Um primeiro `cdk diff` sintetizou e tentou comparar contra `us-east-1`
   antes de isso ser percebido. Corrigido fixando `region: "sa-east-1"` (ADR-011)
   sem fallback de ambiente, mais uma guarda `exigirRegiaoFixa(this.region)` no
   construtor de cada stack que lança se algo reintroduzir a variável. Nenhum
   recurso chegou a ser criado — o erro só afetava `diff`/`synth` (somente leitura).
10. **CDK roda como Node puro, não por um bundler** — é o único pacote do
    monorepo assim, porque o `cdk` CLI executa `node dist/bin/app.js`
    diretamente. `tsconfig.build.json` usa resolução `NodeNext` só para
    `infra/`, o que exige extensão `.js` explícita em todo import relativo do
    pacote, mesmo apontando para um `.ts` — diferente do `Bundler` do resto do
    repo.
11. **`CDKMetadata` e `BootstrapVersion` saem do snapshot de infraestrutura.**
    Mudam com a versão do `cdk` CLI, não com uma decisão nossa — deixá-los
    dentro faria todo `npm update` de `aws-cdk`/`aws-cdk-lib` parecer uma
    mudança de infraestrutura no diff do snapshot.
12. **`Identidade` do admin autenticado carrega só `sub`, não `email`.** O
    pseudocódigo do UC-A01 sugere devolver os dois, mas o access token do
    Cognito (o que o front manda em `Authorization: Bearer`) **não tem** claim
    `email` — isso só existe no ID token. Como o único consumo documentado de
    identidade é log por `sub` (UC-A02: "nenhum conteúdo, só `casaId`, ação e
    `sub` do admin"), não há motivo para verificar o ID token também só por
    isso.
13. **`groups` não vai dentro de `CognitoJwtVerifier.create()`/`.verify()`,
    mesmo a lib aceitando.** Passar `groups: ["admin"]` ali faz um JWT válido
    sem o grupo falhar pelo **mesmo** caminho (mesma exceção) que um JWT
    forjado — os dois caem no mesmo `catch`. Isso perderia a distinção `401`
    (não autenticado) vs. `403` (autenticado, sem permissão) que o próprio
    contrato técnico do UC-A01 exige (E2). `exigirAdmin` verifica a assinatura
    primeiro, só depois confere `cognito:groups` manualmente.
14. **Teste de `lib/auth.ts` sem Cognito real**: `aws-jwt-verify` expõe
    `verificador.cacheJwks(jwks)` exatamente para isso — carrega um JWKS
    (gerado de um par de chaves RSA criado no próprio teste,
    `node:crypto.generateKeyPairSync`) no cache do verificador, e nenhuma
    chamada de rede acontece. Tokens de teste assinados com `jsonwebtoken`
    (devDependency). Mesmo princípio do DynamoDB Local: testar contra a
    biblioteca real, não contra um mock dela.
15. **`dominio/casas.ts` não importa `schemas/casa.ts`, mesmo com o tipo
    `Casa` (entidade persistida) e `CasaEntrada` (corpo validado por zod)
    compartilhando quase todos os campos.** A direção de dependência do
    pacote já era `schemas/` → `dominio/` (`schemas/casa.ts` importa
    `SLUG_REGEX`/`ehUrlDeMapaPermitida`/`tipoCamaSchema` de lá); inverter só
    para esses dois tipos criaria um ciclo. A duplicação de campos entre os
    dois tipos é o custo aceito — igual ao de `ConfigGeral`, que também não
    tem um schema de escrita correspondente ainda. `ESTADOS_CASA` (o array
    `["RASCUNHO", "ATIVA", "INATIVA"]`) saiu de `statusCasaSchema` para
    `dominio/casas.ts` para não duplicar a enumeração em si, só a forma do
    objeto.
16. **O verificador do Cognito em `api-admin.ts` nasce de forma *lazy*, não em
    escopo de módulo.** `criarVerificadorAdmin()` lança de forma síncrona se
    `USER_POOL_ID`/`USER_POOL_CLIENT_ID` não estiverem no ambiente (ver
    decisão 12-14); chamá-la no topo do arquivo quebraria a importação do
    handler em todo teste e no bundle do esbuild, onde essas variáveis não
    existem. `obterVerificadorAdmin()` guarda o resultado num `let` de módulo
    e só constrói na primeira invocação real — o container Lambda ainda
    reaproveita o cache de JWKS entre requisições, só adia a construção para
    quando o ambiente garantidamente já tem as variáveis.
17. **Preços padrão de uma casa nova não têm uma flag `validado` separada.**
    O contrato do UC-A02 menciona "`validado: false`" na criação, mas
    `ConfigPrecos` não tem esse campo — e não precisa: `diariaBaseCentavos: 0`
    já falha `validarConfigPrecos` por conta própria ("a diária base precisa
    ser maior que zero"), o que basta para `avaliarCompletudeParaAtivar`
    (RN7) saber que a casa não está pronta. Inventar um campo fora do tipo
    existente só para replicar uma frase do contrato seria duplicar uma
    informação que o próprio cálculo já produz.
18. **`handlers/api-admin.ts` testado com `exigirAdmin` mockado, tanto na
    unidade quanto na integração.** A verificação real do JWT (assinatura,
    `iss`, `client_id`, `cognito:groups`) já tem cobertura própria e real em
    `test/unit/lib/auth.test.ts` via `cacheJwks`; o teste de integração deste
    handler teria que recriar esse mesmo aparato só para autenticar, sem
    testar nada de autenticação que não esteja testado ali — o que importa
    testar contra o DynamoDB Local de verdade é a transação (`criarCasa`),
    não o `exigirAdmin` por cima dela de novo.
19. **ULID gerado pela biblioteca `ulid` (npm), não por um gerador próprio.**
    `ulidSchema` já documentava "bibliotecas de ULID geram em maiúsculas por
    convenção" antes de existir qualquer gerador — `ulid()` produz exatamente
    o formato de 26 caracteres Crockford base32 que o schema valida, sem
    dependências transitivas.
20. **RN4 ("slug imutável depois da primeira publicação") usa `status !==
    RASCUNHO` como proxy de "já publicada".** O modelo de dados não tem um
    campo dedicado para isso — e não teria como ter, já que "publicar" (UC-A14)
    ainda nem existe. Nenhum fluxo documentado de UC-A02 leva uma casa de volta
    a `RASCUNHO`, então a primeira vez que o status muda é, na prática, a
    primeira vez que a casa pode ter ido ao ar. Registrado como suposição
    explícita em `ehEdicaoDeSlugPermitida` — revisar quando UC-A14 nascer.
21. **`PUT /api/admin/casas/{casaId}` nunca aplica o `status` do corpo.**
    `casaEdicaoSchema` aceita os três valores de status porque o mesmo corpo
    serve à edição — mas isso não significa que `PUT` deva *aplicar* uma
    mudança de status: só `POST .../{casaId}/status` faz isso, e é o único
    lugar que valida RN7 (foto, texto alternativo, preços válidos) antes de
    permitir `ATIVA`. Deixar `PUT` mudar status sem essa validação seria uma
    porta para ativar uma casa incompleta pela rota errada. `PUT` sempre
    preserva o `status` já existente, ignorando o que vier no corpo — mesma
    postura de `POST` ignorando o `status` enviado na criação (RN1).
22. **`obterCasa`/`atualizarCasa` fazem a leitura-antes-da-escrita, mas a
    condição de verdade é sempre da escrita, nunca da leitura.** O handler lê
    a casa existente para saber o slug/status atuais (para decidir RN4 e
    montar o item), mas a proteção contra conflito (E9) é a
    `ConditionExpression: versao = :versaoAnterior` no próprio `PutItem`/
    `TransactWriteItems` — se outra escrita aconteceu entre a leitura e esta
    escrita, a condição falha e o handler nunca chega a usar dados obsoletos.
23. **Mudança de slug na edição reaproveita a transação de `criarCasa`, não
    uma função nova para "criar só o item de slug".** `Delete` do slug antigo
    (sem condição — o item sempre existe, foi criado junto com a casa) +
    `Put` do novo slug (condicionado, RN3) + `Put` da casa (condicionado à
    versão, E9) num único `TransactWriteItems`, com os índices do array
    mapeados de volta ao código de erro certo (`SLUG_EM_USO` vs.
    `CONFLITO_VERSAO`) a partir de `CancellationReasons`.
24. **`POST .../{casaId}/status` nunca aceita `RASCUNHO` como destino.** O UC
    não documenta um fluxo de "voltar a rascunho", e permitir isso quebraria
    a decisão 20: o proxy `status !== RASCUNHO` para "já publicada" (RN4) só
    funciona se nada jamais reverter o status para `RASCUNHO` depois que ele
    mudou pela primeira vez. Sem essa restrição aqui, seria possível desfazer
    RN4 em duas chamadas (status → `RASCUNHO`, depois `PUT` trocando o slug).
    Rejeitado com `400 ENTRADA_INVALIDA`, antes até de ler a casa do banco.
25. **`alterarStatusCasa` incrementa `versao` atomicamente
    (`versao = versao + :um`) em vez de receber uma `versaoAnterior` do
    chamador.** Esta rota não tem o conceito de "versão lida" que `PUT` tem —
    o corpo do contrato é só `{ status }`. Mas **ainda precisa** bater a
    versão, porque senão um `PUT` concorrente que leu a casa um instante
    antes da troca de status passaria sua própria condição de versão
    (inalterada) e sobrescreveria o status de volta ao valor antigo sem
    avisar ninguém — um "lost update" silencioso. Testado de verdade no
    `admin-casas.test.ts` (integração): troca de status, depois `PUT` com a
    versão de antes da troca → `409 CONFLITO_VERSAO`, nunca um `200` que
    desfaz a troca.
26. **`GET /api/admin/casas` paga um `GetItem` de preços por casa**, em vez de
    um `BatchGetItem` ou de guardar `completa`/`temPrecos` no próprio item.
    `completa`/`temPrecos` dependem de preços e fotos, que mudam em outros
    UCs (`PRECOS`, UC-A03) sem passar por este handler — guardá-los
    exigiria recalcular e regravar em toda escrita de preço ou foto, dois
    lugares a mais para esquecer. Calculá-los na leitura é uma função pura
    (`avaliarCompletudeParaAtivar`) sobre dados sempre atuais. O custo é um
    `GetItem` extra por casa na listagem — aceitável com o número de casas de
    uma única fazenda (poucas unidades), não escalaria para um catálogo
    grande, mas não é esse o problema que este projeto tem.
27. **`reservasAtivas` na listagem é hoje sempre `0`, escrito explicitamente,
    não omitido.** Não é um valor inventado: não existe UC-P04/solicitações
    (Fase 2) ainda, então não existe reserva nenhuma em lugar nenhum do
    sistema — `0` é o estado real, não uma suposição. Quando esse UC nascer,
    este campo passa a consultar de verdade (provavelmente via `GSI1` de
    reservas por casa).
28. **`GET /api/admin/casas` não reordena nada em código.** A ordem de
    exibição já é a ordem do `GSI1SK` (`<ordem padded>#<casaId>`) — a mesma
    razão de `indiceOrdemCasas` existir desde a entrega 17. Reordenar em
    memória depois de uma `Query` já ordenada seria trabalho redundante.
29. **`existeOcupacaoFutura` (RN14) é uma verificação real desde já, não um
    placeholder como `reservasAtivas`.** A diferença: `OCUPACAO#<casaId>` já
    é um mecanismo de dados completo (usado por UC-P02/P03 desde a Fase 1);
    só não existe *ainda* nenhum escritor (reserva, bloqueio, iCal) que
    grave um item lá. Checar `SK >= NOITE#<hoje>` com `Limit: 1` é código
    de produção de verdade, não uma suposição — no dia em que UC-P04 ou
    bloqueios nascerem e passarem a escrever `OCUPACAO#`, `DELETE
    /api/admin/casas/{casaId}` já respeita RN14 sem precisar de nenhuma
    mudança. `reservasAtivas` (decisão 27) é diferente: não há mecanismo
    de dados nenhum por baixo, só o número `0` por enquanto.
30. **`DELETE` não apaga fotos do S3 nem ocupações passadas em lote —
    e não é um corte de escopo silencioso.** O próprio UC descreve os dois
    como "best-effort", fora da transação principal. `lib/s3.ts` não existe
    (UC-A03); ocupações passadas hoje são sempre zero, pelo mesmo motivo da
    decisão 29. Quando qualquer um dos dois passar a existir, entra aqui
    como um passo best-effort depois da transação — não muda o contrato
    desta rota, só completa o que ela já promete fazer.
31. **`DELETE` responde `200` com `{ casaId }`, não `204 Nenhum Conteúdo`.**
    O UC não especifica o corpo da resposta. `204` é o convencional em REST
    para exclusão sem corpo, mas `respostaJson`/`respostaErro` sempre
    serializam um corpo — criar uma segunda forma de resposta só para este
    caso não compensava a consistência de toda a API responder sempre o
    mesmo formato `{...}`.

---

## Questões abertas para a próxima entrega

Nada bloqueando — apenas decisões que valem uma segunda cabeça antes de continuar:

- **Executar o primeiro `cdk deploy` de verdade.** Até agora só `synth`/`diff`
  (somente leitura) rodaram contra a conta real `627010764306`. Criar o User
  Pool e a tabela de `dev` é a próxima ação que efetivamente toca a nuvem —
  pedir confirmação explícita antes, por ser a primeira vez neste projeto.
- **Débito de documentação aberto pela correção do UC-P01** (ver "resolvida
  nesta entrega" abaixo): `UC-A14`, [09 — Publicação de conteúdo](../03-tecnico/09-publicacao-de-conteudo.md)
  e [11 — Frontend](../03-tecnico/11-frontend.md) ainda descrevem o site como
  gerado estaticamente a partir de `_dados/*.json`. Precisam ser revisados para
  refletir a API viva antes de `site/` nascer, senão quem implementar o
  frontend parte de um desenho que já não é o decidido.
- **UC-A02 (CRUD de casas) está completo.** Criação, edição, ativação,
  leitura e exclusão prontas (entregas 17-21). O próximo UC de backoffice
  é uma escolha nova — UC-A03 (fotos), UC-A04 (preços) e UC-A13 (config
  geral) são os candidatos mais próximos; nenhum tem código ainda além
  do que já existe em `packages/shared` (tipos/schemas).

### Resolvidas nesta entrega

- ~~`GET /api/config-publica` emaranhado com UC-A13~~ — resolvido construindo só o
  lado de leitura: `ConfigGeral` como tipo de forma (não o schema de validação de
  escrita, que é RN1–RN16 e nasce com a Fase 2) mais a projeção `projetarConfigGeralPublica`.
  Quando UC-A13 chegar, o tipo já existe e só ganha o schema zod de validação por cima.
- ~~Tensão entre `GET /api/casas`/`GET /api/casas/{slug}` e o UC-P01 estático~~ —
  decisão do proprietário: **o UC-P01 estava desatualizado**. O site consome a
  API viva, não `_dados/*.json` gerado em build. Corrigido o trecho mais
  enganoso do UC-P01 (E4 e o aviso que o acompanhava); o resto do documento e
  os três outros afetados (`UC-A14`, 09, 11) ficam como débito — ver acima.
- ~~UC-A01 com cabeçalho "Fase: 2"~~ — o plano mestre
  ([01 — fases](./01-fases-e-criterios-de-aceite.md)) já listava UC-A01 dentro
  do "Backoffice (mínimo)" da Fase 1; o cabeçalho do próprio UC-A01 e a tabela
  em [02-casos-de-uso/README.md](../02-casos-de-uso/README.md) estavam
  desalinhados com isso. Corrigidos os dois para "Fase 1".
- ~~UC-A02 exige UC-A01, que exige infraestrutura real~~ — decisão do
  proprietário: construir `infra/` (CDK) antes de continuar. Ver a entrega 14
  na tabela e a seção `infra/` acima.
- ~~`lib/auth.ts` do backend ainda não existe~~ — construído (entrega 15):
  `exigirAdmin` verifica o JWT do Cognito do `stack-auth`, com a distinção
  `401`/`403` correta (ver decisão 13) e testado sem Cognito real (decisão 14).
- ~~UC-A02 exige um tipo `Casa` completo que ainda não existe~~ — construído
  (entrega 16): `Casa`, `Foto`, `Cama`, `Localizacao`, `Distancia` e
  `StatusCasa`/`ESTADOS_CASA` em `dominio/casas.ts` (ver decisão 15).
- ~~`lib/auth.ts` existe, mas nenhum handler o usa ainda~~ — construído
  (entrega 17): `handlers/api-admin.ts` nasce com `POST /api/admin/casas`,
  chamando `exigirAdmin` antes de qualquer roteamento (RN8). `lib/db.ts#criarCasa`
  faz a transação de criação (slug, casa, preços padrão) e mapeia a condição
  de slug falhada para `409 SLUG_EM_USO` (ver decisões 16-19).
- ~~UC-A02 só tinha a rota de criação~~ — `PUT /api/admin/casas/{casaId}`
  construído (entrega 18): controle de versão otimista (E9) via
  `ConditionExpression`, `ehEdicaoDeSlugPermitida` (RN4) decidindo se a
  mudança de slug é permitida antes de qualquer escrita, e a mesma
  transação de `criarCasa` reaproveitada para trocar o índice de slug
  quando ele muda (ver decisões 20-23).
- ~~UC-A02 não fechava o ciclo RASCUNHO→ATIVA~~ — `POST
  .../{casaId}/status` construído (entrega 19): valida RN7
  (`avaliarCompletudeParaAtivar`) antes de `ATIVA`, nunca aceita `RASCUNHO`
  como destino (decisão 24, protege a suposição da decisão 20) e incrementa
  `versao` atomicamente para não criar um "lost update" contra um `PUT`
  concorrente (decisão 25).
- ~~UC-A02 não tinha rota de leitura~~ — `GET /api/admin/casas` (lista) e
  `GET .../{casaId}` (detalhe) construídos (entrega 20): a lista calcula
  `completa`/`temPrecos` na hora, via `GSI1` (que já traz a casa inteira,
  sem `GetItem` por item) mais um `GetItem` de preços por casa (decisão 26);
  `reservasAtivas` é `0` até existir reserva de verdade (decisão 27).
- ~~UC-A02 faltava a exclusão~~ — `DELETE /api/admin/casas/{casaId}`
  construído (entrega 21), fechando o CRUD: `existeOcupacaoFutura` (RN14)
  é uma verificação real sobre `OCUPACAO#<casaId>` (decisão 29), não um
  placeholder; a transação apaga casa, preços e slug juntos; limpeza de
  S3 e de ocupações passadas ficam como "best-effort" futuro, como o
  próprio UC já descreve (decisão 30).

## Comandos de referência

```bash
npm test                         # unidade, todos os workspaces
npm run test:coverage            # com cobertura (gate de 95% em dominio/domain/)
npm run test:integracao -w backend  # sobe Docker, roda, derruba
npm run typecheck                # tsc --noEmit, todos os workspaces
npm run lint                     # eslint . (raiz)
npm run build -w backend         # bundle esbuild das Lambdas
npm run synth -w infra           # cdk synth --context stage=dev (local, sem AWS)
npm run diff  -w infra           # cdk diff  --context stage=dev (AWS, somente leitura)
npm run deploy:dev -w infra      # cdk deploy --context stage=dev --all (TOCA a nuvem)
```
