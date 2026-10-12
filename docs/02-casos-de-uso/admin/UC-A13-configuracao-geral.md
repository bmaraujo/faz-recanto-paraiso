# UC-A13 — Ajustar a configuração geral

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado |
| Gatilho | O admin abre `/admin/config` |
| Fase | 2 |
| Relacionados | [02 — Modelo de dados](../../03-tecnico/02-modelo-de-dados.md), [UC-A14](./UC-A14-publicar-site.md), [Política de cancelamento](../../01-negocio/04-politica-de-cancelamento.md) |

## Objetivo de negócio

Reunir em um lugar tudo que é global ao negócio e que o proprietário precisa poder
mudar sem deploy: contato, prazos, horários, política de cancelamento e os textos
legais.

Alguns desses valores **mudam o comportamento do sistema** (prazo da pré-reserva,
antecedência mínima), outros só o conteúdo (textos legais). A tela precisa separar
visualmente os dois, porque o risco é diferente.

## Grupos de configuração

### 1. Identidade e contato
| Campo | Efeito |
|---|---|
| `nomeFazenda` | Títulos, e-mails, JSON-LD |
| `whatsapp` | Botão flutuante e links ([UC-P07](../publico/UC-P07-contato-direto.md)) |
| `emailAdmin` | Destino dos e-mails de admin e dos testes de template |
| `emailRemetente` | Remetente dos e-mails (precisa estar verificado no SES) |
| `emailResponder` | `Reply-To` dos e-mails ao hóspede |

### 2. Regras de reserva — **mudam o comportamento**
| Campo | Padrão | Efeito |
|---|---|---|
| `prazoSolicitacaoHoras` | 48 | Quanto tempo a pré-reserva segura as datas |
| `antecedenciaMinimaDias` | 1 | Mínimo de dias até o check-in |
| `janelaReservaMeses` | 12 | Até quando se pode reservar |
| `maxSolicitacoesPendentesPorEmail` | 3 | Limite antiabuso |

### 3. Horários
| Campo | Padrão |
|---|---|
| `horarioCheckin` | 14:00 |
| `horarioCheckout` | 12:00 |

### 4. Política de cancelamento
`faixasCancelamento[]` e `devolveTaxaLimpeza` — ver
[política de cancelamento](../../01-negocio/04-politica-de-cancelamento.md).

### 5. Textos legais (Markdown)
`textoCancelamento`, `textoPrivacidade`, `textoTermos`, `textoRegrasGerais`, `faq[]`.

## Fluxo principal

1. O admin abre `/admin/config` e vê os cinco grupos em seções.
2. Edita o que precisa.
3. A tela avisa, ao lado dos campos do grupo 2, **qual é o efeito** da mudança.
4. Salva. O servidor valida.
5. Mudanças de comportamento valem **imediatamente**; mudanças de texto exigem
   publicar ([UC-A14](./UC-A14-publicar-site.md)).

> O passo 5 é uma distinção que confunde se não for explicada: alterar
> `prazoSolicitacaoHoras` muda a próxima solicitação na hora, porque a API lê a
> configuração do banco. Alterar `textoPrivacidade` só aparece no site depois de
> publicar, porque a página é estática. A tela precisa dizer isso campo a campo.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Admin muda o prazo da pré-reserva | Vale para **novas** solicitações; as existentes mantêm o prazo já calculado |
| A2 | Admin troca o `emailRemetente` | Validação avisa se o domínio não está verificado no SES |
| A3 | Admin edita a política de cancelamento | Vale para novos cálculos; reservas existentes não mudam |
| A4 | Admin adiciona pergunta na FAQ | Aparece no site depois de publicar |
| A5 | Admin quer ver o efeito do prazo | A tela mostra um exemplo: "uma solicitação feita agora expiraria em 13/10 às 18h04" |
| A6 | Admin edita no celular | Seções recolhíveis |

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | `whatsapp` em formato inválido | `422` | "Informe o número com DDD, ex.: (11) 99999-9999." |
| E2 | E-mail inválido | `422` | Campo marcado |
| E3 | `emailRemetente` com domínio não verificado no SES | `200` + **aviso** | "Este domínio não está verificado no SES. Os e-mails podem não ser entregues." |
| E4 | `prazoSolicitacaoHoras` fora de 1–720 | `422` | "O prazo deve ser entre 1 hora e 30 dias." |
| E5 | `antecedenciaMinimaDias` fora de 0–90 | `422` | Campo marcado |
| E6 | `janelaReservaMeses` fora de 1–24 | `422` | Campo marcado |
| E7 | `horarioCheckout` depois de `horarioCheckin` | `200` + **aviso** | "O check-out está depois do check-in. Isso impede troca de hóspede no mesmo dia." |
| E8 | Faixas de cancelamento em ordem crescente | `422` | "Ordene as faixas do prazo maior para o menor." |
| E9 | Última faixa com `diasMinimos != 0` | `422` | "A última faixa precisa cobrir 0 dias." |
| E10 | `percentualDevolucao` fora de 0–100 | `422` | Campo marcado |
| E11 | Texto legal vazio | `200` + **aviso** | "A página de privacidade ficará vazia." |
| E12 | Markdown inválido | `422` | Campo marcado |
| E13 | Edição concorrente | `409 CONFLITO_VERSAO` | "Alterado em outra aba. Recarregue." |
| E14 | Sessão expirada | `401` | Renova; rascunho preservado |

> **E7 é um aviso, não um erro:** check-out às 15h e check-in às 14h é incomum, mas o
> proprietário pode ter uma razão (casa única, sem troca no mesmo dia). O sistema
> alerta sobre a consequência e deixa ele decidir.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Item único: `PK = CONFIG, SK = GERAL` |
| RN2 | Mudanças do grupo 2 valem para **novas** operações; as em curso não mudam |
| RN3 | `prazoSolicitacaoHoras`: 1 a 720 |
| RN4 | `antecedenciaMinimaDias`: 0 a 90 |
| RN5 | `janelaReservaMeses`: 1 a 24 |
| RN6 | `maxSolicitacoesPendentesPorEmail`: 1 a 20 |
| RN7 | `whatsapp` em E.164 após normalização |
| RN8 | E-mails validados; `emailRemetente` verificado contra o SES |
| RN9 | Faixas de cancelamento em ordem **decrescente** de `diasMinimos`, sem repetição |
| RN10 | A última faixa tem `diasMinimos = 0` |
| RN11 | `percentualDevolucao` entre 0 e 100 |
| RN12 | Textos legais em Markdown, sanitizados na renderização |
| RN13 | Alterar texto marca `publicacaoPendente` |
| RN14 | Só os campos públicos vão para `GET /api/config-publica` |
| RN15 | Cada salvamento cria versão; 5 são guardadas |
| RN16 | Registra autor e data |

### Campos públicos vs. privados (RN14)

| Público (`/api/config-publica`) | Privado (só backoffice) |
|---|---|
| `nomeFazenda`, `whatsapp` | `emailAdmin` |
| `horarioCheckin`, `horarioCheckout` | `emailRemetente`, `emailResponder` |
| `antecedenciaMinimaDias`, `janelaReservaMeses` | `maxSolicitacoesPendentesPorEmail` |
| `faixasCancelamento`, `devolveTaxaLimpeza` | `prazoSolicitacaoHoras` |
| Todos os textos legais e a FAQ | |

> `prazoSolicitacaoHoras` é privado por escolha: o site **informa o prazo concreto** de
> cada solicitação (`prazoLimite`), que é o que o hóspede precisa. Expor o parâmetro
> global não ajuda ninguém e revela o funcionamento interno.
>
> `maxSolicitacoesPendentesPorEmail` é privado porque é um controle antiabuso —
> publicar o limite ajuda quem quer contorná-lo.

## Contrato técnico

### `GET /api/admin/config`

Devolve todos os campos, mais:

```json
{
  "versao": 12,
  "avisos": [
    { "codigo": "DOMINIO_NAO_VERIFICADO", "campo": "emailRemetente",
      "mensagem": "O domínio exemplo.com.br não está verificado no SES." }
  ],
  "statusSes": { "remetenteVerificado": false, "foraDoSandbox": false },
  "exemploPrazo": "Uma solicitação feita agora expiraria em 13/10/2026 às 18h04."
}
```

`statusSes` é consultado no SES (com cache de 5 min) — é o que permite o aviso de E3
e torna visível o bloqueador de produção "sair do sandbox".

### `PUT /api/admin/config`

Corpo com todos os campos + `versao`. Resposta `200` com a configuração, `avisos[]` e
`publicacaoPendente`.

### Erros

| Código | HTTP |
|---|---|
| `ENTRADA_INVALIDA` | 400 |
| `CONFIGURACAO_INVALIDA` | 422 (com `detalhes.erros[]`) |
| `CONFLITO_VERSAO` | 409 |

## Implementação

| Arquivo | O que faz |
|---|---|
| `packages/shared/src/config.ts` | Schema zod + `validarConfigGeral` (pura) |
| `backend/src/lib/config.ts` | Leitura com **cache em memória por invocação** |
| `backend/src/handlers/api-admin.ts` | Rotas |
| `site/src/components/admin/FormularioConfig.tsx` | Formulário |

### Cache da configuração

A configuração é lida em praticamente **toda** operação (cotação, solicitação,
e-mail). Um `GetItem` por leitura seria desperdício.

```ts
// lib/config.ts
let cache: { valor: ConfigGeral; em: number } | null = null;
const TTL_MS = 60_000;

export async function obterConfig(): Promise<ConfigGeral> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.valor;
  const valor = await lerConfigDoBanco();
  cache = { valor, em: Date.now() };
  return valor;
}
```

Cache por **container** da Lambda, com TTL de 60 s. Consequência: uma mudança pode
levar até 60 s para valer em todos os containers ativos. Aceitável — e o `PUT` limpa
o cache do container que atendeu, então a tela do admin já reflete a mudança.

> Não use cache sem TTL: o container da Lambda vive minutos ou horas, e uma
> configuração alterada ficaria presa até ele morrer.

### Armadilhas

1. **Mudança não retroativa** (RN2). O `expiraEm` já gravado nas solicitações
   existentes **não** muda. Calcular o prazo na leitura em vez de gravá-lo tornaria
   uma mudança de configuração capaz de expirar solicitações em curso.
2. **Cache com TTL** — ver acima.
3. **Campos públicos explícitos** (RN14): a função de projeção lista os campos
   permitidos (allowlist), **não** remove os proibidos (denylist). Um campo novo
   adicionado no futuro fica privado por padrão, que é o lado seguro do erro.
4. **Faixas de cancelamento ordenadas** (RN9/RN10): validar a ordem, senão o cálculo
   aplica a faixa errada.
5. **Normalizar o WhatsApp** antes de gravar: o link `wa.me` precisa de dígitos puros.
6. **`statusSes` com cache**: `GetIdentityVerificationAttributes` a cada abertura da
   tela é chamada desnecessária.
7. **Markdown sanitizado na renderização**, como em [UC-A02](./UC-A02-gerenciar-casas.md).

## Interface

```
Configuração                                            versão 12
┌───────────────────────────────────────────────────────────────┐
│ ▾ IDENTIDADE E CONTATO                                         │
│   Nome               [ Recanto Paraíso ___________ ]           │
│   WhatsApp           [ (11) 99999-9999 ___________ ]           │
│   Seu e-mail         [ proprietario@exemplo.com.br  ]          │
│   E-mail remetente   [ reservas@exemplo.com.br ____ ]          │
│     ⚠ Domínio não verificado no SES. [ Como verificar ]        │
│   Responder para     [ proprietario@exemplo.com.br  ]          │
│                                                                 │
│ ▾ REGRAS DE RESERVA              ⚡ valem imediatamente         │
│   Prazo da pré-reserva    [ 48 ] horas                          │
│     ⓘ Uma solicitação feita agora expiraria em 13/10 às 18h04. │
│   Antecedência mínima     [ 1 ] dia(s)                          │
│     ⓘ A data mais próxima que alguém pode pedir é 12/10/2026.   │
│   Janela de reserva       [ 12 ] meses                          │
│     ⓘ A data mais distante é 11/10/2027.                        │
│   Máx. pedidos por e-mail [ 3 ]                                 │
│                                                                 │
│ ▾ HORÁRIOS                                                      │
│   Check-in a partir de    [ 14:00 ]                             │
│   Check-out até           [ 12:00 ]                             │
│                                                                 │
│ ▾ POLÍTICA DE CANCELAMENTO                                      │
│   Até 30 dias antes  →  devolver [ 100 ]%              🗑       │
│   Até 15 dias antes  →  devolver [  50 ]%              🗑       │
│   Menos que isso     →  devolver [   0 ]%                       │
│                                      [ + Adicionar faixa ]      │
│   [x] Devolver a taxa de limpeza em qualquer cancelamento        │
│                                                                 │
│ ▾ TEXTOS DO SITE                 📄 precisam de publicação      │
│   Política de cancelamento  [ editar ]  ✓ preenchido            │
│   Política de privacidade   [ editar ]  ⚠ vazio                 │
│   Termos de uso             [ editar ]  ✓ preenchido            │
│   Regras gerais             [ editar ]  ✓ preenchido            │
│   Perguntas frequentes      [ editar ]  6 perguntas             │
│                                                                 │
│                                              [ Salvar ]         │
└───────────────────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| ⚡ vs. 📄 | Distingue o que vale na hora do que precisa publicar |
| Exemplo calculado | "expiraria em 13/10 às 18h04" — o admin vê o efeito, não o parâmetro |
| Aviso do SES junto ao campo | Torna visível um bloqueador de produção |
| Seções recolhíveis | A tela é longa; no celular, essencial |
| Textos legais em diálogo | Editor de Markdown com pré-visualização |
| Status de cada texto | "vazio" é um aviso visível |
| Salvar | Único, no fim, explícito |
| Histórico | 5 versões com restauração |
| Rascunho | `localStorage` |

> Mostrar "a data mais próxima que alguém pode pedir é 12/10/2026" em vez de só
> "antecedência mínima: 1 dia" é o que faz o admin entender o parâmetro sem precisar
> de documentação.

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` |
| Campos privados | Allowlist de projeção para o endpoint público (RN14) |
| `emailAdmin` | Nunca público — evita coleta para spam |
| Limite antiabuso | Nunca público |
| Markdown | Sanitizado na renderização |
| Textos legais | Conteúdo do proprietário; a responsabilidade legal é dele |
| Auditoria | 5 versões com autor e data |
| Log | Campos alterados e `sub` do admin; **não** os valores dos textos |

## Critérios de aceite

- [ ] Todos os cinco grupos são editáveis.
- [ ] `prazoSolicitacaoHoras` fora de 1–720 é rejeitado.
- [ ] `antecedenciaMinimaDias` fora de 0–90 é rejeitado.
- [ ] `janelaReservaMeses` fora de 1–24 é rejeitado.
- [ ] WhatsApp inválido é rejeitado; válido é normalizado para E.164.
- [ ] `emailRemetente` não verificado no SES gera **aviso**, não erro.
- [ ] Faixas de cancelamento em ordem crescente são rejeitadas.
- [ ] Última faixa sem `diasMinimos = 0` é rejeitada.
- [ ] `percentualDevolucao` fora de 0–100 é rejeitado.
- [ ] Check-out depois do check-in gera aviso.
- [ ] Mudar o prazo **não** altera solicitações existentes.
- [ ] Mudar a política **não** altera reservas existentes.
- [ ] `GET /api/config-publica` não contém `emailAdmin`, `emailRemetente`, `emailResponder` nem os limites internos.
- [ ] Texto alterado marca `publicacaoPendente`.
- [ ] Regra de reserva alterada vale em até 60 s, sem publicar.
- [ ] A tela mostra o exemplo calculado de cada prazo.
- [ ] 5 versões no histórico, com restauração.
- [ ] Edição concorrente gera `409`.
- [ ] Rascunho preservado após falha de sessão.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Salvar configuração válida | `200`; `versao` + 1 |
| 2 | `prazoSolicitacaoHoras: 0` | `422` |
| 3 | `prazoSolicitacaoHoras: 800` | `422` |
| 4 | `prazoSolicitacaoHoras: 72` | `200`; nova solicitação com 72 h |
| 5 | Solicitação criada antes da mudança | `expiraEm` inalterado |
| 6 | `antecedenciaMinimaDias: 100` | `422` |
| 7 | `janelaReservaMeses: 30` | `422` |
| 8 | WhatsApp `(11) 99999-9999` | Gravado `+5511999999999` |
| 9 | WhatsApp `abc` | `422` |
| 10 | E-mail `naoe-email` | `422` |
| 11 | Remetente com domínio não verificado | `200` + aviso |
| 12 | Faixas `[0, 15, 30]` | `422` |
| 13 | Faixas `[30, 15, 0]` | `200` |
| 14 | Faixas `[30, 15, 5]` | `422` (última não é 0) |
| 15 | `percentualDevolucao: 120` | `422` |
| 16 | Check-out 15:00, check-in 14:00 | `200` + aviso |
| 17 | `GET /api/config-publica` | Sem `emailAdmin` nem limites internos |
| 18 | Campo novo adicionado no código | Privado por padrão |
| 19 | Editar `textoPrivacidade` | `publicacaoPendente: true` |
| 20 | Editar `prazoSolicitacaoHoras` | **Não** exige publicação |
| 21 | Mudança refletida em nova Lambda | Até 60 s |
| 22 | Restaurar versão anterior | Valores voltam |
| 23 | `PUT` com `versao` antiga | `409` |
| 24 | Markdown com `<script>` em texto legal | HTML público sem script |
| 25 | Cálculo de cancelamento com a nova política | Faixa nova aplicada |
| 26 | Reserva criada antes da mudança de política | Cálculo usa a política **atual** (é informativo) |
