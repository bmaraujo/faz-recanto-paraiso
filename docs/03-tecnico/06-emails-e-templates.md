# 06 — E-mails e templates editáveis

Implementação das [regras de comunicação](../01-negocio/05-comunicacao-e-emails.md).

Este documento trata de um recurso com **superfície de segurança real**: o
administrador escreve texto que o sistema renderiza e envia. Fazer isso errado abre
caminho para injeção de HTML, vazamento de dados e e-mails usados como vetor de
phishing. As restrições abaixo não são negociáveis.

## Arquitetura do envio

```
transição de estado commitada
        │
        ▼
  enfileirarEmail(codigo, reservaId)
        │
        ├─ 1. carrega a reserva e verifica emailsEnviados → já enviado? para.
        ├─ 2. carrega o template (banco → fallback no código)
        ├─ 3. monta o contexto de variáveis (allowlist por código)
        ├─ 4. renderiza assunto, HTML e texto puro
        ├─ 5. envia pelo SES (timeout 5 s, 2 tentativas)
        └─ 6. sucesso → adiciona o código a emailsEnviados + historicoEnvios
              falha   → loga, e se o e-mail é essencial, gera ALERTA_ADMIN
```

O passo 5 acontece **depois** da resposta HTTP ao cliente, nunca antes.
Na Lambda isso significa: responder e só então enviar, dentro do mesmo handler, com o
envio protegido por `try/catch` que nunca derruba a resposta.

> Não usamos SQS. Com poucos e-mails por dia, uma fila adiciona um recurso, uma DLQ,
> uma permissão e um ponto de falha para resolver um problema que o `cron-diario` já
> resolve: reenviar o que falhou.

## O formato do template

Um template tem **assunto** e **corpo em Markdown**, ambos com placeholders:

```
Assunto: Recebemos sua solicitação para a {{casaNome}}

Olá {{hospedeNome}},

Recebemos sua solicitação de reserva:

- **Casa:** {{casaNome}}
- **Check-in:** {{checkin}} a partir das {{horarioCheckin}}
- **Check-out:** {{checkout}} até às {{horarioCheckout}}
- **Noites:** {{noites}}
- **Hóspedes:** {{hospedes}}
- **Valor estimado:** {{valorEstimado}}

> **Atenção:** esta ainda não é uma reserva confirmada e não houve nenhuma cobrança.
> Guardamos estas datas para você até **{{prazoLimite}}**.

Vamos entrar em contato para combinar os detalhes e a forma de pagamento.
Se preferir, fale com a gente agora: {{whatsappLink}}

Acompanhe sua solicitação: {{linkAcompanhamento}}
```

### O que o template NÃO tem

| Não existe | Por quê |
|---|---|
| `{{#if}}`, `{{#each}}`, loops, condicionais | Lógica no template é a porta de entrada de SSTI (server-side template injection). Nenhum motor Turing-completo roda texto do usuário aqui |
| Expressões, chamadas de função, acesso a objeto (`{{a.b.c}}`) | Idem. Só nomes simples de uma allowlist |
| HTML cru escrito pelo admin | O Markdown renderizado é sanitizado com allowlist |
| Inclusão de outros templates | Nada de resolução dinâmica de arquivo |
| `{{#raw}}` ou escape de escape | Nenhuma forma de desligar o escape |

**O motor de template é escrito por nós, em ~30 linhas**, e faz exatamente uma coisa:
substituir `{{nome}}` por um valor já escapado, quando `nome` está na allowlist.
Usar Handlebars, EJS, Nunjucks ou Liquid aqui seria trazer um motor poderoso para um
problema trivial e assumir risco de injeção sem necessidade.

### Renderização — ordem obrigatória

A ordem importa e é contraintuitiva:

```
1. Substituir os placeholders no Markdown, com cada valor ESCAPADO para Markdown
   (escapar * _ ` [ ] ( ) # ! | > \ e quebras de linha)
2. Converter o Markdown resultante em HTML
3. Sanitizar o HTML com allowlist de tags e atributos
4. Inlinear o CSS mínimo (clientes de e-mail ignoram <style> externo)
5. Gerar a versão em texto puro a partir do Markdown do passo 1 (não do HTML)
```

Se substituíssemos **depois** de converter o Markdown, um valor contendo `<script>`
entraria no HTML já sanitizado. Se não escapássemos para Markdown no passo 1, um nome
como `Maria [clique aqui](http://malicioso)` se tornaria um link.

**Allowlist de sanitização (passo 3):**
`p, br, strong, em, ul, ol, li, a, h1..h4, blockquote, hr, table, thead, tbody, tr, th, td, code, pre`.
Atributos: `href` em `<a>` apenas com esquema `https:` ou `mailto:`; `colspan`/`rowspan`
em células. Nada de `style`, `class`, `id`, `on*`, `<img>` com URL arbitrária,
`<iframe>`, `<script>`, `<style>`, `<object>`.

> `<img>` externo é bloqueado de propósito: além do risco, imagens remotas em e-mail
> funcionam como rastreador. O logotipo, se houver, entra como anexo `cid:` ou é
> omitido.

## Variáveis — allowlist por código de e-mail

Cada código tem seu próprio conjunto de variáveis permitidas, declarado **no código**:

```ts
// backend/src/templates/variaveis.ts
export const VARIAVEIS_PERMITIDAS = {
  SOLICITACAO_RECEBIDA: {
    obrigatorias: ["casaNome", "checkin", "checkout", "valorEstimado",
                   "prazoLimite", "linkAcompanhamento", "whatsappLink"],
    opcionais:    ["hospedeNome", "noites", "hospedes", "horarioCheckin",
                   "horarioCheckout", "nomeFazenda", "adminTelefone", "adminEmail"],
  },
  // ... um bloco por código
} as const;
```

Regras de validação ao salvar um template:

| # | Regra | Resultado |
|---|---|---|
| V1 | Todo `{{nome}}` usado está na allowlist daquele código | **Erro**, listando os desconhecidos |
| V2 | Todas as `obrigatorias` aparecem no corpo | **Erro**, listando as que faltam |
| V3 | O assunto não está vazio e tem ≤ 150 chars | **Erro** |
| V4 | O corpo tem ≤ 20.000 chars | **Erro** |
| V5 | O corpo não contém `<script`, `<iframe`, `javascript:`, `data:text/html` | **Erro** |
| V6 | O Markdown renderiza sem lançar exceção | **Erro** |
| V7 | A renderização com dados de exemplo produz HTML não vazio | **Erro** |
| V8 | Uma variável declarada opcional não é usada | Nenhum — é opcional |
| V9 | O corpo tem placeholder com erro de digitação próximo de um válido | **Aviso** com sugestão |

V5 é redundante com a sanitização (V5 barra na entrada, a sanitização barra na saída).
Redundância deliberada: defesa em profundidade em texto que vai para fora.

### Formatação dos valores

Os valores chegam ao template **já formatados em pt-BR**, nunca crus:

| Variável | Tipo interno | Valor no template |
|---|---|---|
| `checkin` | `"2026-11-20"` | `"20/11/2026"` |
| `prazoLimite` | ISO datetime | `"13/10/2026 às 18h04"` |
| `valorEstimado` | `220000` (centavos) | `"R$ 2.200,00"` |
| `noites` | `3` | `"3"` |
| `linkAcompanhamento` | — | URL absoluta com o token |

A formatação fica em `domain/formato.ts`, é pura e testada. O template nunca faz conta.

## Fallback e resiliência

```
carregarTemplate(codigo):
  1. GetItem TEMPLATE#<codigo>/META
  2. não existe        → usa o padrão de backend/src/templates/<codigo>.md
  3. existe mas falha a validação → usa o padrão + ALERTA_ADMIN
  4. ativo = false e e-mail não essencial → não envia
  5. ativo = false e e-mail essencial     → envia com o template vigente
                                            (o backoffice já impede desativar)
```

**Os templates padrão ficam versionados no repositório.** É o que garante que o sistema
funciona em uma conta nova, sem seed, e que uma edição ruim do admin nunca deixa o
sistema sem comunicação.

## Pré-visualização e envio de teste

`POST /api/admin/templates/{codigo}/previsualizar` renderiza o template **sem salvar**,
com dados de exemplo fixos (nunca dados de um hóspede real), e devolve `assunto`,
`html` e `texto`.

O HTML é exibido no backoffice dentro de um `<iframe sandbox>` com `srcdoc` — sem
`allow-scripts`, sem `allow-same-origin`. Injetar o HTML direto no DOM da SPA seria
XSS no próprio backoffice.

`POST /api/admin/templates/{codigo}/enviar-teste` envia para o **e-mail do admin
cadastrado na configuração**, nunca para um endereço informado na requisição.
Permitir destinatário arbitrário transformaria o backoffice em relay de spam
autenticado — e um dia a credencial do admin vaza.

Limite: 10 envios de teste por hora, controlado por um item com TTL.

## SES — configuração

| Item | Valor |
|---|---|
| Identidade | **Domínio** verificado com DKIM (3 registros CNAME) |
| SPF | Registro TXT com `include:amazonses.com` |
| DMARC | `v=DMARC1; p=none; rua=mailto:...` no início; endurecer para `quarantine` depois |
| Remetente | `reservas@<dominio>` `[DEFINIR]` |
| `Reply-To` | e-mail do administrador |
| Sandbox | **Precisa sair do sandbox antes da produção** (chamado na AWS, leva ~24 h) |
| Configuration Set | Com event destination para `Bounce` e `Complaint` → SNS → e-mail do admin |
| Custo | ~US$ 0,10 por 1.000 e-mails |

> Sair do sandbox do SES é um **bloqueador de produção** com prazo de resposta da AWS.
> Abra o chamado na Fase 0, não na véspera do lançamento. Em sandbox, só é possível
> enviar para endereços verificados — o que é suficiente para desenvolver.

### Bounce e complaint

Um `Bounce` permanente (e-mail inexistente) precisa de tratamento: a reputação do
domínio é um ativo. Ao receber a notificação:

1. Registrar na reserva que o e-mail do hóspede é inválido.
2. Gerar `ALERTA_ADMIN` com o telefone do hóspede, para contato por WhatsApp.
3. Não tentar novamente aquele endereço.

Taxa de bounce acima de 5% ou de complaint acima de 0,1% pode suspender a conta no SES.

## Log de e-mails

| Loga | Não loga |
|---|---|
| `codigo`, `reservaId`, `messageId` do SES, duração | Corpo renderizado |
| E-mail do destinatário **mascarado** (`ma***@exemplo.com`) | E-mail completo |
| Sucesso/falha e o erro do SES | Nome, telefone, valores |

## Lista de arquivos

```
backend/src/domain/templates.ts        validação + renderização (puro, testado)
backend/src/domain/formato.ts          formatação pt-BR de datas e moeda
backend/src/templates/variaveis.ts     allowlist por código
backend/src/templates/<CODIGO>.md      texto padrão, um arquivo por código
backend/src/lib/ses.ts                 envio com timeout e retry
backend/src/lib/emails.ts              orquestração: carregar, renderizar, enviar, registrar
```

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Template com `{{variavelInexistente}}` | Salvamento rejeitado, variável listada |
| 2 | Template sem variável obrigatória | Salvamento rejeitado, variável listada |
| 3 | Nome do hóspede `<script>alert(1)</script>` | HTML final sem `<script>`, texto escapado |
| 4 | Nome do hóspede `Maria [x](http://mal.co)` | Renderiza como texto literal, não como link |
| 5 | Corpo com `<iframe src=...>` | Rejeitado na validação (V5) |
| 6 | Corpo com `[link](javascript:alert(1))` | Sanitização remove o `href` |
| 7 | Template ausente no banco | E-mail sai com o padrão do código |
| 8 | Template inválido no banco | E-mail sai com o padrão + `ALERTA_ADMIN` |
| 9 | SES retorna erro | Transição preservada, código fora de `emailsEnviados`, alerta |
| 10 | Dois envios automáticos do mesmo código | Apenas um e-mail |
| 11 | Reenvio manual | Enviado; `historicoEnvios` com duas entradas |
| 12 | Envio de teste com destinatário no corpo | Ignorado; vai para o e-mail do admin |
| 13 | Valor `220000` centavos | Renderiza `R$ 2.200,00` |
| 14 | Data `2026-11-20` | Renderiza `20/11/2026` |
| 15 | Versão texto puro | Sem tag HTML, com os links visíveis |
| 16 | Desativar e-mail essencial | Rejeitado |
