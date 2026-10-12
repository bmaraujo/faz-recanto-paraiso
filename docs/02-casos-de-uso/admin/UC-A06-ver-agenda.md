# UC-A06 — Ver a agenda consolidada e o painel

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado |
| Gatilho | O admin abre `/admin`, `/admin/agenda` ou `/admin/reservas` |
| Fase | 2 |
| Relacionados | [UC-A07](./UC-A07-confirmar-reserva.md), [UC-A08](./UC-A08-recusar-ou-cancelar-reserva.md), [UC-A09](./UC-A09-estender-prazo.md), [04 — API admin](../../03-tecnico/04-api-admin.md) |

## Objetivo de negócio

É a tela que **substitui o caderno**. O proprietário precisa responder, em segundos:

1. Tem alguém esperando resposta minha? Há quanto tempo?
2. O que está alugado neste mês, em cada casa?
3. Quem chega nos próximos dias?
4. Tem algum problema que eu preciso resolver agora?

A pergunta 1 é a mais valiosa: **solicitação que expira sem resposta é dinheiro
perdido**, e é o indicador que o painel precisa colocar na frente dos olhos.

## Fluxo principal — painel

1. O admin abre `/admin` e vê, em **uma** requisição (`GET /api/admin/painel`):
   - **Solicitações pendentes**, ordenadas por prazo mais curto primeiro, com o tempo
     restante e ações diretas (confirmar, recusar, estender);
   - **Próximos check-ins** dos próximos 14 dias, com a situação de pagamento;
   - **Alertas** (conflito de iCal, falha de sincronização, e-mail não enviado);
   - **Ocupação do mês** por casa;
   - indicador de **alterações não publicadas**.
2. Clica em qualquer item para ir ao detalhe.

## Fluxo principal — agenda

1. O admin abre `/admin/agenda`.
2. Vê um calendário mensal com **uma linha por casa**, onde cada noite é uma célula
   colorida por tipo:

```
Novembro 2026                        [ ‹ ]  [ Hoje ]  [ › ]

                1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 ...
Casa do Lago    ·  ·  ▓  ▓  ▓  ·  ·  ·  ▒  ▒  ·  ·  █  █  █
Casa da Mata    ·  ·  ·  ·  ▓  ▓  ·  ·  ·  ·  ·  ▓  ▓  ·  ·
Chalé Mirante   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·

▓ confirmada   ▒ aguardando   █ bloqueio   ░ externo   · livre
```

3. Passa o mouse (ou toca) em uma célula e vê quem é, as datas e o estado.
4. Clica para abrir a reserva ou o bloqueio.
5. Arrasta sobre dias livres para criar um bloqueio ([UC-A05](./UC-A05-gerenciar-bloqueios.md)).

## Fluxo principal — lista de reservas

1. O admin abre `/admin/reservas`.
2. Filtra por período de check-in, estado, casa ou busca por nome/e-mail/telefone.
3. Vê a lista paginada com casa, hóspede, datas, noites, valor, estado e situação de
   pagamento.
4. Clica para abrir o detalhe, que traz tudo: dados do hóspede, cotação detalhada,
   histórico de transições, e-mails enviados, pagamento registrado, observação do
   hóspede, motivo interno e as ações disponíveis para o estado atual.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Nenhuma solicitação pendente | Mensagem positiva: "Nenhuma solicitação aguardando." |
| A2 | Admin filtra a agenda por uma casa | Mostra só aquela linha, em formato expandido |
| A3 | Admin navega entre meses | Busca o mês novo; mantém os já carregados em memória |
| A4 | Admin busca por telefone | Busca aplicada na Lambda sobre o período filtrado |
| A5 | Admin abre pelo celular | O painel é a visão principal; a agenda rola na horizontal |
| A6 | Admin clica em uma noite externa | Mostra o canal e o UID; sem ação (é de outro sistema) |
| A7 | Admin exporta a lista | CSV das reservas do filtro atual |

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Falha da API | — | "Não conseguimos carregar." + Tentar novamente, por bloco do painel |
| E2 | Um bloco do painel falha | — | Os outros blocos **continuam funcionando** |
| E3 | Intervalo da agenda acima de 3 meses | `422` | Não ocorre pela UI |
| E4 | Reserva não encontrada | `404` | "Esta reserva não existe mais." + voltar à lista |
| E5 | Sessão expirada | `401` | Renova; se falhar, login preservando a rota |
| E6 | Muitas reservas no período | — | Paginação por cursor; "Carregar mais" |

> E2 é uma decisão de arquitetura da tela: o painel vem em **uma** requisição, mas o
> servidor monta cada bloco de forma independente e devolve `null` + erro no bloco que
> falhou. Um alerta de iCal indisponível não pode esconder as solicitações pendentes.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Solicitações pendentes ordenadas por **prazo mais curto primeiro** |
| RN2 | `horasRestantes` calculado no **servidor**, em `America/Sao_Paulo` |
| RN3 | Solicitação com prazo vencido e ainda não processada aparece como **expirada** |
| RN4 | Próximos check-ins: `CONFIRMADA` com check-in nos próximos 14 dias |
| RN5 | A agenda mostra o **tipo e o dono** de cada ocupação (diferente do público) |
| RN6 | A agenda cobre no máximo 3 meses por requisição |
| RN7 | Taxa de ocupação = noites ocupadas ÷ noites do mês, por casa |
| RN8 | Cores por tipo: confirmada, aguardando, bloqueio, externo |
| RN9 | A busca textual é aplicada na Lambda, não no banco |
| RN10 | A paginação usa cursor opaco (o `LastEvaluatedKey` nunca é exposto cru) |
| RN11 | Nenhuma resposta do backoffice é cacheada |
| RN12 | O detalhe da reserva mostra `pagamento`, `motivoInterno` e `historico` |

> RN3 repete a regra R4 de disponibilidade: a verdade é `expiraEm` comparado ao agora.
> Mostrar "faltam -3 horas" seria pior que mostrar "expirada".

## Contrato técnico

Contratos completos em [04 — API admin](../../03-tecnico/04-api-admin.md):
`GET /api/admin/painel`, `GET /api/admin/agenda`, `GET /api/admin/reservas`,
`GET /api/admin/reservas/{reservaId}`.

### Detalhe da reserva — campos exclusivos do admin

```json
{
  "pagamento": { "situacao": "PARCIAL", "valorRecebidoCentavos": 110000,
                 "metodo": "Pix", "observacao": "metade na reserva",
                 "registradoEm": "..." },
  "motivoInterno": "",
  "observacaoHospede": "Chegaremos por volta das 18h.",
  "historico": [
    { "de": null, "para": "SOLICITADA", "em": "...", "por": "SITE" },
    { "de": "SOLICITADA", "para": "CONFIRMADA", "em": "...", "por": "proprietario@..." }
  ],
  "emailsEnviados": ["SOLICITACAO_RECEBIDA", "RESERVA_CONFIRMADA"],
  "historicoEnvios": [{ "codigo": "RESERVA_CONFIRMADA", "enviadoEm": "...", "manual": false }],
  "tokenAcesso": "aG9yYS1k...",
  "linkAcompanhamento": "https://.../reserva/01HQ...?t=...",
  "whatsappLink": "https://wa.me/...",
  "cancelamento": { "diasAteCheckin": 41, "faixaAplicada": { }, "devolucaoSugeridaCentavos": 110000 },
  "acoesDisponiveis": ["CONFIRMAR", "RECUSAR", "ESTENDER_PRAZO"]
}
```

`acoesDisponiveis` vem do servidor, derivado da máquina de estados. A interface
**não decide** o que é permitido — ela renderiza o que o servidor autoriza. Duplicar
a regra no frontend garante divergência com o tempo.

## Implementação

### `GET /api/admin/painel` — blocos independentes

```ts
const [pendentes, checkins, alertas, ocupacao, publicacao] = await Promise.allSettled([
  buscarSolicitacoesPendentes(),
  buscarProximosCheckins(),
  buscarAlertas(),
  calcularOcupacaoDoMes(),
  buscarStatusPublicacao(),
]);
// Cada bloco rejeitado vira { dados: null, erro: "..." } na resposta.
```

`Promise.allSettled`, não `Promise.all`: um bloco que falha não derruba a tela.

### Consultas

| Bloco | Consulta |
|---|---|
| Pendentes | `Query GSI1 PK=RESERVA, SK >= <hoje>` + filtro `status = SOLICITADA` |
| Próximos check-ins | mesma query, limitada a 14 dias + filtro `CONFIRMADA` |
| Agenda | `Query OCUPACAO#<casaId>, SK BETWEEN` — **uma por casa**, em paralelo |
| Ocupação do mês | derivada da agenda do mês |
| Alertas | `Query` dos itens `ICAL#` + reservas com e-mail essencial pendente |

Com até ~10 casas, a agenda são 10 `Query` em paralelo — rápido e barato.
Acima de ~30 casas, valeria um item agregado por mês; fica anotado como gatilho de
revisão, não como requisito.

### Armadilhas

1. **Cálculo de tempo no servidor** (RN2). O celular do admin pode estar em outro fuso
   ou com a hora errada.
2. **`Promise.allSettled`** no painel (E2).
3. **Cursor opaco** (RN10): `Buffer.from(JSON.stringify(key)).toString("base64url")`.
   Expor a chave crua revela a estrutura do banco e permite consultas forjadas.
4. **`acoesDisponiveis` do servidor**, não inferido no cliente.
5. **Cache desabilitado** em `/api/admin/*` — já configurado no CloudFront, mas a
   resposta também precisa de `Cache-Control: no-store`.
6. **Não paginar a agenda.** São poucos itens por mês; paginar complicaria o
   calendário sem ganho.

## Interface

### Painel

```
Recanto Paraíso · Administração            [ Publicar site ● ]

⚠ 1 alerta
   Conflito de calendário: Airbnb marcou 25/11 na Casa do Lago,
   que já tem reserva de Maria Silva.          [ Ver ]

AGUARDANDO SUA RESPOSTA                                    2
┌──────────────────────────────────────────────────────────┐
│ ⏱ 4h restantes          Casa do Lago                      │
│ Maria Silva · (11) 99999-9999                             │
│ 20 a 23/11/2026 · 3 noites · 7 hóspedes · R$ 2.200,00     │
│ "Chegaremos por volta das 18h."                           │
│ [ Confirmar ] [ Recusar ] [ +48h ] [ WhatsApp ] [ Abrir ] │
├──────────────────────────────────────────────────────────┤
│ ⏱ 41h restantes         Casa da Mata                      │
│ ...                                                        │
└──────────────────────────────────────────────────────────┘

PRÓXIMOS CHECK-INS (14 dias)
┌──────────────────────────────────────────────────────────┐
│ em 3 dias   14/11  Casa da Mata  João Souza   pago total │
│ em 9 dias   20/11  Casa do Lago  Maria Silva  50% pago   │
└──────────────────────────────────────────────────────────┘

OCUPAÇÃO DE NOVEMBRO
  Casa do Lago     12/30 noites   40%  ▓▓▓▓░░░░░░
  Casa da Mata      6/30 noites   20%  ▓▓░░░░░░░░
```

| Decisão de UI | Motivo |
|---|---|
| Prazo em destaque, com relógio | É o que gera urgência e evita a perda por expiração |
| Ações **no cartão** do painel | Confirmar sem abrir o detalhe é o fluxo de 90% dos casos |
| Botão de WhatsApp direto | O admin quer falar antes de confirmar |
| Observação do hóspede visível no cartão | Muitas vezes é o que define a resposta |
| Alertas no topo, em vermelho | Conflito de calendário é a única coisa mais urgente que uma solicitação |
| Prazo < 6 h em vermelho | Reforço visual do risco |
| Telefone clicável | `tel:` e `wa.me` |

### Agenda — cores

| Tipo | Representação |
|---|---|
| `CONFIRMADA` | Preenchimento sólido |
| `SOLICITADA` (pendente) | Hachurado, com o relógio |
| `BLOQUEIO` | Cinza escuro sólido |
| `EXTERNO` | Pontilhado, com o ícone do canal |
| Livre | Vazio |

As quatro precisam ser distinguíveis **sem depender de cor** (padrão + ícone) —
critério de acessibilidade.

> No celular, a agenda rola horizontalmente com os nomes das casas fixos à esquerda.
> Alternativa para telas estreitas: visão de lista por dia, em vez de grade.

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` em todas as rotas |
| Dados pessoais | Tela com nome, e-mail e telefone completos — é a finalidade da tela |
| Cache | `no-store`; nenhuma resposta de admin cacheada no CloudFront |
| `tokenAcesso` | Retornado só no detalhe, para o admin reenviar o link |
| Cursor | Opaco |
| Exportação CSV | Gerada no cliente a partir dos dados já carregados; nenhum endpoint novo |
| Log | Registra a consulta e o `sub` do admin; **nunca** os dados retornados |

> O CSV ser gerado no cliente evita criar um endpoint que devolve a base inteira — que
> seria o alvo mais atraente do sistema.

## Critérios de aceite

- [ ] O painel carrega em **uma** requisição.
- [ ] Um bloco que falha não impede os outros.
- [ ] Solicitações ordenadas por prazo mais curto primeiro.
- [ ] `horasRestantes` calculado no servidor em `America/Sao_Paulo`.
- [ ] Solicitação com prazo vencido aparece como expirada.
- [ ] Confirmar/recusar/estender funcionam direto do cartão do painel.
- [ ] A agenda mostra uma linha por casa, com tipo e dono de cada noite.
- [ ] Os quatro tipos são distinguíveis sem cor.
- [ ] A lista filtra por período, estado, casa e busca textual.
- [ ] Paginação por cursor opaco.
- [ ] O detalhe traz pagamento, motivo interno, histórico e e-mails enviados.
- [ ] `acoesDisponiveis` vem do servidor.
- [ ] Nenhuma resposta cacheada.
- [ ] A agenda rejeita intervalo acima de 3 meses.
- [ ] A tela funciona no celular.
- [ ] O log não contém os dados retornados.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | 3 pendentes com prazos diferentes | Ordenadas por prazo crescente |
| 2 | Pendente com `expiraEm` no passado | Exibida como expirada |
| 3 | Bloco de alertas falha | Painel renderiza sem ele |
| 4 | Nenhuma pendente | Mensagem positiva |
| 5 | Check-in em 20 dias | Fora de "próximos check-ins" |
| 6 | Agenda com reserva, bloqueio e externo | Três representações distintas |
| 7 | Agenda de 4 meses | `422` |
| 8 | Filtro por `status=SOLICITADA,CONFIRMADA` | Ambos retornados |
| 9 | Busca por "maria" | Encontra por nome |
| 10 | Busca por `11999999999` | Encontra por telefone |
| 11 | 60 reservas no período | Paginado; cursor funciona |
| 12 | Cursor inspecionado | Opaco, sem estrutura de chave |
| 13 | Detalhe de reserva `SOLICITADA` | `acoesDisponiveis` com confirmar/recusar/estender |
| 14 | Detalhe de reserva `CONCLUIDA` | `acoesDisponiveis` vazio ou só reenviar e-mail |
| 15 | Cabeçalhos de `/api/admin/painel` | `no-store` |
| 16 | Taxa de ocupação de 12 noites em novembro | 40% |
| 17 | Requisição sem JWT | `401` |
| 18 | Admin em fuso UTC+2 | `horasRestantes` correto |
