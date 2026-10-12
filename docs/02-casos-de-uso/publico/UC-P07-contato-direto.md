# UC-P07 — Entrar em contato direto

| Campo | Valor |
|---|---|
| Ator | Interessado (visitante anônimo) |
| Pré-condições | WhatsApp configurado em `CONFIG/GERAL` |
| Gatilho | O visitante clica no botão flutuante de WhatsApp, no link de e-mail ou no telefone |
| Fase | 1 |
| Relacionados | [UC-P04](./UC-P04-solicitar-reserva.md), [UC-A13](../admin/UC-A13-configuracao-geral.md) |

## Objetivo de negócio

Parte relevante do público brasileiro **não preenche formulário** — manda mensagem.
Forçar o formulário como único caminho perde esses contatos.

O contato direto é também a **válvula de escape de todo erro do sistema**: quando a
API falha, quando as datas estão ocupadas, quando o prazo venceu, a saída é sempre
"fale com a gente". Por isso este UC aparece em quase todos os fluxos de exceção dos
outros.

## Fluxo principal

1. Em qualquer página pública, o visitante vê o botão flutuante de WhatsApp.
2. Clica.
3. Abre o WhatsApp (app no celular, Web no desktop) com uma mensagem **pré-preenchida
   pelo contexto da página**.
4. O visitante edita se quiser e envia.
5. O administrador responde pelo WhatsApp e, se fechar, cria a reserva manual
   ([UC-A11](../admin/UC-A11-criar-reserva-manual.md)).

## Mensagem por contexto

Pré-preencher economiza digitação e, mais importante, **traz a informação que o
proprietário precisa** para responder de uma vez:

| Página | Mensagem |
|---|---|
| `/` | `Olá! Vi o site do Recanto Paraíso e gostaria de informações sobre aluguel.` |
| `/casas` | `Olá! Vi as casas no site do Recanto Paraíso e gostaria de informações.` |
| `/casas/<slug>` sem datas | `Olá! Tenho interesse na Casa do Lago. Poderia me passar mais informações?` |
| `/casas/<slug>` com datas | `Olá! Tenho interesse na Casa do Lago de 20/11/2026 a 23/11/2026, para 7 pessoas.` |
| `/reserva/<id>` | `Olá! Sobre minha solicitação da Casa do Lago, de 20 a 23/11 (código 01HQ8X).` |
| Erro de indisponibilidade | `Olá! As datas de 20 a 23/11 na Casa do Lago estão ocupadas. Vocês têm outra opção nesse período?` |

> O código da reserva na mensagem de `/reserva/<id>` é o `reservaId`, **nunca o
> token**. O token na mensagem do WhatsApp vazaria o acesso para qualquer pessoa com
> acesso àquela conversa.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Desktop sem WhatsApp Web logado | `wa.me` abre a página do WhatsApp Web com QR; comportamento padrão do serviço |
| A2 | Visitante prefere e-mail | Link `mailto:` no rodapé, com assunto pré-preenchido |
| A3 | Visitante prefere ligar | `tel:` no rodapé (mesmo número) |
| A4 | WhatsApp não configurado | Botão flutuante **não é renderizado**; o rodapé mostra só e-mail |

## Fluxos de exceção

| # | Situação | Comportamento |
|---|---|---|
| E1 | Número configurado em formato inválido | Validado em [UC-A13](../admin/UC-A13-configuracao-geral.md); nunca chega ao site |
| E2 | Popup bloqueado | O link é um `<a href target="_blank" rel="noopener">` comum, não `window.open` — bloqueadores não interferem |
| E3 | Mensagem longa demais | Limitada a 500 caracteres antes do encode |

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | O número vem de `CONFIG/GERAL.whatsapp`, em E.164 sem `+` na URL |
| RN2 | A mensagem é montada no cliente a partir do contexto |
| RN3 | A mensagem é codificada com `encodeURIComponent` |
| RN4 | **Nunca** incluir `tokenAcesso` na mensagem |
| RN5 | O botão flutuante aparece em todas as páginas públicas, **exceto** quando o formulário de solicitação está visível na tela (evita dois CTAs competindo) |
| RN6 | O botão não aparece em `/admin/*` |
| RN7 | Link externo com `rel="noopener noreferrer"` |
| RN8 | Nenhum script de terceiro — é só um link |

> RN8 é o ponto que mais importa para a performance: o widget oficial de chat do
> WhatsApp carrega JavaScript de terceiro e derruba o Lighthouse. Um link `wa.me`
> custa zero byte de JS.

## Contrato técnico

Não há API. A URL é montada no cliente:

```ts
const base = "https://wa.me/";
const numero = config.whatsapp.replace(/\D/g, "");    // 5511999999999
const texto = encodeURIComponent(mensagem.slice(0, 500));
const url = `${base}${numero}?text=${texto}`;
```

O número e os textos-base vêm de `_dados/config.json`
([09 — Publicação](../../03-tecnico/09-publicacao-de-conteudo.md)).

## Implementação

| Arquivo | O que faz |
|---|---|
| `site/src/components/publico/BotaoWhatsApp.astro` | Botão flutuante (estático, sem JS) |
| `site/src/lib/whatsapp.ts` | `montarLinkWhatsApp(contexto)` — pura, testada |

A versão com datas selecionadas precisa de JS (a mensagem muda com a seleção), então o
botão dentro do bloco de reserva é parte da ilha `FormularioSolicitacao`. O botão
flutuante é estático e usa a mensagem genérica da página.

### Armadilhas

1. **`encodeURIComponent`, não `encodeURI`.** `encodeURI` não escapa `&` e `#`, o que
   truncaria a mensagem.
2. **Remover tudo que não é dígito** do número. Um `+` ou parênteses na URL do `wa.me`
   quebra o link em alguns clientes.
3. **Não usar `window.open`.** Bloqueadores de popup interferem; um `<a>` não.
4. **Área de toque de 44 px** e posição que não cobre o botão de solicitar no celular —
   é um erro comum e custa conversão.
5. **`position: fixed` + `env(safe-area-inset-bottom)`** para não ficar atrás da barra
   do navegador no iPhone.

## Interface

| Item | Decisão |
|---|---|
| Posição | Canto inferior direito, `fixed`, respeitando a safe area |
| Tamanho | 56 × 56 px (acima do mínimo de 44) |
| Rótulo acessível | `aria-label="Falar no WhatsApp"` |
| Ícone | SVG inline (sem requisição extra) |
| Visibilidade | Oculto quando o formulário de solicitação está na viewport |
| Animação | Nenhuma por padrão; respeitar `prefers-reduced-motion` |
| Contraste | Verificado contra o fundo em todas as páginas |

## Segurança e privacidade

- Apenas um link; nenhum dado sai do site sem ação do usuário.
- Nenhum token ou dado sensível na mensagem.
- `rel="noopener noreferrer"` evita acesso ao `window.opener` e vazamento de `Referer`.
- O número do WhatsApp é público por natureza (é um canal de atendimento).
- Nenhum cookie ou identificador é enviado ao WhatsApp pelo nosso site.

## Critérios de aceite

- [ ] O botão aparece em todas as páginas públicas.
- [ ] A mensagem muda conforme a página e as datas selecionadas.
- [ ] A mensagem **nunca** contém o `tokenAcesso`.
- [ ] O link abre o WhatsApp no celular e o Web no desktop.
- [ ] Nenhum JavaScript de terceiro é carregado.
- [ ] Área de toque ≥ 44 px e não cobre o botão de solicitar no celular.
- [ ] O botão é oculto quando o formulário está visível.
- [ ] Sem WhatsApp configurado, o botão não é renderizado.
- [ ] `rel="noopener noreferrer"` presente.
- [ ] Caracteres especiais e acentos chegam corretos na mensagem.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Home | Mensagem genérica |
| 2 | Página da casa sem datas | Mensagem com o nome da casa |
| 3 | Página da casa com datas e hóspedes | Mensagem com casa, datas e número de pessoas |
| 4 | Página de acompanhamento | Mensagem com o `reservaId`, **sem** token |
| 5 | Após erro `409` | Mensagem pedindo alternativa de data |
| 6 | Número `+55 (11) 99999-9999` | URL com `5511999999999` |
| 7 | Mensagem com acento e `&` | Codificada corretamente |
| 8 | Mensagem de 800 chars | Truncada em 500 |
| 9 | WhatsApp vazio na configuração | Botão ausente |
| 10 | Lighthouse com o botão presente | Nenhum impacto (zero JS de terceiro) |
| 11 | Navegação por teclado | Botão focável com rótulo audível |
