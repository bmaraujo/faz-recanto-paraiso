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

Só existe, por ora, o mínimo da Fase 0 (nenhum recurso AWS ainda no ar):

| Item | Situação |
|---|---|
| `handlers/api-publica.ts` — `GET /api/saude` | ✅ |
| `lib/config.ts`, `lib/http.ts` | ✅ |
| `lib/db.ts`, `lib/ses.ts`, `lib/ssm.ts`, `lib/s3.ts`, `lib/ical.ts`, `lib/auth.ts`, `lib/log.ts`, `lib/erros.ts` | ⬜ |
| `domain/` (reexportado de `@recanto/shared`) | ⬜ — nasce com a primeira rota que precisar dele |
| ESLint com `eslint-plugin-import`/`no-restricted-paths` | ⬜ — hoje não há `domain/` nem `lib/` o bastante para a regra ter algo real para verificar; entra junto com o primeiro par `domain/`+`lib/` |
| `test/integracao/` (DynamoDB Local) | ⬜ — primeira rota a precisar de banco é `GET /api/casas` |
| `handlers/api-admin.ts`, `cron-diario.ts`, `cron-ical.ts`, `publicar-conteudo.ts` | ⬜ |
| `templates/` | ⬜ |
