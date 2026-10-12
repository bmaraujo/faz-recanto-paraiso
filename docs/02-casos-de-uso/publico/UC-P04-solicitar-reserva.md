# UC-P04 — Solicitar reserva

| Campo | Valor |
|---|---|
| Ator | Interessado (visitante anônimo) |
| Pré-condições | Casa `ATIVA`; datas selecionadas, válidas e disponíveis |
| Gatilho | O visitante envia o formulário na página da casa |
| Fase | 2 |
| Relacionados | [Ciclo de vida](../../01-negocio/03-ciclo-de-vida-da-reserva.md), [05 — Concorrência](../../03-tecnico/05-concorrencia-e-idempotencia.md), [UC-A06](../admin/UC-A06-ver-agenda.md), [UC-A07](../admin/UC-A07-confirmar-reserva.md) |

## Objetivo de negócio

**O caso de uso mais importante do sistema.** Converte um visitante em um contato
qualificado e, ao mesmo tempo, **segura as datas** para que a negociação aconteça sem
risco de outra pessoa pedir o mesmo período.

Sem a pré-reserva, o site seria apenas um formulário de contato. Com ela, o site passa
a controlar a ocupação — que é a razão de existir do projeto.

### O que o visitante precisa entender

Três coisas, antes e depois de enviar:

1. **Não é uma reserva confirmada.**
2. **Não há nenhuma cobrança pelo site.**
3. **As datas estão guardadas até <prazo>**, e o proprietário vai entrar em contato.

Se qualquer uma dessas três não estiver clara, a expectativa do hóspede quebra e o
proprietário recebe uma reclamação.

## Fluxo principal

1. O visitante já selecionou datas ([UC-P02](./UC-P02-consultar-disponibilidade.md)) e
   viu a cotação ([UC-P03](./UC-P03-simular-preco.md)).
2. Preenche nome, e-mail, telefone e, opcionalmente, uma observação.
3. Marca o aceite das regras, da política de cancelamento e da privacidade.
4. Clica em **"Solicitar reserva"**.
5. O botão é desabilitado e mostra "Enviando...".
6. `POST /api/solicitacoes`.
7. O servidor:
   1. valida a entrada;
   2. verifica honeypot e tempo de formulário;
   3. carrega a casa e a configuração de preços;
   4. verifica o limite antiabuso do e-mail;
   5. **recalcula a cotação** (ignora qualquer valor do cliente);
   6. calcula `expiraEm`;
   7. executa a **transação** que cria a reserva e ocupa as noites;
   8. responde `201`;
   9. envia `SOLICITACAO_RECEBIDA` ao hóspede e `NOVA_SOLICITACAO_ADMIN` ao admin.
8. A tela mostra a confirmação de recebimento, com o prazo, o resumo, o link de
   acompanhamento e um botão de WhatsApp.
9. O visitante é levado para `/reserva/<id>?t=<token>` ([UC-P05](./UC-P05-acompanhar-solicitacao.md)).

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Visitante prefere WhatsApp | Botão alternativo com mensagem pré-preenchida ([UC-P07](./UC-P07-contato-direto.md)) |
| A2 | Check-in muito próximo | `expiraEm` é truncado para 12 h antes do check-in; a tela informa o prazo real |
| A3 | Visitante não preenche a observação | Campo opcional; segue |
| A4 | Visitante já tem 2 solicitações pendentes (limite 3) | Passa normalmente |
| A5 | Segundo clique no botão | Botão desabilitado; se passar, ver E6 |

## Fluxos de exceção

| # | Situação | Resposta | O que o usuário vê |
|---|---|---|---|
| E1 | Campo inválido | `400 ENTRADA_INVALIDA` | Campos marcados com a mensagem específica |
| E2 | Datas ocupadas no instante do envio | `409 DATAS_INDISPONIVEIS` | "Estas datas acabaram de ser pedidas por outra pessoa." Calendário se atualiza, datas em conflito marcadas, seleção limpa |
| E3 | Regra violada (mínimo, janela, capacidade) | `422` | Mensagem específica; não deveria chegar aqui pela UI |
| E4 | Limite de pendentes por e-mail | `429 LIMITE_SOLICITACOES` | "Você já tem 3 solicitações aguardando. Fale com a gente pelo WhatsApp." |
| E5 | Honeypot ou formulário rápido demais | **`201` falso** | Tela de sucesso. Nada é gravado |
| E6 | Clique duplo que passa | `409` | A tela detecta a reserva recém-criada do mesmo e-mail/datas e mostra o sucesso dela |
| E7 | Falha no envio de e-mail | `201` | Sucesso + nota: "Não conseguimos enviar o e-mail de confirmação, mas sua solicitação foi registrada. Guarde este link." |
| E8 | Falha de rede / timeout | — | "Não conseguimos enviar. Tente novamente ou fale pelo WhatsApp." Botão reabilitado, **dados preservados** |
| E9 | Casa ficou `INATIVA` entre o carregamento e o envio | `404` | "Esta casa não está mais disponível para reserva." |
| E10 | Erro interno | `500` | Mensagem genérica + botão de WhatsApp. O erro detalhado só no log |

> **E7 é crítico.** A solicitação foi criada com sucesso; o e-mail não saiu. Se a tela
> dissesse "erro", o visitante tentaria de novo, tomaria `409` (as datas já são dele)
> e ficaria convencido de que falhou. A tela precisa mostrar sucesso e destacar o link.
>
> **E8 é ambíguo por natureza:** pode ter criado e a resposta se perdido. Por isso a
> mensagem sugere tentar de novo **ou** o WhatsApp, e o tratamento de E6 cobre o
> reenvio.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | A reserva nasce em `SOLICITADA`, com `origem = SITE` |
| RN2 | As noites `[checkin, checkout)` são ocupadas com `pendente = true` |
| RN3 | `expiraEm = agora + prazoSolicitacaoHoras` (padrão 48 h) |
| RN4 | `expiraEm` nunca passa de 12 h antes do horário de check-in |
| RN5 | A cotação é **sempre** recalculada no servidor. Valor do cliente ignorado |
| RN6 | `aceiteTermos` deve ser `true`; a data/hora do aceite é registrada |
| RN7 | Máximo de `maxSolicitacoesPendentesPorEmail` (padrão 3) pendentes por e-mail |
| RN8 | `tokenAcesso` de 32 bytes aleatórios, devolvido **uma única vez** |
| RN9 | A transação é atômica: ou cria tudo, ou nada |
| RN10 | Toda validação de disponibilidade acontece **na escrita**, não antes |
| RN11 | Honeypot preenchido ou `_t < 3000 ms` → descarte silencioso com `201` falso |
| RN12 | O e-mail é normalizado (trim + minúsculas) antes de validar e contar |
| RN13 | Falha de e-mail **não** invalida a solicitação |
| RN14 | Nenhum dado pessoal nos logs |

## Contrato técnico

```http
POST /api/solicitacoes
Content-Type: application/json
```

```json
{
  "casaId": "01HQ...",
  "checkin": "2026-11-20",
  "checkout": "2026-11-23",
  "hospedes": 7,
  "nome": "Maria Silva",
  "email": "maria@exemplo.com",
  "telefone": "(11) 99999-9999",
  "observacao": "Chegaremos por volta das 18h.",
  "aceiteTermos": true,
  "_hp": "",
  "_t": 8421
}
```

### Validação (zod)

| Campo | Regra | Erro |
|---|---|---|
| `casaId` | ULID de casa `ATIVA` | `NAO_ENCONTRADO` |
| `checkin`, `checkout` | `YYYY-MM-DD`, `checkout > checkin` | `INTERVALO_INVALIDO` |
| `hospedes` | inteiro, 1 a `capacidadeMaxima` | `CAPACIDADE_EXCEDIDA` |
| `nome` | 3–100 chars, ≥ 2 palavras, sem URL, sem `<` ou `>` | `ENTRADA_INVALIDA` |
| `email` | formato válido, ≤ 150 chars, normalizado | `ENTRADA_INVALIDA` |
| `telefone` | normalizável para E.164 brasileiro (10 ou 11 dígitos + DDI) | `ENTRADA_INVALIDA` |
| `observacao` | opcional, ≤ 1.000 chars, sem HTML | `ENTRADA_INVALIDA` |
| `aceiteTermos` | literal `true` | `ENTRADA_INVALIDA` |
| `_hp` | string vazia | descarte silencioso |
| `_t` | inteiro ≥ 3000 | descarte silencioso |

Corpo máximo: **16 KB**, verificado antes do parse.

### Resposta `201`

```json
{
  "reservaId": "01HQ8X...",
  "tokenAcesso": "aG9yYS1kZS1kb3JtaXItbm8tcmVjYW50bw",
  "linkAcompanhamento": "https://<site>/reserva/01HQ8X...?t=aG9yYS1k...",
  "prazoLimite": "2026-10-13T18:04:00-03:00",
  "prazoLimiteFormatado": "13/10/2026 às 18h04",
  "cotacao": { },
  "whatsappLink": "https://wa.me/55...?text=...",
  "emailEnviado": true
}
```

### Erros

| Código | HTTP | `detalhes` |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | `campos[]` |
| `NAO_ENCONTRADO` | 404 | — |
| `CAPACIDADE_EXCEDIDA` | 422 | `capacidadeMaxima` |
| `MINIMO_NOITES` | 422 | `minimoExigido`, `periodoNome` |
| `MAXIMO_NOITES` | 422 | `maxNoites` |
| `ANTECEDENCIA_MINIMA` | 422 | `antecedenciaMinimaDias` |
| `FORA_DA_JANELA` | 422 | `janelaReservaMeses` |
| `DATAS_INDISPONIVEIS` | 409 | `noitesIndisponiveis[]` |
| `LIMITE_SOLICITACOES` | 429 | `limite` |
| `ERRO_INTERNO` | 500 | — |

## Implementação

### A transação

Detalhada em [05 — Concorrência](../../03-tecnico/05-concorrencia-e-idempotencia.md#criar-solicitação---a-transação).
Resumo: `TransactWriteItems` com `Put` da reserva + `Put` condicional por noite +
`Update` condicional do contador antiabuso.

### Ordem do handler

```
 1. tamanho do corpo <= 16 KB            → 413
 2. parse + zod                          → 400
 3. honeypot e _t                        → 201 falso (não grava nada, loga aviso)
 4. GetItem CASA#<id>/META, status ATIVA → 404
 5. GetItem CASA#<id>/PRECOS             → 500 se ausente
 6. GetItem CONFIG/GERAL (com cache)
 7. calcularCotacao(...)                 → 422 se erro de regra
 8. expiraEm = min(agora + prazo, checkin 12h antes)
 9. reservaId = ulid(); tokenAcesso = randomBytes(32)
10. TransactWriteItems
11. tratar CancellationReasons           → 409 / 429 / retry
12. responder 201
13. enviar e-mails (try/catch, nunca propaga)
```

Os passos 4, 5 e 6 são três `GetItem`. Alternativa: `BatchGetItem` com os três — uma
chamada, menos latência. Vale fazer, mas só depois de funcionar.

### Armadilhas

1. **Não fazer "verificar disponibilidade e depois gravar".** A verificação é a
   condição da escrita. Um `Query` antes serve apenas para mensagem de erro melhor, e é
   **opcional**.
2. **Não confiar no valor do cliente.** Não existe campo de valor na entrada.
3. **`timingSafeEqual` não entra aqui** (não há comparação de token na criação), mas
   o token gerado **nunca** é logado.
4. **Normalizar o telefone** antes de gravar: o admin vai clicar para abrir o WhatsApp,
   e `(11) 99999-9999` não funciona em `wa.me`. Guardar E.164 e exibir formatado.
5. **`_t` vem do cliente** e é trivial de falsificar. É uma barreira contra robô
   simples, não contra atacante determinado — e está documentado como tal.
6. **O e-mail do admin também pode falhar.** Se `NOVA_SOLICITACAO_ADMIN` não sair, o
   admin não sabe que há uma solicitação. Por isso esse código é **essencial** e o
   `cron-diario` o reenvia.
7. **Não gravar `tokenAcesso` em log, métrica ou mensagem de erro.**

## Interface

### O formulário

```
Sua solicitação
┌──────────────────────────────────────────────────┐
│ Casa do Lago · 20 a 23/11/2026 · 3 noites        │
│ 7 hóspedes · Valor estimado R$ 2.200,00          │
├──────────────────────────────────────────────────┤
│ Nome completo *        [____________________]    │
│ E-mail *               [____________________]    │
│ WhatsApp *             [____________________]    │
│ Alguma observação?     [____________________]    │
│                        [____________________]    │
│                                                   │
│ [ ] Li e aceito as regras da casa, a política de │
│     cancelamento e a política de privacidade. *  │
│                                                   │
│  ⓘ Solicitar não é reservar e não gera cobrança. │
│    Guardamos as datas por 48 horas enquanto      │
│    combinamos tudo com você.                     │
│                                                   │
│        [     Solicitar reserva     ]              │
│                                                   │
│    ou  [ Falar no WhatsApp ]                      │
└──────────────────────────────────────────────────┘
```

| Decisão de UI | Motivo |
|---|---|
| Resumo fixo no topo do formulário | O visitante confere o que está pedindo sem rolar de volta |
| O aviso "não é reserva" **acima** do botão | É onde a atenção está no momento da decisão |
| WhatsApp como alternativa visível | Parte do público não preenche formulário; perder esse contato é pior |
| Aceite único para os três documentos | Três checkboxes reduzem conversão; os links estão no texto |
| Observação opcional | Campo obrigatório a mais derruba conversão |

### Após o envio

```
✓ Solicitação recebida!

Guardamos a Casa do Lago de 20 a 23 de novembro
para você até 13/10/2026 às 18h04.

O proprietário vai entrar em contato pelo WhatsApp
ou pelo e-mail maria@exemplo.com.

Esta ainda não é uma reserva confirmada e não houve
nenhuma cobrança.

[ Falar agora no WhatsApp ]   [ Acompanhar solicitação ]

Guarde este link: https://<site>/reserva/01HQ...?t=...
```

| Estado | Comportamento |
|---|---|
| Enviando | Botão desabilitado com "Enviando..."; campos travados |
| Sucesso | Tela acima; rola para o topo; link copiável |
| `409` | Mensagem + calendário atualizado + seleção limpa; **dados do formulário preservados** |
| `429` | Mensagem + WhatsApp em destaque |
| Erro de campo | Foco no primeiro campo inválido; mensagem ligada por `aria-describedby` |
| Falha de rede | Mensagem + botão reabilitado; **nada perdido** |

> "Dados do formulário preservados" em todo caminho de erro é obrigatório. Fazer o
> visitante redigitar nome, e-mail e telefone depois de um erro é a forma mais certa
> de perdê-lo.

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Dados coletados | Apenas nome, e-mail, telefone e observação — o mínimo para o contato |
| Base legal (LGPD) | Execução de contrato / legítimo interesse, com aceite registrado |
| `tokenAcesso` | 256 bits; único caminho de acesso à reserva |
| Log | E-mail e telefone mascarados; nome omitido; token nunca |
| Injeção | Entrada validada por schema; `observacao` sem HTML; nada concatenado em query (DynamoDB é parametrizado por construção) |
| XSS | A observação aparece no backoffice e no e-mail do admin — **escapada** nos dois |
| Enumeração | ULID não sequencial; token obrigatório |
| Spam | Honeypot, tempo de formulário, limite por e-mail, concorrência reservada |
| Retenção | Ver [LGPD](../../05-conformidade/02-lgpd.md) |

> A `observacao` é o único campo de texto livre que chega ao sistema e que um humano
> vai ler em HTML (no e-mail do admin e no backoffice). É o vetor de XSS deste UC e
> precisa de escape nos dois destinos.

## Critérios de aceite

- [ ] Solicitação válida cria a reserva em `SOLICITADA` e ocupa as noites como pendentes.
- [ ] `expiraEm` = agora + 48 h (configurável), truncado a 12 h antes do check-in.
- [ ] A cotação gravada é a recalculada no servidor.
- [ ] Duas solicitações simultâneas nas mesmas datas: só uma passa.
- [ ] O `409` informa quais noites estão indisponíveis.
- [ ] O 4º pedido pendente do mesmo e-mail recebe `429`.
- [ ] Honeypot preenchido → `201` e nada gravado.
- [ ] `_t < 3000` → `201` e nada gravado.
- [ ] `aceiteTermos: false` → `400`.
- [ ] Telefone gravado em E.164.
- [ ] `tokenAcesso` devolvido uma vez e nunca logado.
- [ ] Os dois e-mails são enviados.
- [ ] Falha de e-mail não invalida a solicitação e a tela informa.
- [ ] Erro em qualquer caminho preserva os dados do formulário.
- [ ] Nenhum dado pessoal completo em log.
- [ ] A tela deixa claro que não é reserva e que não há cobrança.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Solicitação válida | `201`; reserva e 3 ocupações pendentes |
| 2 | 2 simultâneas, mesmas noites | 1 × `201`, 1 × `409` |
| 3 | 10 simultâneas, mesmas noites | 1 × `201`, 9 × `409` |
| 4 | 2 simultâneas, casas diferentes | 2 × `201` |
| 5 | Noites parcialmente sobrepostas | `409` com a lista correta |
| 6 | Sobre pendência vencida | `201`; a antiga vira `EXPIRADA` |
| 7 | 4º pendente do mesmo e-mail | `429` |
| 8 | Mesmo e-mail com maiúsculas e espaços | Conta no mesmo limite |
| 9 | Honeypot preenchido | `201`; nada no banco |
| 10 | `_t = 1200` | `201`; nada no banco |
| 11 | `aceiteTermos` ausente | `400` |
| 12 | Nome com uma palavra | `400` |
| 13 | Nome com `<script>` | `400` |
| 14 | Observação com HTML | `400` |
| 15 | Observação de 2.000 chars | `400` |
| 16 | Telefone `(11) 99999-9999` | Gravado `+5511999999999` |
| 17 | Hóspedes acima da capacidade | `422` |
| 18 | Estadia abaixo do mínimo | `422` com `minimoExigido` |
| 19 | Check-in amanhã, antecedência 1 | `201` |
| 20 | Check-in hoje, antecedência 1 | `422` |
| 21 | Check-in a 13 meses | `422` |
| 22 | Casa inativa | `404` |
| 23 | Casa sem preços | `500` + log de erro |
| 24 | SES indisponível | `201` com `emailEnviado: false` |
| 25 | Corpo de 20 KB | `413` |
| 26 | Check-in em 10 h | `expiraEm` = 12 h antes do check-in (já no passado) → `422 ANTECEDENCIA_MINIMA` |
| 27 | Transação falha por conflito (não condição) | Retentado; sucesso |
| 28 | Invariantes após 20 rodadas de concorrência | Todas válidas |
