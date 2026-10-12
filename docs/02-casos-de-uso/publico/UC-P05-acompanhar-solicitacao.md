# UC-P05 — Acompanhar a solicitação

| Campo | Valor |
|---|---|
| Ator | Hóspede (identificado pelo token de acesso) |
| Pré-condições | Reserva existente e token válido |
| Gatilho | O hóspede abre `/reserva/<id>?t=<token>` — pelo link do e-mail ou direto após solicitar |
| Fase | 2 |
| Relacionados | [UC-P04](./UC-P04-solicitar-reserva.md), [UC-P06](./UC-P06-cancelar-solicitacao.md), [08 — Auth](../../03-tecnico/08-autenticacao-e-autorizacao.md) |

## Objetivo de negócio

Dar ao hóspede um lugar **fora do WhatsApp** para ver em que pé está o pedido.
Reduz a mensagem "oi, tem novidade?" e serve de comprovante do que foi pedido:
casa, datas, hóspedes e valor estimado.

Como não há conta de usuário, o link com token é a identidade.

## Fluxo principal

1. O hóspede abre o link do e-mail.
2. A página (shell estático) hidrata e chama `GET /api/solicitacoes/<id>?t=<token>`.
3. Enquanto carrega, mostra um esqueleto da tela, não um spinner vazio.
4. Com a resposta, exibe o estado atual com a mensagem apropriada, o resumo da
   estadia, o detalhamento do valor estimado e as ações possíveis.
5. O hóspede pode falar no WhatsApp ou, se ainda estiver `SOLICITADA`, desistir
   ([UC-P06](./UC-P06-cancelar-solicitacao.md)).

## Mensagem por estado

A mensagem é gerada **no servidor** (`mensagemStatus`), para a regra não ser duplicada
no frontend:

| Estado | Título | Mensagem |
|---|---|---|
| `SOLICITADA` | Aguardando confirmação | "Recebemos sua solicitação. Guardamos estas datas para você até **13/10 às 18h04**. O proprietário vai entrar em contato." |
| `CONFIRMADA` | Reserva confirmada 🎉 | "Sua reserva está confirmada! Em breve enviaremos as instruções de chegada." |
| `RECUSADA` | Solicitação não confirmada | "Não foi possível confirmar esta solicitação. Fale com a gente para ver outras datas." |
| `EXPIRADA` | Prazo encerrado | "O prazo desta solicitação terminou e as datas foram liberadas. Você pode fazer uma nova solicitação." |
| `CANCELADA` | Reserva cancelada | "Esta reserva foi cancelada." |
| `CONCLUIDA` | Estadia concluída | "Esperamos que tenha gostado! Obrigado pela visita." |

O tom dos estados negativos é cordial e **convida a tentar de novo** — é o momento de
recuperar o contato, não de encerrá-lo. O motivo interno registrado pelo admin
**nunca** aparece.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | `SOLICITADA` com prazo vencendo em < 6 h | Destaque no prazo + WhatsApp em evidência |
| A2 | `SOLICITADA` com prazo já vencido mas ainda não processado pelo cron | Mostra como **expirada** (a decisão é por `expiraEm`, não pelo campo `status`) |
| A3 | `CONFIRMADA` com check-in próximo | Mostra horários de check-in/check-out e um aviso de que as instruções chegarão por e-mail |
| A4 | Hóspede chega direto do envio do formulário | O token já está em memória; não precisa do e-mail |
| A5 | Hóspede recarrega a página | Nova chamada à API; sem cache |

> A2 é a aplicação da regra R4 de disponibilidade: a verdade é a comparação de
> `expiraEm` com agora, não o valor gravado em `status`. A tela não deve prometer
> datas guardadas que já estão livres.

## Fluxos de exceção

| # | Situação | Resposta | O que o hóspede vê |
|---|---|---|---|
| E1 | Sem `?t=` | `404` | "Não encontramos esta solicitação. Verifique o link do seu e-mail." + WhatsApp |
| E2 | Token errado | `404` | Mesma mensagem (não revela que a reserva existe) |
| E3 | `reservaId` inexistente | `404` | Mesma mensagem |
| E4 | Token de outra reserva | `404` | Mesma mensagem |
| E5 | Falha de rede/timeout | — | "Não conseguimos carregar agora." + Tentar novamente + WhatsApp |
| E6 | Token com tamanho diferente do esperado | `404`, **nunca** `500` | Mesma mensagem |

As respostas de E1–E4 e E6 são **idênticas**, de propósito: qualquer diferença entre
elas é um oráculo para enumeração.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | O token é obrigatório; `reservaId` sozinho não dá acesso |
| RN2 | Token inválido → `404` (nunca `403`) |
| RN3 | Comparação do token em tempo constante, com verificação de tamanho antes |
| RN4 | O e-mail do hóspede volta **mascarado** |
| RN5 | `pagamento`, `motivoInterno`, `historico` e `tokenAcesso` **nunca** são retornados |
| RN6 | `mensagemStatus` é gerada no servidor |
| RN7 | `podeCancelar = true` apenas em `SOLICITADA` não vencida |
| RN8 | A resposta **nunca** é cacheada (CloudFront TTL 0 + `Cache-Control: private, no-store`) |
| RN9 | A página tem `noindex` |
| RN10 | O token é redigido em todo log |

## Contrato técnico

```http
GET /api/solicitacoes/{reservaId}?t=<tokenAcesso>
Cache-Control: private, no-store
```

```json
{
  "reservaId": "01HQ8X...",
  "status": "SOLICITADA",
  "casa": { "slug": "casa-do-lago", "nome": "Casa do Lago",
            "fotoPrincipal": "/midia/casas/01HQ.../fachada.webp" },
  "checkin": "2026-11-20", "checkinFormatado": "20/11/2026",
  "checkout": "2026-11-23", "checkoutFormatado": "23/11/2026",
  "noites": 3, "hospedes": 7,
  "hospede": { "nome": "Maria Silva", "emailMascarado": "ma***@exemplo.com" },
  "valores": { "totalCentavos": 220000, "totalFormatado": "R$ 2.200,00", "detalhamento": [] },
  "prazoLimite": "2026-10-13T18:04:00-03:00",
  "prazoLimiteFormatado": "13/10/2026 às 18h04",
  "horasRestantes": 41,
  "horarioCheckin": "14:00", "horarioCheckout": "12:00",
  "podeCancelar": true,
  "whatsappLink": "https://wa.me/55...?text=...",
  "titulo": "Aguardando confirmação",
  "mensagemStatus": "Recebemos sua solicitação. Guardamos estas datas...",
  "estimativa": true
}
```

Único erro: `404 NAO_ENCONTRADO`.

## Implementação

| Arquivo | O que faz |
|---|---|
| `site/src/pages/reserva/[...id].astro` | Shell estático; a CloudFront Function roteia `/reserva/*` para cá |
| `site/src/components/publico/Acompanhamento.tsx` | Ilha Preact, `client:load` |
| `backend/src/handlers/api-publica.ts` | Rota de consulta |
| `backend/src/lib/auth.ts` | `tokenValido()` |
| `backend/src/domain/reservas.ts` | `mensagemDeStatus(reserva, agora)` — pura, testada |

### Armadilhas

1. **`timingSafeEqual` lança com tamanhos diferentes.** Compare os tamanhos antes,
   senão o `RangeError` vira `500` e revela o tamanho correto do token.
2. **Cache.** Se essa rota for cacheada no CloudFront, o hóspede A vê a reserva do
   hóspede B. Precisa de política de cache com TTL 0 **e** `no-store` na resposta,
   **e** um teste de infraestrutura verificando isso.
3. **Estado derivado.** `SOLICITADA` com `expiraEm` no passado deve ser apresentada
   como expirada. Calcule no servidor com `mensagemDeStatus`.
4. **Token na URL.** O log estruturado redige o parâmetro `t`. Os logs de acesso do
   CloudFront estão desligados.
5. **`noindex`.** Meta tag na página **e** `Disallow: /reserva/` no `robots.txt`.
   Esta página contém nome e datas de uma pessoa real.
6. **Não fazer polling.** Sem pagamento online, não há nada acontecendo em segundo
   plano que justifique recarregar a cada 3 s. O estado muda quando um humano age,
   em horas. Polling aqui só gastaria invocação de Lambda.

## Interface

```
┌────────────────────────────────────────────────┐
│  [foto da casa]                                │
│                                                 │
│  ⏳ Aguardando confirmação                      │
│                                                 │
│  Casa do Lago                                   │
│  20/11/2026  →  23/11/2026   ·  3 noites        │
│  7 hóspedes                                     │
│                                                 │
│  Guardamos estas datas para você até            │
│  13/10/2026 às 18h04.  (faltam 41 horas)        │
│                                                 │
│  Valor estimado        R$ 2.200,00  [detalhar]  │
│  ⓘ Valor estimado. Não houve cobrança.          │
│                                                 │
│  [ Falar no WhatsApp ]                          │
│  [ Desistir da solicitação ]                    │
│                                                 │
│  Solicitação 01HQ8X · maria***@exemplo.com      │
└────────────────────────────────────────────────┘
```

| Estado | Comportamento |
|---|---|
| Carregando | Esqueleto da tela (não spinner) |
| Pronto | Cartão de estado com ícone, cor e mensagem coerentes |
| Erro / token inválido | Mensagem única + link para a vitrine + WhatsApp |
| Falha de rede | Mensagem + Tentar novamente |
| Detalhamento | Recolhido por padrão; expande ao clique |

Acessibilidade: o estado é comunicado por **texto**, não só por cor/ícone;
`<h1>` com o título do estado; contagem de tempo restante também em texto.

## Segurança e privacidade

- Token de 256 bits é o único mecanismo de acesso.
- `404` uniforme para todos os casos de falha.
- E-mail mascarado; nenhum dado interno exposto.
- `no-store`, `noindex`, token redigido nos logs.
- Sem cookie, sem script de terceiro.
- Se o hóspede encaminhar o e-mail, quem recebe vê a reserva. Isso é inerente ao
  modelo de link-com-token e está declarado na política de privacidade.

## Critérios de aceite

- [ ] Token válido mostra a reserva correta.
- [ ] Token ausente, errado, de outra reserva ou de tamanho diferente → `404` idêntico.
- [ ] Tamanho diferente **não** gera `500`.
- [ ] A resposta não contém `pagamento`, `motivoInterno`, `historico` nem `tokenAcesso`.
- [ ] E-mail mascarado.
- [ ] Cada estado tem título e mensagem próprios, gerados no servidor.
- [ ] `SOLICITADA` com prazo vencido é apresentada como expirada.
- [ ] `podeCancelar` só em `SOLICITADA` não vencida.
- [ ] Resposta com `Cache-Control: private, no-store` e CloudFront TTL 0.
- [ ] Página com `noindex` e `Disallow` no `robots.txt`.
- [ ] O token não aparece em nenhum log.
- [ ] Sem polling.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Token válido, `SOLICITADA` | Dados corretos, `podeCancelar: true` |
| 2 | Token válido, `CONFIRMADA` | Mensagem de confirmação, `podeCancelar: false` |
| 3 | Token válido, `EXPIRADA` | Mensagem de prazo encerrado |
| 4 | Sem `t` | `404` |
| 5 | Token com 1 char alterado | `404` |
| 6 | Token de outra reserva | `404` |
| 7 | Token de 10 chars | `404`, sem `500` |
| 8 | `reservaId` inexistente | `404` |
| 9 | Resposta inspecionada | Nenhum campo interno |
| 10 | `SOLICITADA` com `expiraEm` no passado | Apresentada como expirada |
| 11 | Cabeçalhos da resposta | `private, no-store` |
| 12 | Política de cache no CDK | TTL 0 |
| 13 | Log da requisição | `t=[REDIGIDO]` |
| 14 | HTML da página | `<meta name="robots" content="noindex">` |
| 15 | API fora do ar | Erro com Tentar novamente |
