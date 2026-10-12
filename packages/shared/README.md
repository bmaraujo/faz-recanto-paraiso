# @recanto/shared — Tipos e domínio compartilhados

Código usado tanto pelo `backend/` quanto pelo `site/`.

## O que fica aqui

| Conteúdo | Por quê |
|---|---|
| **Tipos** de todas as entidades | Uma definição, duas pontas |
| **Schemas zod** | A mesma validação no servidor e no formulário |
| `calcularCotacao` e `validarConfigPrecos` | O simulador do site usa a **mesma função** do servidor |
| Formatação de moeda, data e telefone (pt-BR) | Consistência entre tela e e-mail |
| Lista fechada de comodidades | Ícones e tradução consistentes |
| Aritmética de datas sobre `YYYY-MM-DD` | A fonte mais comum de bug do projeto |

## O que NÃO fica aqui

Nada que faça I/O: sem AWS SDK, sem `fetch`, sem acesso a arquivo. Este pacote é
**puro** e roda igual no Node e no navegador.

## Aviso importante

O simulador do navegador usar a mesma função do servidor é conveniente, **mas não
dispensa o recálculo no servidor**:

- O **cliente** executa com a configuração que veio publicada no HTML.
- O **servidor** executa com a configuração que ele lê do banco.

Mesma lógica, fontes de dados independentes. O cliente é um atalho de UX; o servidor é
a autoridade. Divergência entre os dois é **bug**, e em `dev` o cliente loga um aviso
no console quando os valores diferem.

## Decisões de implementação

### Este pacote é a única casa das regras puras

A documentação lista `calcularCotacao`, `datas` e afins tanto aqui quanto em
`backend/src/domain/`. Duas cópias da regra de preço seria o pior resultado possível,
então a implementação canônica mora **aqui**, em `src/dominio/`, e
`backend/src/domain/` apenas reexporta o que os handlers usam. A regra arquitetural
continua valendo: nada em `src/dominio/` faz I/O, importa `lib/` ou conhece o AWS SDK.

Os testes de unidade acompanham a implementação (`packages/shared/test/`), e é sobre
`src/dominio/**` que o portão de cobertura de 95% é medido.

### O pacote é consumido como código-fonte TypeScript

`exports` aponta para os `.ts`, sem passo de build. Todos os consumidores são
bundlers (esbuild no `backend`, Vite/Astro no `site`, Vitest nos testes), então um
artefato compilado intermediário só adicionaria uma etapa que pode ficar velha.
Por isso os imports internos são sem extensão.
