# 11 — Frontend

Duas aplicações no mesmo domínio, com objetivos opostos:

| | Site público | Backoffice |
|---|---|---|
| Objetivo | SEO e velocidade no celular 3G | Produtividade do admin |
| Renderização | HTML estático gerado no build | SPA client-side |
| JavaScript | O mínimo possível, em ilhas | Necessário |
| Indexável | Sim | **Não** (`noindex` + `robots.txt`) |
| Rota | `/`, `/casas/*`, `/reserva/*` | `/admin/*` |

## Stack

| Item | Escolha | Motivo |
|---|---|---|
| Framework | **Astro** | Gera HTML estático por padrão; JS só onde se pede (ilhas) |
| Ilhas interativas | **Preact** | ~4 KB contra ~45 KB do React; API praticamente igual |
| Estilos | CSS com custom properties + poucos utilitários próprios | Um site de 8 páginas não justifica Tailwind no bundle |
| Datas | Funções próprias em `packages/shared` | `date-fns`/`luxon` pesam; precisamos de ~8 funções sobre strings `YYYY-MM-DD` |
| Formulários | HTML nativo + validação com os schemas zod compartilhados | Zero dependência de formulário |
| Backoffice | Preact + Preact Router | Mesma stack das ilhas; nada novo para aprender |
| Build | `astro build` | |

> Sem Tailwind é uma escolha deliberada e discutível. O ganho é bundle de CSS menor e
> nenhuma etapa de build extra; o custo é escrever CSS à mão. Como o site tem poucas
> telas e um design definido, o ganho vence. **Se o backoffice crescer, Tailwind
> apenas em `/admin` é uma mudança aceitável** — o CSS do admin não afeta o Lighthouse
> do site público.

## Páginas públicas

| Rota | Conteúdo | Gerada |
|---|---|---|
| `/` | Hero, casas em destaque, diferenciais, depoimentos, CTA | no build |
| `/casas` | Lista de todas as casas ativas, com filtro por capacidade | no build |
| `/casas/[slug]` | Detalhe: galeria, comodidades, camas, regras, preços, calendário, formulário | no build, uma por casa |
| `/localizacao` | Mapa, como chegar, estrada, distâncias, sinal de celular | no build |
| `/reserva/[id]` | Acompanhamento da solicitação | shell estático + dados via API |
| `/regras`, `/cancelamento`, `/faq`, `/privacidade`, `/termos` | Textos legais | no build |
| `/404` | Página de erro | no build |

O formulário de reserva **fica na página da casa**, não em uma página separada: cada
clique a mais é um visitante perdido, e a casa já está escolhida.

## Ilhas interativas

| Ilha | Onde | Responsabilidade |
|---|---|---|
| `Galeria` | `/casas/[slug]` | Lightbox com teclado e gesto de arrastar |
| `Calendario` | `/casas/[slug]` | Busca a disponibilidade, marca noites ocupadas, seleciona intervalo |
| `Cotacao` | `/casas/[slug]` | Recalcula o valor localmente a cada mudança; confirma no servidor no envio |
| `FormularioSolicitacao` | `/casas/[slug]` | Validação, honeypot, `POST`, tratamento de erro |
| `Acompanhamento` | `/reserva/[id]` | Busca com o token, exibe o estado, permite desistir |
| `BotaoWhatsApp` | todas | Flutuante, com mensagem pré-preenchida pelo contexto |

Diretiva de hidratação: `client:visible` para `Galeria` e `Calendario`
(não hidratam até entrar na tela) e `client:load` para `FormularioSolicitacao`.

### `Calendario` — o componente mais importante

```
Requisitos:
- toque confortável no celular (alvos de 44 px)
- noites ocupadas visivelmente indisponíveis, não apenas em cinza claro
- seleção de intervalo em dois toques (check-in, depois check-out)
- mostrar 2 meses no desktop, 1 no celular
- desabilitar datas fora de [hoje + antecedência, hoje + janela]
- feedback imediato: ao selecionar, mostrar a cotação sem esperar o servidor
- acessível por teclado (setas, Enter, Esc) e com rótulos ARIA em pt-BR
- indicar visualmente o mínimo de noites quando a seleção for curta
```

Carregamento: ao hidratar, busca `de = hoje` até `ate = hoje + 3 meses`; ao navegar
para um mês ainda não carregado, busca os 3 meses seguintes e acumula em memória.
Não buscar 13 meses de uma vez — é payload desnecessário no 3G.

Estado de carregamento: o calendário aparece com os dias **desabilitados e um
indicador de carregamento**, nunca com todos habilitados. Mostrar tudo disponível
enquanto carrega faria o usuário selecionar uma data ocupada e tomar um erro.

### `Cotacao` — local e no servidor

```
usuário muda as datas ou os hóspedes
   │
   ├─▶ calcularCotacao(...) de packages/shared  → atualiza a tela na hora (0 ms)
   │
   └─▶ (no envio) POST /api/cotacao → confirma; se divergir, mostra o valor do servidor
```

O cálculo local existe para a tela responder instantaneamente. O servidor é a
autoridade. Divergência entre os dois é **bug**, e deve ser detectada: em `dev`, o
cliente loga um aviso no console quando os valores diferem.

## Backoffice (`/admin`)

SPA em Preact, carregada por um `index.html` em `/admin/`, com roteamento client-side.

| Tela | Rota | UC |
|---|---|---|
| Painel | `/admin` | [A06](../02-casos-de-uso/admin/UC-A06-ver-agenda.md) |
| Agenda (calendário) | `/admin/agenda` | A06 |
| Reservas (lista) | `/admin/reservas` | A06 |
| Reserva (detalhe) | `/admin/reservas/:id` | A07, A08, A09, A10 |
| Nova reserva manual | `/admin/reservas/nova` | [A11](../02-casos-de-uso/admin/UC-A11-criar-reserva-manual.md) |
| Casas (lista) | `/admin/casas` | [A02](../02-casos-de-uso/admin/UC-A02-gerenciar-casas.md) |
| Casa (editar) | `/admin/casas/:id` | A02, A03, A04 |
| Bloqueios | `/admin/bloqueios` | [A05](../02-casos-de-uso/admin/UC-A05-gerenciar-bloqueios.md) |
| E-mails | `/admin/emails` | [A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md) |
| Configuração | `/admin/config` | [A13](../02-casos-de-uso/admin/UC-A13-configuracao-geral.md) |
| Relatório | `/admin/relatorio` | [A15](../02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md) |
| Canais externos | `/admin/canais` | [A16](../02-casos-de-uso/admin/UC-A16-sincronizar-ical.md) |
| Callback do login | `/admin/callback` | [A01](../02-casos-de-uso/admin/UC-A01-autenticar.md) |

### Padrões obrigatórios do backoffice

| Padrão | Regra |
|---|---|
| **Nunca travar** | Toda ação mostra estado de carregamento no próprio botão; a tela nunca congela |
| **Erro acionável** | Toda falha mostra o que aconteceu e o que fazer, nunca "Erro inesperado" |
| **Confirmação destrutiva** | Cancelar reserva, excluir casa, excluir foto e rotacionar token iCal exigem confirmação que **nomeia o alvo** ("Cancelar a reserva de Maria Silva, 20–23/11?") |
| **Otimismo seletivo** | Reordenar fotos e marcar principal atualizam a tela na hora (baixo risco). Confirmar, recusar e cancelar **esperam** a resposta (alto risco) |
| **Autossalvamento** | Nenhum. Salvar é explícito, com botão. Autossalvar preço é perigoso |
| **Rascunho local** | Formulários longos (casa, template) guardam rascunho no `localStorage` por id, e oferecem restaurar ao reabrir depois de uma queda |
| **Fuso** | Toda data/hora exibida já vem formatada do servidor em `America/Sao_Paulo` |
| **Mobile** | O painel, a agenda e a tela de reserva precisam funcionar bem no celular — é onde o admin decide |

### Tratamento de erro padronizado

```
401  → renova o token; se falhar, redireciona para o login preservando a rota
403  → "Sua conta não tem permissão." (não deveria acontecer com um admin)
409  → recarrega o recurso e mostra o estado atual:
        "Esta solicitação já foi confirmada por você em 11/10 às 15h30."
422  → marca os campos com erro e mostra as mensagens
429  → "Muitas tentativas. Aguarde um instante."
5xx / rede → "Não conseguimos falar com o servidor." + botão Tentar novamente
timeout (10 s) → mesma mensagem; nunca spinner infinito
```

O caso `409` é o mais importante: com um único admin que pode ter duas abas abertas,
"o estado mudou" é o conflito real do dia a dia, e precisa ser explicado, não só
sinalizado.

## Performance e SEO

### Metas (critério de aceite)

Lighthouse **≥ 90** em Performance, Acessibilidade, Melhores Práticas e SEO, medido em
**mobile** nas páginas `/`, `/casas` e `/casas/[slug]`.

### Como chegar lá

| Técnica | Detalhe |
|---|---|
| HTML estático | Nada de renderização no cliente para o conteúdo principal |
| Imagem LCP | Primeira foto com `fetchpriority="high"`, `loading="eager"`, `<link rel="preload">` |
| Demais imagens | `loading="lazy"`, `decoding="async"`, `width`/`height` sempre |
| CSS crítico | Inline no `<head>`; o resto assíncrono |
| Fontes | Fonte do sistema. **Zero** webfont — é o maior ganho fácil de LCP |
| JS | Ilhas com `client:visible`; nenhum script de terceiro |
| Analytics | Nenhum por padrão. Se necessário, sem cookie e sem bloquear o render |
| Cache | Assets com hash no nome, 1 ano; `index.html` 60 s |
| Compressão | Brotli/gzip automáticos no CloudFront |

> **Zero webfont** e **zero script de terceiro** são as duas decisões que mais
> sustentam a meta de 90 no mobile. Qualquer pedido de adicionar um widget externo
> (chat, mapa com API, pixel de rede social) precisa ser avaliado contra esse critério.

### SEO

| Item | Implementação |
|---|---|
| `<title>` e meta description | Por página, a partir do conteúdo da casa |
| Open Graph / Twitter Card | Com a foto principal da casa |
| `sitemap.xml` | Gerado no build, só com casas `ATIVA` |
| `robots.txt` | Permite tudo, exceto `/admin/` e `/reserva/` |
| URL canônica | Absoluta, em toda página |
| JSON-LD | `LodgingBusiness` na home; `VacationRental` em cada casa |
| `noindex` | Em `/admin/*` e `/reserva/*` (meta tag, além do `robots.txt`) |
| HTML semântico | `<main>`, `<article>`, `<nav>`, hierarquia de `<h1>`–`<h3>` correta |
| `lang` | `<html lang="pt-BR">` |

> `/reserva/*` precisa de `noindex` **e** `Cache-Control: no-store`: é uma página com
> dados pessoais acessada por URL com token. Indexá-la vazaria dados do hóspede no
> Google.

### Acessibilidade

| Item | Regra |
|---|---|
| Contraste | Mínimo 4,5:1 em texto normal — verificar na paleta rústica, que tende a tons claros |
| Foco | Visível em todo elemento interativo. **Nunca** `outline: none` sem substituto |
| Alvos de toque | Mínimo 44×44 px |
| `alt` | Obrigatório em toda imagem; decorativas com `alt=""` |
| Teclado | Calendário, lightbox e formulário operáveis sem mouse |
| ARIA | Rótulos em pt-BR no calendário (`aria-label="20 de novembro, indisponível"`) |
| Movimento | Respeitar `prefers-reduced-motion` |
| Formulário | `<label>` associado a todo campo; erro ligado por `aria-describedby` |

## Identidade visual

`[DEFINIR]` pelo proprietário: logotipo, paleta e fotos.

Direção proposta (a confirmar): paleta rústica/natural — verdes de mata, terracota,
madeira, areia — com um acento quente para os CTAs. Tipografia do sistema, com peso
alto em títulos. As **fotos** são a identidade; o layout deve sair da frente delas.

Os tokens de cor ficam em `site/src/styles/tokens.css` como custom properties, para
que trocar a paleta seja uma edição de um arquivo.

## Estrutura de arquivos

```
site/
├─ src/
│  ├─ pages/
│  │  ├─ index.astro
│  │  ├─ casas/index.astro
│  │  ├─ casas/[slug].astro
│  │  ├─ localizacao.astro
│  │  ├─ reserva/[...id].astro
│  │  ├─ regras.astro, cancelamento.astro, faq.astro, privacidade.astro, termos.astro
│  │  ├─ 404.astro
│  │  └─ admin/[...rota].astro          shell da SPA
│  ├─ components/
│  │  ├─ publico/     Galeria, Calendario, Cotacao, FormularioSolicitacao, BotaoWhatsApp, CardCasa
│  │  └─ admin/       uma pasta por tela
│  ├─ layouts/        Base.astro, Pagina.astro, Admin.astro
│  ├─ lib/            cliente da API, auth do Cognito, formatação
│  ├─ styles/         tokens.css, base.css
│  └─ data/           dados de exemplo para desenvolvimento offline
└─ public/            favicon, robots.txt, og-default.jpg
```

## Desenvolvimento offline

`site/src/data/exemplo/` traz um `casas.json` e um `config.json` de exemplo.
Com `PUBLIC_API_MOCK=1`, o cliente da API devolve esses dados e simula latência de
300 ms, permitindo trabalhar no frontend sem AWS. Isso é **só para desenvolvimento** e
precisa estar desligado no build de produção (verificado por um teste do build).
