# Recanto Paraíso — Site de aluguel de casas de temporada

Site de divulgação e **controle de disponibilidade** das casas da fazenda Recanto Paraíso.

O site **não processa pagamentos**. Ele serve para:

1. Divulgar as casas (fotos, comodidades, localização, regras).
2. Mostrar a disponibilidade real de cada casa.
3. Calcular o valor estimado da estadia.
4. Receber **solicitações de reserva** que seguram as datas por um prazo.
5. Colocar o interessado em contato com o administrador (WhatsApp / e-mail), que negocia e recebe o pagamento **fora do site**.
6. Dar ao administrador um **backoffice** para cadastrar casas, fotos e preços, bloquear períodos, confirmar/recusar reservas e editar os textos dos e-mails.

## Documentação

A documentação completa está em [`docs/`](./docs/README.md). Comece por:

- [Contexto e objetivos](./docs/00-visao-geral/01-contexto-e-objetivos.md)
- [Escopo](./docs/00-visao-geral/02-escopo.md)
- [Casos de uso](./docs/02-casos-de-uso/README.md)
- [Arquitetura](./docs/03-tecnico/01-arquitetura.md)
- [Fases e critérios de aceite](./docs/06-planejamento/01-fases-e-criterios-de-aceite.md)
- [Pendências do proprietário](./docs/06-planejamento/02-pendencias-definir.md)

## Estrutura do repositório

```
/
├─ docs/              Documentação (negócio, casos de uso, técnico, operação, ADRs)
├─ infra/             Infrastructure as Code — AWS CDK (TypeScript)
├─ site/              Frontend público + SPA do backoffice (Astro)
├─ backend/           Lambdas (TypeScript)
├─ packages/shared/   Tipos e regras de domínio puras compartilhadas
└─ scripts/           Scripts de deploy, seed e manutenção
```

## Status

**Fase atual: 1 — Vitrine (iniciada).** Veja o
[plano de fases](./docs/06-planejamento/01-fases-e-criterios-de-aceite.md).

| Entrega | Situação |
|---|---|
| Monorepo com npm workspaces, TypeScript `strict`, Vitest | ✅ |
| ESLint (`eslint.config.mjs`) — regra de camadas `domain` não importa `lib`/AWS SDK | ✅ |
| `packages/shared` — aritmética de datas (`dominio/datas.ts`) | ✅ 47 testes |
| `packages/shared` — cotação e validação de preços (`dominio/precos.ts`) | ✅ 48 testes (UC-P03) |
| `packages/shared` — disponibilidade (`dominio/disponibilidade.ts`) | ✅ 27 testes (UC-P02) |
| `packages/shared` — schemas zod de preço, cotação e disponibilidade | ✅ 23 testes |
| `packages/shared` — Casa (`dominio/casas.ts` + `comodidades.ts` + schema) | ✅ 19 testes (UC-A02, parte pura) |
| `packages/shared` — formatação de moeda e instante ISO (`dominio/formato.ts`, `datas.ts`) | ✅ 14 testes (UC-P03) |
| `packages/shared` — telefone (E.164) e mascaramento de e-mail | ⬜ Fase 2 (UC-A13/UC-P04/UC-P05) |
| `backend` — workspace, esbuild, `GET /api/saude` | ✅ 6 testes |
| `backend` — `GET /api/casas/{id}/disponibilidade`, `lib/db.ts`, `domain/`, DynamoDB Local | ✅ 7 testes unidade + 5 integração (UC-P02) |
| `backend` — `POST /api/cotacao` | ✅ 11 testes unidade + 4 integração (UC-P03) |
| `backend` — demais rotas de Fase 1 (`casas`, `config-publica`) | ⬜ |
| `infra/`, `site/` | ⬜ |

O CDK ainda não foi iniciado porque depende das pendências
[8.1 (domínio) e 8.4 (região)](./docs/06-planejamento/02-pendencias-definir.md).

## Comandos (a implementar na Fase 0)

```bash
npm install                      # instala todos os workspaces
npm run build        -w backend  # compila/bundle das Lambdas
npm run test         -w backend  # testes unitários (Vitest)
npm run dev          -w site     # dev server do Astro
npm run build        -w site     # build estático
npx cdk diff         -w infra    # revisa mudanças de infraestrutura
npx cdk deploy       -w infra    # aplica a infraestrutura
npm run deploy:site             # build do site + s3 sync + invalidação CloudFront
```

## Custo-alvo

**Até US$ 3/mês na AWS**, excluindo domínio. Ver [custos](./docs/04-operacao/03-custos.md).
