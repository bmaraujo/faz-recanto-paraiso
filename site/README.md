# site — Frontend (Astro)

Duas aplicações no mesmo domínio, com objetivos opostos:

| | Site público | Backoffice |
|---|---|---|
| Objetivo | SEO e velocidade no celular 3G | Produtividade do admin |
| Renderização | HTML estático gerado no build | SPA client-side |
| JavaScript | O mínimo possível, em ilhas | Necessário |
| Indexável | Sim | Não (`noindex`) |
| Rota | `/`, `/casas/*`, `/reserva/*` | `/admin/*` |

Ver [docs/03-tecnico/11-frontend.md](../docs/03-tecnico/11-frontend.md).

## Estrutura prevista

```
src/
  pages/
    index.astro
    casas/index.astro, casas/[slug].astro
    localizacao.astro
    reserva/[...id].astro
    regras.astro cancelamento.astro faq.astro privacidade.astro termos.astro
    404.astro
    admin/[...rota].astro          shell da SPA
  components/
    publico/   Galeria, Calendario, Cotacao, FormularioSolicitacao, BotaoWhatsApp, CardCasa
    admin/     uma pasta por tela
  layouts/     Base.astro, Pagina.astro, Admin.astro
  lib/         api.ts, auth.ts, imagem.ts, whatsapp.ts, formato.ts
  styles/      tokens.css, base.css
  data/exemplo/  dados de exemplo para desenvolvimento offline
public/        favicon, robots.txt, og-default.jpg
```

## Comandos

```bash
npm run dev                 # dev server
npm run build               # build estático
npm run test:lighthouse     # Lighthouse CI (>= 90 nas 4 categorias, mobile)
PUBLIC_API_MOCK=1 npm run dev   # desenvolvimento sem AWS
```

## Metas (critério de aceite)

Lighthouse **≥ 90** em Performance, Acessibilidade, Melhores Práticas e SEO, em
**mobile**, nas páginas `/`, `/casas` e `/casas/<slug>`.

O que sustenta a meta: **zero webfont** e **zero script de terceiro**. Qualquer pedido
de adicionar um widget externo precisa ser avaliado contra esse critério.
