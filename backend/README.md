# backend — Lambdas (TypeScript)

Ver [docs/03-tecnico/01-arquitetura.md](../docs/03-tecnico/01-arquitetura.md).

## Regra de camadas (verificada por lint)

```
handlers/  →  domain/ + lib/
```

**`domain/` não importa `lib/` nem o AWS SDK.** É a única regra de dependência do
projeto, e é verificada por `eslint-plugin-import` com `no-restricted-paths` — não por
disciplina.

Toda regra de negócio testável fica em `domain/`, como função pura.

## Estrutura prevista

```
src/
  handlers/
    api-publica.ts         casas, disponibilidade, cotação, solicitações, .ics
    api-admin.ts           tudo do backoffice
    cron-diario.ts         expiração, conclusão, e-mails agendados
    cron-ical.ts           importação de calendários externos
    publicar-conteudo.ts   gera os JSONs e dispara o rebuild
  domain/
    precos.ts              calcularCotacao, validarConfigPrecos
    disponibilidade.ts     noites, livre/ocupada, agrupamento contíguo
    datas.ts               aritmética em America/Sao_Paulo, pt-BR
    reservas.ts            máquina de estados e transições
    cancelamento.ts        faixa e percentual sugerido
    templates.ts           validação e renderização de template
    formato.ts             moeda, data, telefone, mascaramento
  lib/
    db.ts ses.ts ssm.ts s3.ts ical.ts auth.ts log.ts erros.ts http.ts config.ts
  templates/
    variaveis.ts           allowlist de variáveis por código de e-mail
    <CODIGO>.md            texto padrão, um por código
test/
  unit/                    domain/ — sem mocks, sem I/O
  integracao/              DynamoDB Local em Docker
```

## Comandos

```bash
npm test                   # unidade (rápido, sem Docker)
npm run test:integracao    # sobe o DynamoDB Local
npm run test:coverage      # cobertura de domain/ precisa ser >= 95%
npm run build              # bundle com esbuild
```

## Regras não negociáveis

- Dinheiro sempre em **centavos inteiros**. Nunca `float`.
- Datas de estadia sempre `YYYY-MM-DD`. Fuso `America/Sao_Paulo`.
- A cotação é **sempre** recalculada no servidor.
- `domain/` é puro: sem `Date.now()` interno — a data atual entra como parâmetro.
- Nenhum `console.log` fora de `lib/log.ts` (regra de lint).
- Log sem e-mail, telefone, nome, valores ou token.
- Nenhum uso de `dynamodb:Scan` — a permissão não é concedida.

## Situação atual

Fase 0 completa; Fase 1 começou pela rota que menos depende de configuração ainda
não construída (só precisa de `Query` na tabela, sem preço nem admin):

| Item | Situação |
|---|---|
| `handlers/api-publica.ts` — `GET /api/saude` | ✅ |
| `handlers/api-publica.ts` — `GET /api/casas/{id}/disponibilidade` (UC-P02) | ✅ |
| `handlers/api-publica.ts` — `POST /api/cotacao` (UC-P03) | ✅ |
| `handlers/api-publica.ts` — `GET /api/config-publica` (UC-A13, RN14) | ✅ |
| `lib/config.ts`, `lib/http.ts`, `lib/db.ts` | ✅ |
| `domain/` (reexportado de `@recanto/shared`: `datas.ts`, `disponibilidade.ts`, `precos.ts`, `configGeral.ts`, `casas.ts`) | ✅ |
| ESLint com `eslint-plugin-import`/`no-restricted-paths` (raiz do repo, `eslint.config.mjs`) | ✅ — `domain/` não importa `lib/` nem o AWS SDK, verificado de verdade (não só documentado) |
| `test/integracao/` (DynamoDB Local via Docker Compose, `npm run test:integracao`) | ✅ — cobre disponibilidade, cotação, config pública e todo o CRUD de casas (concorrência real na unicidade de slug, no controle de versão — inclusive entre `PUT` e troca de status — e na ocupação futura que bloqueia exclusão) |
| `lib/auth.ts` (`exigirAdmin`, UC-A01) + `lib/erros.ts` (`ErroHttp`) | ✅ |
| `handlers/api-admin.ts` — CRUD completo de casas: `POST`/`PUT`/`GET`/`DELETE /api/admin/casas{,/{casaId}}` + `POST .../status` (UC-A02) | ✅ — `lib/db.ts#criarCasa`/`atualizarCasa`/`alterarStatusCasa`/`listarCasas`/`excluirCasa`/`existeOcupacaoFutura` fazem as escritas e leituras (slug + casa + preços padrão na criação; versão otimista e troca de slug na edição, RN4/E9; incremento atômico de versão na troca de status, RN7; listagem via `GSI1`; RN14 real antes de excluir) |
| `lib/s3.ts` (`criarPresignedPostFoto`/`obterMetadadosObjeto`/`lerInicioObjeto`/`apagarObjeto`, UC-A03) | ✅ |
| `domain/fotos.ts` (`detectarTipoPorMagicNumber` RN13, `extrairDimensoes` RN14 via `image-size`) | ✅ — pura, zero mock, não é reexport de `@recanto/shared` (UC-A03 é só do backend) |
| `handlers/api-admin.ts` — `POST .../casas/{casaId}/fotos/upload` (UC-A03, presigned POST) | ✅ — recusa a 41ª foto (RN1) antes de gerar a policy; chave via `construirChaveFoto` (RN10/RN11) |
| `handlers/api-admin.ts` — `POST .../casas/{casaId}/fotos` (UC-A03, registro) | ✅ — `HeadObject` + magic number + dimensões reais; `lib/db.ts#registrarFoto` fecha a corrida do limite de 40 com `size(fotos) < :limite` na condição da escrita |
| `handlers/api-admin.ts` — demais rotas de UC-A03 (ordem, edição, exclusão de foto) | ⬜ — próxima entrega |
| `lib/ses.ts`, `lib/ssm.ts`, `lib/ical.ts`, `lib/log.ts` | ⬜ |
| `handlers/api-publica.ts` — `GET /api/casas`, `GET /api/casas/{slug}` | ⬜ — próximas entregas da Fase 1 |
| `cron-diario.ts`, `cron-ical.ts`, `publicar-conteudo.ts` | ⬜ |
| `templates/` | ⬜ |
