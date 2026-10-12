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

**Fase atual: documentação.** Nenhum código implementado ainda.
Veja o [plano de fases](./docs/06-planejamento/01-fases-e-criterios-de-aceite.md).

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
