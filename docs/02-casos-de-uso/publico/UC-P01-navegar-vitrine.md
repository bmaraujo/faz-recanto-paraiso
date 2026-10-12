# UC-P01 — Navegar na vitrine das casas

| Campo | Valor |
|---|---|
| Ator | Interessado (visitante anônimo) |
| Pré-condições | Existe ao menos uma casa `ATIVA` publicada |
| Gatilho | Visitante acessa `/`, `/casas` ou `/casas/<slug>` |
| Fase | 1 |
| Relacionados | [UC-A02](../admin/UC-A02-gerenciar-casas.md), [UC-A14](../admin/UC-A14-publicar-site.md), [11 — Frontend](../../03-tecnico/11-frontend.md) |

## Objetivo de negócio

É o caso de uso que **vende**. O visitante chega por busca ou indicação, está no
celular, e decide em poucos segundos se vale continuar. Se as fotos não carregarem
rápido ou a informação não estiver visível, ele volta para o Airbnb.

Três perguntas precisam ser respondidas **sem scroll** na página da casa:
quantas pessoas cabem, quanto custa a partir de, e está disponível.

## Fluxo principal

1. O visitante abre `/`.
2. A home mostra o hero com a melhor foto, o nome da fazenda e os cards das casas em
   destaque, cada um com foto principal, nome, capacidade, quartos e "a partir de R$ X".
3. O visitante clica em uma casa.
4. A página `/casas/<slug>` mostra, nesta ordem:
   - galeria (foto principal grande, miniaturas abaixo);
   - nome, capacidade, quartos, banheiros, "a partir de";
   - **calendário de disponibilidade e simulador de preço** ([UC-P02](./UC-P02-consultar-disponibilidade.md), [UC-P03](./UC-P03-simular-preco.md));
   - descrição;
   - comodidades com ícones;
   - camas por ambiente;
   - regras da casa;
   - localização resumida com link para `/localizacao`;
   - formulário de solicitação ([UC-P04](./UC-P04-solicitar-reserva.md));
   - FAQ e política de cancelamento resumida.
5. O visitante pode voltar para `/casas` e comparar.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Uma única casa cadastrada | A home leva direto ao conteúdo dela; `/casas` continua existindo mas sem destaque na navegação |
| A2 | Visitante chega direto em `/casas/<slug>` pelo Google | A página é completa e autossuficiente; não depende de ter passado pela home |
| A3 | Visitante filtra `/casas` por capacidade | Filtro **client-side** sobre os dados já carregados; sem ida ao servidor |
| A4 | Visitante abre a galeria | Lightbox com teclado (setas, Esc) e gesto de arrastar no celular |

## Fluxos de exceção

| # | Situação | Comportamento |
|---|---|---|
| E1 | Slug inexistente | Página `404` com link para `/casas`; status HTTP **404** (não 200) |
| E2 | Casa existe mas está `INATIVA` | `404`. Não revelar que existe |
| E3 | Casa foi despublicada depois de indexada no Google | `404` com sugestão das outras casas |
| E4 | `api-publica` indisponível | O conteúdo **continua visível** (é HTML estático). Só o calendário e a cotação mostram erro com botão de tentar novamente |
| E5 | Foto com `404` no S3 | Placeholder com a cor de fundo e o `alt`; não quebra o layout |

> E4 é a razão principal de o conteúdo ser estático: a vitrine funciona mesmo com o
> backend fora do ar.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Só casas com `status = ATIVA` aparecem no site público |
| RN2 | As casas são ordenadas pelo campo `ordem`; empate resolvido por `nome` |
| RN3 | "A partir de R$ X" = menor diária configurada (base, fim de semana, temporadas, feriados), **sem** taxa de limpeza |
| RN4 | Toda foto exibida tem `textoAlternativo` |
| RN5 | A foto `principal` é a primeira da galeria e a imagem de Open Graph |
| RN6 | Casa sem foto não pode estar `ATIVA` (validado na publicação — [UC-A14](../admin/UC-A14-publicar-site.md)) |
| RN7 | Nenhuma informação de contato de hóspede ou de reserva aparece na vitrine |
| RN8 | O endereço exibido é o **endereço público** (município/região), nunca o endereço exato — este vai só no `PRE_CHECKIN` |

> RN8 é uma decisão de segurança física: o endereço exato de uma casa que fica vazia
> parte do ano não deve estar indexado no Google.

## Contrato técnico

Páginas geradas no build a partir de `_dados/casas.json` e `_dados/casas/<slug>.json`
([09 — Publicação](../../03-tecnico/09-publicacao-de-conteudo.md)).
Em tempo de execução, nenhuma chamada à API é necessária para o conteúdo.

### Páginas geradas

| Rota | Fonte |
|---|---|
| `/` | `casas.json` (destaques) + `config.json` |
| `/casas` | `casas.json` |
| `/casas/<slug>` | `casas/<slug>.json` — uma página por casa `ATIVA` |
| `/sitemap.xml` | `casas.json` |

### SEO por página de casa

```html
<title>Casa do Lago — Recanto Paraíso | Aluguel de temporada</title>
<meta name="description" content="<resumo, até 155 chars>">
<link rel="canonical" href="https://<dominio>/casas/casa-do-lago">
<meta property="og:title"       content="Casa do Lago — Recanto Paraíso">
<meta property="og:description" content="<resumo>">
<meta property="og:image"       content="https://<dominio>/midia/.../fachada.webp">
<meta property="og:type"        content="website">
```

JSON-LD `VacationRental` por casa, com `name`, `description`, `image[]`,
`numberOfRooms`, `occupancy.maxValue`, `address` (só município/estado — RN8),
`amenityFeature[]` e `priceRange`.

> Não inclua `offers` com preço no JSON-LD: o preço varia por data e temporada, e um
> preço fixo no structured data gera inconsistência com o que o site mostra —
> o Google penaliza isso.

## Implementação

| Arquivo | O que faz |
|---|---|
| `site/src/pages/index.astro` | Home |
| `site/src/pages/casas/index.astro` | Lista |
| `site/src/pages/casas/[slug].astro` | `getStaticPaths()` a partir de `casas.json` |
| `site/src/components/publico/CardCasa.astro` | Card (estático, sem JS) |
| `site/src/components/publico/Galeria.tsx` | Ilha Preact, `client:visible` |
| `site/src/lib/conteudo.ts` | Leitura dos JSONs no build |

### Armadilhas

1. **`getStaticPaths` em tempo de build** precisa dos JSONs já no S3. Se a publicação
   nunca rodou, o build gera só as páginas estáticas. O build deve **falhar com
   mensagem clara** se `casas.json` não existir, não gerar um site vazio.
2. **Imagem LCP**: só a primeira foto da galeria leva `loading="eager"` e
   `fetchpriority="high"`. Marcar todas como `eager` destrói a performance.
3. **Filtro de `/casas`**: client-side sobre os dados já no HTML. Buscar da API ao
   filtrar adiciona latência sem ganho.
4. **Markdown**: `descricao` e `regras` já vêm como HTML sanitizado dos JSONs. A
   página **não** processa Markdown nem usa `set:html` em conteúdo não sanitizado.

## Interface

| Estado | Comportamento |
|---|---|
| Normal | Conteúdo completo, instantâneo (estático) |
| Galeria carregando | Miniaturas com `aspect-ratio` reservado; sem layout shift |
| Foto quebrada | Fundo neutro com o texto alternativo |
| Sem JS | Galeria mostra a foto principal e as miniaturas como links; todo o conteúdo legível |

> "Sem JS" não é purismo: é o que acontece de fato enquanto o JS carrega em 3G.
> O conteúdo tem de estar legível antes da hidratação.

## Segurança e privacidade

- Nenhum dado pessoal nas páginas públicas.
- Endereço exato ausente (RN8).
- Sem cookie, sem script de terceiro, sem pixel de rede social.
- CSP estrita; imagens só do próprio domínio.
- `rel="noopener noreferrer"` em todo link externo.

## Critérios de aceite

- [ ] A home lista as casas `ATIVA` ordenadas por `ordem`.
- [ ] Cada casa tem página própria em `/casas/<slug>` com HTML estático completo.
- [ ] Capacidade, quartos e "a partir de R$ X" visíveis sem scroll no celular.
- [ ] Slug inexistente retorna status **404**.
- [ ] Casa `INATIVA` ou `RASCUNHO` retorna 404.
- [ ] Toda imagem tem `alt`, `width` e `height`.
- [ ] Lighthouse mobile ≥ 90 nas quatro categorias em `/`, `/casas` e `/casas/<slug>`.
- [ ] `sitemap.xml` contém apenas casas `ATIVA`.
- [ ] JSON-LD válido pelo Rich Results Test.
- [ ] Com a `api-publica` desligada, o conteúdo continua visível.
- [ ] O endereço exato não aparece em nenhuma página pública.
- [ ] Galeria operável por teclado e por gesto.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | 3 casas ativas, 1 inativa | 3 na listagem |
| 2 | `/casas/inexistente` | 404 |
| 3 | `/casas/<slug de casa inativa>` | 404 |
| 4 | Casa com diária base 500 e fim de semana 650 | "a partir de R$ 500,00" |
| 5 | Casa com temporada a 400 | "a partir de R$ 400,00" |
| 6 | Foto principal | Primeira da galeria e `og:image` |
| 7 | Build sem `casas.json` | Build **falha** com mensagem clara |
| 8 | Galeria com Esc | Lightbox fecha |
| 9 | JS desabilitado | Conteúdo legível |
| 10 | Lighthouse em `/casas/<slug>` | ≥ 90 nas quatro |
| 11 | `sitemap.xml` após despublicar uma casa | Casa ausente |
| 12 | Endereço exato cadastrado | Ausente do HTML público |
