# UC-A12 — Editar os textos dos e-mails

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado |
| Gatilho | O admin abre `/admin/emails` e edita um template |
| Fase | 3 |
| Relacionados | [06 — E-mails e templates](../../03-tecnico/06-emails-e-templates.md), [Comunicação](../../01-negocio/05-comunicacao-e-emails.md), [ADR-007](../../adr/ADR-007-templates-email-no-banco.md) |

## Objetivo de negócio

O texto dos e-mails é a **voz do proprietário**. Ele conhece o tom que funciona com os
hóspedes dele, sabe o que precisa explicar sobre a estrada, a chegada, as regras.
Um texto escrito pelo desenvolvedor nunca vai soar certo — e mudar uma vírgula não pode
exigir um deploy.

Este é o recurso que o usuário pediu explicitamente, e o que mais reduz a dependência
de desenvolvedor no dia a dia.

## O risco, e por que ele define o desenho da tela

Dar ao administrador o poder de escrever texto que o sistema renderiza e envia cria
três riscos concretos:

| Risco | Consequência | Mitigação |
|---|---|---|
| Quebrar um e-mail essencial | O hóspede não recebe a confirmação e ninguém descobre | Validação + fallback para o padrão do código + alerta |
| Injeção de HTML | E-mail com script ou link malicioso saindo do nosso domínio | Motor sem lógica + escape + sanitização com allowlist |
| Remover informação crítica | E-mail de solicitação sem o prazo ou sem o aviso de "não é reserva" | **Variáveis obrigatórias** por código de e-mail |

A tela é desenhada em torno dessas três mitigações: validar antes de salvar,
pré-visualizar antes de ativar, e nunca permitir ficar sem texto.

## Fluxo principal

1. O admin abre `/admin/emails` e vê a lista dos e-mails do sistema, com:
   - código e nome amigável;
   - quando cada um é enviado e para quem;
   - se foi personalizado ou está no texto padrão;
   - se é essencial (não pode ser desativado).
2. Clica em um e-mail.
3. Vê o editor em duas colunas: assunto e corpo em Markdown à esquerda, pré-visualização
   à direita, atualizada conforme digita.
4. Ao lado, a lista de **variáveis disponíveis** para aquele e-mail, com as obrigatórias
   destacadas e um clique para inserir no cursor.
5. Edita.
6. Clica em **"Enviar teste"** e recebe o e-mail no próprio endereço, para ver como
   fica no cliente de e-mail real.
7. Salva. O servidor valida e, se tudo estiver certo, grava e cria uma versão no
   histórico.
8. O próximo e-mail daquele tipo já sai com o novo texto.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Admin quer voltar ao padrão | Botão "Restaurar texto padrão": remove a personalização e volta ao do código |
| A2 | Admin quer voltar a uma versão anterior | "Ver histórico": últimas 10 versões, com data, autor e botão de restaurar |
| A3 | Admin desativa um e-mail **não** essencial | `ativo = false`; o e-mail deixa de ser enviado |
| A4 | Admin edita só o assunto | Permitido |
| A5 | Admin insere variável pela lista | Inserida no cursor, já no formato `{{nome}}` |
| A6 | Admin edita no celular | Editor em coluna única, com a pré-visualização em aba |
| A7 | Admin fecha sem salvar | Rascunho em `localStorage`; oferece restaurar ao reabrir |
| A8 | Admin quer comparar com o padrão | "Ver texto padrão" em painel lado a lado |

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Variável inexistente | `422 VARIAVEL_DESCONHECIDA` | "`{{nomeHospede}}` não existe. Você quis dizer `{{hospedeNome}}`?" |
| E2 | Falta variável obrigatória | `422 VARIAVEL_OBRIGATORIA_AUSENTE` | "O e-mail precisa conter `{{prazoLimite}}` — o hóspede precisa saber até quando as datas estão guardadas." |
| E3 | Corpo com `<script>` | `422 CONTEUDO_PROIBIDO` | "Não é possível usar HTML neste campo. Use a formatação do editor." |
| E4 | Link `javascript:` | `422 CONTEUDO_PROIBIDO` | Idem |
| E5 | Assunto vazio | `422` | Campo marcado |
| E6 | Corpo acima de 20.000 chars | `422` | Contador de caracteres fica vermelho |
| E7 | Markdown que não renderiza | `422` | "Não conseguimos formatar este texto." |
| E8 | Tentar desativar e-mail essencial | `422 EMAIL_ESSENCIAL` | "Este e-mail não pode ser desativado: o hóspede precisa receber a confirmação." |
| E9 | Teste com destinatário informado na requisição | — | Ignorado; vai para o e-mail do admin cadastrado |
| E10 | Mais de 10 testes em uma hora | `429` | "Limite de envios de teste. Tente em alguns minutos." |
| E11 | Falha no envio do teste | `200` do salvamento | "Não conseguimos enviar o teste agora." O texto **não é perdido** |
| E12 | Template no banco ficou inválido (ex.: variável removida do código) | — | O e-mail sai com o **padrão** e um `ALERTA_ADMIN` é gerado; a tela marca o template como "com problema" |
| E13 | Sessão expirada ao salvar | `401` | Renova e reenvia; rascunho preservado |

> **E1 com sugestão** (distância de Levenshtein contra a allowlist) transforma um erro
> frustrante em correção de um clique. É o tipo de detalhe que decide se o admin usa
> ou abandona o recurso.
>
> **E2 é a proteção de negócio mais importante deste UC.** Sem ela, o admin apagaria
> `{{prazoLimite}}` do e-mail de solicitação e o hóspede nunca saberia que as datas
> têm prazo. A mensagem precisa **explicar por que** a variável é obrigatória, não só
> exigi-la.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Todo e-mail do catálogo tem texto padrão **no código** |
| RN2 | O banco guarda apenas o que o admin personalizou |
| RN3 | Sem personalização, usa-se o padrão |
| RN4 | Com personalização inválida, usa-se o padrão + `ALERTA_ADMIN` |
| RN5 | Toda variável usada precisa estar na allowlist **daquele** código |
| RN6 | Toda variável obrigatória precisa aparecer no corpo |
| RN7 | HTML cru é proibido no corpo |
| RN8 | O motor de template **não tem lógica**: só substituição de `{{nome}}` |
| RN9 | Os valores são escapados antes da substituição e o HTML é sanitizado depois |
| RN10 | E-mails essenciais não podem ser desativados |
| RN11 | Cada salvamento cria uma versão; as 10 últimas são guardadas |
| RN12 | O envio de teste vai **sempre** para o e-mail do admin da configuração |
| RN13 | Limite de 10 testes por hora |
| RN14 | A pré-visualização usa dados de exemplo, **nunca** de um hóspede real |
| RN15 | O HTML da pré-visualização é exibido em `<iframe sandbox>` |
| RN16 | Toda escrita registra autor e data |
| RN17 | `motivoInterno` e `observacaoInterna` **não existem** em nenhuma allowlist |

> RN17 é um impedimento **estrutural**, não uma orientação: como a allowlist é
> declarada no código e a validação rejeita o que não está nela, é impossível o admin
> vazar o motivo interno de uma recusa para o hóspede, mesmo querendo.

## Catálogo editável

| Código | Nome na tela | Para | Essencial |
|---|---|---|---|
| `SOLICITACAO_RECEBIDA` | Solicitação recebida | Hóspede | **Sim** |
| `NOVA_SOLICITACAO_ADMIN` | Nova solicitação (para você) | Admin | **Sim** |
| `RESERVA_CONFIRMADA` | Reserva confirmada | Hóspede | **Sim** |
| `SOLICITACAO_RECUSADA` | Solicitação não confirmada | Hóspede | Sim |
| `SOLICITACAO_EXPIRADA` | Prazo encerrado | Hóspede | Sim |
| `RESERVA_CANCELADA` | Reserva cancelada | Hóspede | Sim |
| `PRAZO_ESTENDIDO` | Prazo estendido | Hóspede | Não |
| `PRAZO_EXPIRANDO_ADMIN` | Prazo acabando (para você) | Admin | Sim |
| `PRE_CHECKIN` | Instruções de chegada | Hóspede | Sim |
| `POS_ESTADIA` | Agradecimento | Hóspede | **Não** |
| `ALERTA_ADMIN` | Alerta do sistema | Admin | **Sim** |

> `PRE_CHECKIN` é o mais importante para a experiência do hóspede e o que o
> proprietário mais vai querer personalizar: endereço, estrada, portão, contato do
> caseiro. É o texto que hoje ele manda à mão em cada reserva.
>
> `ALERTA_ADMIN` é editável apenas no texto ao redor; o bloco técnico (tipo do alerta,
> casa, datas, horário) é **gerado pelo sistema** e anexado sempre.

## Contrato técnico

### `GET /api/admin/templates`

```json
{
  "templates": [
    { "codigo": "SOLICITACAO_RECEBIDA", "nome": "Solicitação recebida",
      "descricao": "Enviado ao hóspede imediatamente após a solicitação.",
      "destinatario": "HOSPEDE", "essencial": true,
      "personalizado": true, "ativo": true, "valido": true,
      "versao": 3, "atualizadoEm": "...", "atualizadoPor": "..." }
  ]
}
```

### `GET /api/admin/templates/{codigo}`

```json
{
  "codigo": "SOLICITACAO_RECEBIDA",
  "assunto": "Recebemos sua solicitação para a {{casaNome}}",
  "corpoMarkdown": "Olá {{hospedeNome}},\n\n...",
  "ativo": true,
  "essencial": true,
  "versao": 3,
  "padrao": { "assunto": "...", "corpoMarkdown": "..." },
  "variaveis": {
    "obrigatorias": [
      { "nome": "casaNome", "descricao": "Nome da casa", "exemplo": "Casa do Lago",
        "porQueObrigatoria": "O hóspede precisa saber de qual casa é a solicitação." },
      { "nome": "prazoLimite", "descricao": "Prazo da pré-reserva",
        "exemplo": "13/10/2026 às 18h04",
        "porQueObrigatoria": "O hóspede precisa saber até quando as datas estão guardadas." }
    ],
    "opcionais": [
      { "nome": "hospedeNome", "descricao": "Primeiro nome do hóspede", "exemplo": "Maria" }
    ]
  }
}
```

O campo `porQueObrigatoria` alimenta a mensagem de E2 — o servidor explica a regra, a
interface só exibe.

### `PUT /api/admin/templates/{codigo}`

```json
{ "assunto": "...", "corpoMarkdown": "...", "ativo": true, "versao": 3 }
```

Resposta `200` com o template salvo, `versao` incrementada e `avisos[]`.

`422` de validação:

```json
{
  "erro": "VARIAVEL_DESCONHECIDA",
  "mensagem": "Algumas variáveis não existem neste e-mail.",
  "detalhes": {
    "problemas": [
      { "variavel": "nomeHospede", "sugestao": "hospedeNome", "posicao": 42 }
    ]
  }
}
```

### Outras rotas

| Rota | Função |
|---|---|
| `POST .../previsualizar` | Renderiza sem salvar; devolve `assunto`, `html`, `texto`, `erros`, `avisos` |
| `POST .../enviar-teste` | Envia ao e-mail do admin; corpo opcional com o texto não salvo |
| `POST .../restaurar-padrao` | Remove a personalização |
| `GET .../versoes` | Últimas 10 versões |
| `POST .../restaurar-versao` | `{ "versao": 2 }` |

### Erros

| Código | HTTP |
|---|---|
| `ENTRADA_INVALIDA` | 400 |
| `NAO_ENCONTRADO` | 404 (código inexistente) |
| `CONFLITO_VERSAO` | 409 |
| `VARIAVEL_DESCONHECIDA` | 422 |
| `VARIAVEL_OBRIGATORIA_AUSENTE` | 422 |
| `CONTEUDO_PROIBIDO` | 422 |
| `EMAIL_ESSENCIAL` | 422 |
| `MARKDOWN_INVALIDO` | 422 |
| `MUITAS_REQUISICOES` | 429 (teste) |

## Implementação

Detalhes do motor, da ordem de renderização e da sanitização em
[06 — E-mails e templates](../../03-tecnico/06-emails-e-templates.md).
Aqui, o que é específico deste UC:

### Sugestão de variável (E1)

```ts
function sugerirVariavel(desconhecida: string, permitidas: string[]): string | null {
  const candidatas = permitidas
    .map((p) => ({ nome: p, distancia: levenshtein(desconhecida.toLowerCase(), p.toLowerCase()) }))
    .filter((c) => c.distancia <= 3)
    .sort((a, b) => a.distancia - b.distancia);
  return candidatas[0]?.nome ?? null;
}
```

Limiar 3 pega os erros reais (`nomeHospede` → `hospedeNome`, `check_in` → `checkin`)
sem sugerir absurdos.

### Pré-visualização segura (RN15)

```html
<iframe sandbox srcdoc="<html escapado>" title="Pré-visualização do e-mail"></iframe>
```

`sandbox` **sem** `allow-scripts` e **sem** `allow-same-origin`. Injetar o HTML no DOM
da SPA seria XSS no backoffice — e o backoffice tem o token do admin no
`sessionStorage`.

### Histórico de versões

```
Antes de sobrescrever TEMPLATE#<codigo>/META:
  Put TEMPLATE#<codigo>/V#<ISO atual>  com o conteúdo anterior
Depois:
  Query TEMPLATE#<codigo>, SK begins_with "V#", ordem decrescente
  Delete das versões além da 10ª
```

A poda roda no mesmo handler, após o salvamento. Se falhar, não é problema: sobram
algumas versões a mais, o que custa KB.

### Armadilhas

1. **Variáveis obrigatórias com explicação** (E2/RN6). A mensagem precisa dizer **por
   que**, senão o admin acha que é burocracia e reclama.
2. **Pré-visualização em `<iframe sandbox>`** (RN15).
3. **Nunca aceitar destinatário no envio de teste** (RN12/E9). Permitir seria
   transformar o backoffice em relay de spam autenticado.
4. **Fallback silencioso é perigoso** (E12): se o template do banco for inválido, o
   e-mail sai com o padrão — mas o admin **precisa saber**, senão vai achar que o texto
   dele está sendo usado. Daí o `ALERTA_ADMIN` e a marcação na lista.
5. **Dados de exemplo fixos na pré-visualização** (RN14). Usar um hóspede real para
   "ficar realista" vazaria dado pessoal na tela e no e-mail de teste.
6. **Escape de Markdown antes da substituição**, não depois. Ver
   [06 — E-mails](../../03-tecnico/06-emails-e-templates.md#renderização--ordem-obrigatória).
7. **Rascunho local** (A7): perder um `PRE_CHECKIN` de 2.000 caracteres por sessão
   expirada é inaceitável.
8. **`ALERTA_ADMIN` precisa do bloco técnico sempre**, independente do que o admin
   escreveu.

## Interface

```
E-mails do sistema
┌─────────────────────────────────────────────────────────────────┐
│ PARA O HÓSPEDE                                                   │
│  ✓ Solicitação recebida        personalizado   essencial    ›    │
│  ✓ Reserva confirmada          personalizado   essencial    ›    │
│  ⚠ Instruções de chegada       com problema    essencial    ›    │
│  · Solicitação não confirmada  texto padrão                 ›    │
│  · Prazo encerrado             texto padrão                 ›    │
│  · Reserva cancelada           texto padrão                 ›    │
│  · Prazo estendido             texto padrão    desativado   ›    │
│  · Agradecimento               texto padrão    desativado   ›    │
│ PARA VOCÊ                                                        │
│  ✓ Nova solicitação            personalizado   essencial    ›    │
│  · Prazo acabando              texto padrão    essencial    ›    │
│  · Alerta do sistema           texto padrão    essencial    ›    │
└─────────────────────────────────────────────────────────────────┘
```

Editor:

```
Solicitação recebida                       Enviado ao hóspede após a solicitação
┌──────────────────────────────────┬──────────────────────────────────┐
│ Assunto                           │  PRÉ-VISUALIZAÇÃO               │
│ [ Recebemos sua solicitação     ] │  ┌────────────────────────────┐ │
│ [ para a {{casaNome}}           ] │  │ Recebemos sua solicitação  │ │
│                                    │  │ para a Casa do Lago        │ │
│ Mensagem                           │  │                            │ │
│ ┌────────────────────────────────┐│  │ Olá Maria,                 │ │
│ │ Olá {{hospedeNome}},           ││  │                            │ │
│ │                                ││  │ Recebemos sua solicitação: │ │
│ │ Recebemos sua solicitação:     ││  │                            │ │
│ │                                ││  │ • Casa: Casa do Lago       │ │
│ │ - **Casa:** {{casaNome}}       ││  │ • Check-in: 20/11/2026     │ │
│ │ - **Check-in:** {{checkin}}    ││  │ ...                        │ │
│ │ ...                            ││  └────────────────────────────┘ │
│ └────────────────────────────────┘│   [ HTML ] [ Texto puro ]       │
│ 1.284 / 20.000 caracteres          │                                  │
├──────────────────────────────────┴──────────────────────────────────┤
│ VARIÁVEIS DISPONÍVEIS                              clique p/ inserir │
│ Obrigatórias:                                                        │
│  {{casaNome}} ✓   {{checkin}} ✓   {{checkout}} ✓                     │
│  {{valorEstimado}} ✓   {{prazoLimite}} ✓   {{linkAcompanhamento}} ✓  │
│  {{whatsappLink}} ✓                                                  │
│ Opcionais:                                                           │
│  {{hospedeNome}}  {{noites}}  {{hospedes}}  {{horarioCheckin}} ...   │
├──────────────────────────────────────────────────────────────────────┤
│ [ Ver texto padrão ] [ Restaurar padrão ] [ Histórico ]              │
│ [ Enviar teste para mim ]                        [ Salvar ]          │
└──────────────────────────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| Pré-visualização ao vivo | Debounce de 500 ms; renderizada no servidor para ser idêntica ao envio |
| Variáveis obrigatórias com ✓ | Mostra em tempo real quais já estão presentes |
| Obrigatória ausente | Marcada em vermelho na lista, **antes** de tentar salvar |
| Clique insere no cursor | Evita erro de digitação |
| Contador de caracteres | Vermelho ao aproximar do limite |
| Abas HTML / Texto puro | O admin vê as duas versões que o hóspede pode receber |
| "Enviar teste para mim" | Rótulo deixa claro para onde vai |
| Erro de validação | Destaca a posição no texto |
| "Com problema" na lista | E12 fica visível, não silencioso |
| Rascunho | `localStorage` por código |
| Mobile | Coluna única, pré-visualização em aba |

> A pré-visualização ser **renderizada no servidor** é uma decisão importante: garante
> que o que o admin vê é exatamente o que o hóspede recebe, com o mesmo escape e a
> mesma sanitização. Renderizar no cliente com outra biblioteca produziria diferenças
> justamente nos casos de borda.

## Segurança e privacidade

| Risco | Mitigação |
|---|---|
| SSTI (injeção no motor de template) | Motor próprio, ~30 linhas, **sem** lógica, sem acesso a objeto, sem `eval` |
| XSS no e-mail | Escape de Markdown na substituição + sanitização com allowlist na saída |
| XSS no backoffice | Pré-visualização em `<iframe sandbox>` |
| Relay de spam | Teste só para o e-mail do admin + limite de 10/hora |
| Vazamento de dado interno | Allowlist por código; `motivoInterno` não existe em nenhuma |
| Vazamento de dado de hóspede | Pré-visualização com dados de exemplo fixos |
| Quebra de comunicação | Fallback para o padrão + `ALERTA_ADMIN` |
| Rastreador em e-mail | `<img>` externo bloqueado pela sanitização |
| Auditoria | Histórico de 10 versões com autor e data |

## Critérios de aceite

- [ ] Todos os e-mails do catálogo são editáveis (assunto e corpo).
- [ ] Sem personalização, o e-mail sai com o texto padrão do código.
- [ ] Variável inexistente é rejeitada **com sugestão**.
- [ ] Variável obrigatória ausente é rejeitada **com a explicação do porquê**.
- [ ] HTML cru é rejeitado.
- [ ] `javascript:` em link é rejeitado.
- [ ] Nome de hóspede com `<script>` não produz HTML executável.
- [ ] Nome de hóspede com sintaxe Markdown aparece como texto literal.
- [ ] E-mail essencial não pode ser desativado.
- [ ] E-mail não essencial desativado deixa de ser enviado.
- [ ] A pré-visualização é renderizada no servidor e exibida em `<iframe sandbox>`.
- [ ] A pré-visualização usa dados de exemplo, nunca de hóspede real.
- [ ] O envio de teste vai **sempre** ao e-mail do admin.
- [ ] Mais de 10 testes por hora retorna `429`.
- [ ] Cada salvamento cria versão; 10 são mantidas.
- [ ] Restaurar padrão e restaurar versão funcionam.
- [ ] Template inválido no banco faz o e-mail sair com o padrão + `ALERTA_ADMIN`.
- [ ] Template com problema aparece marcado na lista.
- [ ] `motivoInterno` não existe em nenhuma allowlist.
- [ ] Valores aparecem como `R$ 2.200,00` e datas como `20/11/2026`.
- [ ] Toda versão registra autor e data.
- [ ] Rascunho preservado após falha de sessão.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Salvar template válido | `200`; `versao` + 1 |
| 2 | `{{nomeHospede}}` | `422` com sugestão `hospedeNome` |
| 3 | `{{xyz}}` (sem similar) | `422` sem sugestão |
| 4 | Corpo sem `{{prazoLimite}}` em `SOLICITACAO_RECEBIDA` | `422` com a explicação |
| 5 | `<script>alert(1)</script>` no corpo | `422 CONTEUDO_PROIBIDO` |
| 6 | `<iframe>` no corpo | `422` |
| 7 | `[x](javascript:alert(1))` | `422` ou `href` removido na sanitização |
| 8 | Hóspede chamado `<b>Maria</b>` | HTML final com o texto escapado |
| 9 | Hóspede chamado `Maria [a](http://mal.co)` | Texto literal, não link |
| 10 | Assunto vazio | `422` |
| 11 | Corpo com 25.000 chars | `422` |
| 12 | Markdown malformado | `422 MARKDOWN_INVALIDO` |
| 13 | Desativar `RESERVA_CONFIRMADA` | `422 EMAIL_ESSENCIAL` |
| 14 | Desativar `POS_ESTADIA` | `200`; não é mais enviado |
| 15 | Pré-visualizar sem salvar | Renderizado; nada gravado |
| 16 | Pré-visualização com dados reais | Nunca ocorre; sempre exemplos |
| 17 | Teste com `destinatario` no corpo | Ignorado; vai ao admin |
| 18 | 11º teste na hora | `429` |
| 19 | Salvar 12 vezes | 10 versões no histórico |
| 20 | Restaurar versão 2 | Conteúdo voltou; nova versão criada |
| 21 | Restaurar padrão | Personalização removida; padrão em uso |
| 22 | Template do banco apagado | E-mail com o padrão |
| 23 | Template do banco com variável removida do código | Padrão + `ALERTA_ADMIN` + marcação na lista |
| 24 | `{{valorEstimado}}` com 220000 centavos | `R$ 2.200,00` |
| 25 | `{{checkin}}` com `2026-11-20` | `20/11/2026` |
| 26 | `{{prazoLimite}}` | `13/10/2026 às 18h04` |
| 27 | Versão texto puro | Sem tag HTML; links visíveis |
| 28 | `ALERTA_ADMIN` personalizado | Bloco técnico presente de qualquer forma |
| 29 | `PUT` com `versao` antiga | `409 CONFLITO_VERSAO` |
| 30 | Allowlist de qualquer código | Não contém `motivoInterno` |
