# ADR-009 — Conteúdo no banco + publicação estática

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | **Diverge da especificação inicial** (que previa conteúdo em arquivos do repositório) |

## Contexto

Dois requisitos que se opõem:

1. O proprietário precisa **cadastrar casas, fotos e preços pelo backoffice**, sem
   depender de desenvolvedor (pedido explícito dele,
   [ADR-004](./ADR-004-multiplas-casas.md)).
2. O site precisa ser **estático** para custar centavos e ter SEO bom
   ([ADR-001](./ADR-001-hospedagem-estatica.md)).

Conteúdo editável em tempo de execução **versus** HTML gerado em tempo de build.

A especificação inicial resolvia isso não tendo o problema: *"Conteúdo editável em
arquivos do repositório (`src/content/*.md` e `src/data/casa.json`)"*. Com o backoffice
pedido, isso deixou de ser uma opção.

## Alternativas

| Opção | SEO | Autonomia | Complexidade | Custo |
|---|---|---|---|---|
| **Banco + rebuild por pipeline** | **Excelente** | **Total** | Média | ~US$ 0 |
| Conteúdo no repositório (spec inicial) | Excelente | **Nenhuma** | Muito baixa | US$ 0 |
| Banco + busca no cliente | **Ruim** | Total | Baixa | US$ 0 |
| Banco + SSR (Astro em Lambda) | Excelente | Total | Média-alta | ~US$ 0,50 + latência |
| Banco + ISR / revalidação | Excelente | Total | Alta | Precisaria de Vercel/Next |
| Banco + Lambda renderizando HTML | Bom | Total | **Alta** (renderizador próprio) | ~US$ 0 |

### Por que não busca no cliente

É a solução mais simples: um shell estático que busca `/_dados/casas/<slug>.json` e
renderiza no navegador.

Mata o SEO. O Google indexa JavaScript, mas com atraso, de forma inconsistente, e o
`<title>`, a meta description e o JSON-LD precisariam ser injetados no cliente — o que
não funciona bem para Open Graph (o scraper do WhatsApp e do Facebook não executa JS).

Como **o tráfego orgânico é o que substitui a comissão do Airbnb**, SEO é requisito de
negócio, não preferência técnica. Descartada.

### Por que não SSR

Astro com adaptador de Lambda renderizaria no servidor a cada requisição. SEO perfeito,
conteúdo sempre atual.

Custos: toda página passa a ser uma invocação de Lambda (cold start de ~500 ms no
primeiro acesso), o cache do CloudFront fica mais difícil de acertar, e o site deixa de
funcionar se o backend cair — perdendo a resiliência que é uma das principais vantagens
do ADR-001.

Para conteúdo que muda **algumas vezes por mês**, pagar renderização a cada visita é
desproporcional.

## Decisão

**Conteúdo no DynamoDB, publicado por um passo explícito que regera o site estático.**

```
Admin edita no backoffice  →  DynamoDB  →  [ Publicar ]  →  JSONs no S3
                                                          →  GitHub Actions
                                                          →  astro build
                                                          →  s3 sync
                                                          →  invalidação
```

E a divisão essencial:

| Conteúdo | Muda | Como é servido |
|---|---|---|
| Fotos, descrição, comodidades, regras, localização, textos legais | raramente | **Publicado** — HTML estático |
| Tabela de preços (exibição) | ocasionalmente | **Publicada** |
| **Disponibilidade** | sempre | **Dinâmica** — API, cache 60 s |
| **Cotação** | sempre | **Dinâmica** — API, sem cache |
| **Solicitação de reserva** | — | **Dinâmica** |

> A regra que resume: **o que vende é publicado, o que decide é dinâmico.**
>
> Publicar disponibilidade em arquivo estático seria o erro grave desta arquitetura —
> mostraria data ocupada como livre. Por isso ela nunca passa pela publicação.

### Por que o passo de publicar é explícito

Publicar a cada salvamento seria mais "mágico". É pior:

| Vantagem do passo explícito | Por quê |
|---|---|
| O admin edita em paz | Pode mexer em cinco casas e publicar uma vez |
| Validação em um ponto | É onde se garante que nenhuma casa ativa está incompleta |
| Menos builds | Cada publicação consome CI e invalidações |
| Reversível antes de ir ao ar | O site atual continua intacto até concluir |

### Por que GitHub Actions

| Opção | Custo | Veredito |
|---|---|---|
| **GitHub Actions** | Free tier (2.000 min/mês privado) | **Escolhida** |
| CodeBuild | ~US$ 0,005/min | Funciona, mas cobra |
| Lambda rodando o build | — | Astro + Node em Lambda com timeout de 15 min é frágil |
| Build local pelo desenvolvedor | US$ 0 | **Elimina a autonomia** — derrota o propósito |

## Consequências

### Positivas
- **Autonomia total** do proprietário sobre o conteúdo.
- **SEO de site estático**: HTML completo, `<title>`, Open Graph e JSON-LD no servidor.
- **Resiliência**: com a API fora do ar, a vitrine continua no ar; só o calendário e a
  cotação mostram erro.
- Custo praticamente zero.
- O passo explícito evita publicar meio-trabalho.
- Validação centralizada antes de o conteúdo ir ao público.
- Pré-visualização por casa permite conferir sem publicar.

### Negativas
- **Duas fontes de conteúdo para manter em sincronia**: o banco (verdade) e os JSONs
  publicados (cópia). Divergência é possível se uma publicação falhar no meio.
- **Latência de publicação**: 1 a 3 minutos entre salvar e aparecer no site. Precisa
  estar claro na interface, senão parece defeito.
- **Dependência do GitHub** no caminho de publicação. Se o Actions estiver fora, não se
  publica (mas o site continua no ar).
- **Mais peças**: Lambda `publicar-conteudo`, workflow, callback autenticado, estado de
  publicação, tratamento de publicação travada.
- **O admin precisa entender a diferença** entre o que vale na hora (regras de reserva)
  e o que precisa publicar (textos). Mitigado com ⚡ e 📄 na tela de configuração.
- **`s3 sync --delete` é perigoso** — sem `--exclude "midia/*"`, apaga todas as fotos.
  É o ponto mais destrutivo do projeto.
- Risco de injeção de comando no pipeline, se o `client_payload` fosse interpolado em
  shell (mitigado por `env:` e allowlist de `stage`).

### O que fica mais difícil
- Conteúdo que precise mudar imediatamente (não existe nesse escopo — e se existisse,
  iria pela API).
- Pré-visualizar o site **inteiro** antes de publicar (a pré-visualização é por casa).
- Rollback de conteúdo publicado: é republicar com o conteúdo anterior restaurado no
  backoffice, não um "voltar versão" do site.

## Mitigações

| Risco | Mitigação | Onde |
|---|---|---|
| Fotos apagadas pelo `--delete` | `--exclude "midia/*"` + comentário no script + teste de deploy | [UC-A14](../02-casos-de-uso/admin/UC-A14-publicar-site.md) caso 14 |
| Publicação falha | Site anterior intacto (o sync só roda após o build passar) | — |
| Publicação travada | `cron-diario` marca `FALHOU` após 10 min; a condição de concorrência também libera | — |
| Casa incompleta publicada | 7 validações bloqueantes, agrupadas por casa | [UC-A14](../02-casos-de-uso/admin/UC-A14-publicar-site.md) |
| Vazamento de campo interno nos JSONs | Gerador usa **allowlist** de campos, não denylist | — |
| Admin esquecer de publicar | Faixa persistente em todas as telas do backoffice | — |
| Injeção no pipeline | `client_payload` via `env:`; `stage` validado | — |
| Cota de invalidação | Invalidação por **prefixo** | — |

> A allowlist de campos no gerador é a mitigação mais importante: `enderecoCompleto` e
> `tokenIcal` ficam fora **por construção**, e um campo novo no modelo não vaza por
> esquecimento.

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| Latência de 1-3 min incomodar na prática | Publicação automática ao salvar, com debounce |
| Dependência do GitHub virar problema | CodeBuild (~centavos por publicação) |
| Conteúdo passar a mudar diariamente | SSR com Astro em Lambda, aceitando o custo |
| Astro ganhar ISR nativo com adaptador de Lambda | Avaliar — resolveria os dois lados |
| Free tier do Actions mudar | CodeBuild |
