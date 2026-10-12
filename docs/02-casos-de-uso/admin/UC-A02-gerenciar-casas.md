# UC-A02 — Cadastrar e editar casas

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado ([UC-A01](./UC-A01-autenticar.md)) |
| Gatilho | O admin abre `/admin/casas` e cria ou edita uma casa |
| Fase | 1 |
| Relacionados | [UC-A03](./UC-A03-gerenciar-fotos.md), [UC-A04](./UC-A04-gerenciar-precos.md), [UC-A14](./UC-A14-publicar-site.md), [02 — Modelo de dados](../../03-tecnico/02-modelo-de-dados.md) |

## Objetivo de negócio

Dar autonomia total ao proprietário sobre o conteúdo que vende. Hoje, mudar uma
descrição ou adicionar uma casa exigiria um desenvolvedor. Esse é o gargalo que o
backoffice elimina.

É também o que permite **múltiplas casas** sem reescrever nada: cadastrar a segunda
casa é um formulário, não um deploy.

## Fluxo principal

1. O admin abre `/admin/casas` e vê a lista com miniatura, nome, status, capacidade,
   número de fotos e indicador de alteração não publicada.
2. Clica em **"Nova casa"** (ou em uma casa existente).
3. Preenche o formulário, dividido em abas:
   - **Identificação**: nome, slug, resumo, status, ordem, destaque
   - **A casa**: descrição, capacidade, quartos, banheiros, camas por ambiente
   - **Comodidades**: seleção múltipla da lista fechada
   - **Regras**: texto em Markdown
   - **Localização**: endereço público, coordenadas, mapa, como chegar, distâncias
   - **Fotos**: [UC-A03](./UC-A03-gerenciar-fotos.md)
   - **Preços**: [UC-A04](./UC-A04-gerenciar-precos.md)
4. Salva. A casa nasce em `RASCUNHO`.
5. Ativa a casa quando estiver pronta (`status = ATIVA`).
6. Publica o site para que ela apareça ([UC-A14](./UC-A14-publicar-site.md)).

> Os passos 5 e 6 são separados de propósito: ativar é uma decisão de conteúdo;
> publicar é o ato que torna a mudança visível. O admin pode ativar várias casas e
> publicar uma vez.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Admin quer despublicar temporariamente | `status = INATIVA` + publicar. As reservas existentes continuam válidas |
| A2 | Admin quer duplicar uma casa parecida | Botão "Duplicar": copia tudo **menos** slug, fotos e token iCal |
| A3 | Admin reordena as casas | Campo `ordem` editável na lista, com arrastar-e-soltar |
| A4 | Admin edita e sai sem salvar | Rascunho guardado em `localStorage`; ao voltar, oferece restaurar |
| A5 | Admin quer excluir uma casa sem reservas | Exclusão permitida, com confirmação que nomeia a casa |
| A6 | Admin edita uma casa já publicada | Salva no banco; o site só muda depois de publicar |

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Slug já usado | `409 SLUG_EM_USO` | "Este endereço já está em uso por outra casa." + sugestão (`casa-do-lago-2`) |
| E2 | Campo obrigatório vazio | `400` | Campo marcado, aba com indicador de erro |
| E3 | Tentar ativar casa sem foto | `422 CASA_INCOMPLETA` | Lista do que falta antes de ativar |
| E4 | Tentar ativar casa sem preços válidos | `422 CASA_INCOMPLETA` | Idem |
| E5 | Tentar excluir casa com reservas ativas | `409 CASA_COM_RESERVAS` | "Esta casa tem 3 reservas ativas. Desative-a em vez de excluir." |
| E6 | Tentar mudar o slug de casa já publicada | `422 SLUG_IMUTAVEL` | Explica que quebraria links e SEO |
| E7 | Markdown inválido | `400` | Mensagem apontando o problema |
| E8 | Sessão expirada ao salvar | `401` | Renova e reenvia; se falhar, preserva o rascunho |
| E9 | Duas abas editando a mesma casa | `409 CONFLITO_VERSAO` | "Esta casa foi alterada em outra aba. Recarregue para ver a versão atual." |

> **E5 é a regra que evita perda de dados**: excluir uma casa com reservas deixaria
> reservas órfãs e ocupações apontando para o nada. Desativar resolve o problema real
> (não aparecer no site) sem destruir histórico.
>
> **E6:** o slug está em links compartilhados, no índice do Google e em e-mails já
> enviados. Mudar quebraria todos.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | A casa nasce em `RASCUNHO` |
| RN2 | Só casas `ATIVA` aparecem no site público |
| RN3 | O `slug` é único em todo o sistema |
| RN4 | O `slug` é **imutável** depois da primeira publicação |
| RN5 | Formato do slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–60 chars |
| RN6 | O slug é sugerido automaticamente a partir do nome, e editável antes de publicar |
| RN7 | Para ativar: ao menos 1 foto, 1 foto principal, texto alternativo em todas, preços válidos, `resumo` e `descricao` preenchidos |
| RN8 | `1 <= hospedesInclusos <= capacidadeMaxima` |
| RN9 | Comodidades vêm de uma lista fechada; valor desconhecido é rejeitado |
| RN10 | `descricao`, `regras` e `comoChegar` são Markdown, sanitizados na renderização |
| RN11 | O endereço exibido é o **público** (município/região); o exato vai só no `PRE_CHECKIN` |
| RN12 | Qualquer alteração marca `publicacaoPendente = true` |
| RN13 | `tokenIcal` é gerado na criação e nunca regenerado automaticamente |
| RN14 | Casa com reservas ativas não pode ser excluída |
| RN15 | Toda escrita registra `atualizadoPor` e `atualizadoEm` |
| RN16 | Máximo de 40 fotos por casa |

### Por que endereço público e exato separados (RN11)

Uma casa de temporada fica vazia parte do ano. O endereço exato indexado no Google é
um convite. O endereço completo só vai para quem tem reserva **confirmada**, no e-mail
de pré-check-in.

Campos no modelo: `localizacao.enderecoPublico` (vai para o site) e
`localizacao.enderecoCompleto` (nunca sai do backoffice e do `PRE_CHECKIN`).

## Contrato técnico

### `GET /api/admin/casas`

```json
{
  "casas": [
    { "casaId": "01HQ...", "slug": "casa-do-lago", "nome": "Casa do Lago",
      "status": "ATIVA", "ordem": 10, "destaque": true,
      "capacidadeMaxima": 8, "totalFotos": 12,
      "publicacaoPendente": false,
      "temPrecos": true, "completa": true,
      "fotoPrincipalUrl": "/midia/...", 
      "reservasAtivas": 3,
      "atualizadoEm": "2026-10-11T18:04:00-03:00" }
  ]
}
```

`completa` e `reservasAtivas` são calculados no servidor — é o que permite à lista
mostrar "pronta para ativar" e desabilitar o botão de excluir sem uma segunda chamada.

### `POST /api/admin/casas`

```json
{
  "nome": "Casa do Lago",
  "slug": "casa-do-lago",
  "resumo": "Casa de madeira à beira do lago, para até 8 pessoas.",
  "descricao": "## Sobre a casa\n\nTexto em **Markdown**...",
  "status": "RASCUNHO",
  "ordem": 10,
  "destaque": false,
  "capacidadeMaxima": 8,
  "hospedesInclusos": 6,
  "quartos": 3,
  "banheiros": 2,
  "camas": [
    { "tipo": "CASAL", "quantidade": 1, "ambiente": "Suíte" },
    { "tipo": "SOLTEIRO", "quantidade": 4, "ambiente": "Quarto 2" }
  ],
  "comodidades": ["LAGO", "PISCINA", "CHURRASQUEIRA", "WIFI"],
  "regras": "- Não são permitidas festas\n- Som até 22h",
  "localizacao": {
    "enderecoPublico": "Zona rural, Município X - UF",
    "enderecoCompleto": "Estrada Y, km 12, Sítio Z",
    "lat": -21.123456,
    "lng": -45.123456,
    "mapaEmbedUrl": "https://www.openstreetmap.org/export/embed.html?bbox=...",
    "comoChegar": "Texto em Markdown...",
    "distancias": [{ "referencia": "Centro da cidade", "km": 12 }]
  }
}
```

| Campo | Validação |
|---|---|
| `nome` | 3–80 chars |
| `slug` | RN5; único (RN3) |
| `resumo` | 20–200 chars |
| `descricao` | 50–10.000 chars |
| `status` | `RASCUNHO` \| `ATIVA` \| `INATIVA` |
| `ordem` | inteiro 0–9999 |
| `capacidadeMaxima` | inteiro 1–50 |
| `hospedesInclusos` | inteiro, 1 a `capacidadeMaxima` |
| `quartos`, `banheiros` | inteiro 0–50 |
| `camas[].tipo` | `CASAL` \| `SOLTEIRO` \| `BELICHE` \| `REDE` |
| `comodidades[]` | da lista fechada |
| `lat`, `lng` | opcionais; faixas válidas |
| `mapaEmbedUrl` | opcional; **só `https:`** e host em allowlist (`openstreetmap.org`, `google.com/maps`) |
| `distancias[].km` | número 0–9999 |

Resposta `201` com a casa criada (incluindo `casaId` e `tokenIcal`).

### Outras rotas

| Rota | Observações |
|---|---|
| `GET /api/admin/casas/{casaId}` | Casa completa, com `enderecoCompleto` e `tokenIcal` |
| `PUT /api/admin/casas/{casaId}` | Mesmo corpo; exige `versao` para detectar conflito (E9) |
| `POST /api/admin/casas/{casaId}/status` | `{ "status": "ATIVA" }` — valida RN7 |
| `DELETE /api/admin/casas/{casaId}` | Valida RN14; apaga o item, o índice de slug e as fotos do S3 |

### Erros

| Código | HTTP |
|---|---|
| `ENTRADA_INVALIDA` | 400 |
| `NAO_ENCONTRADO` | 404 |
| `SLUG_EM_USO` | 409 |
| `CONFLITO_VERSAO` | 409 |
| `CASA_COM_RESERVAS` | 409 |
| `CASA_INCOMPLETA` | 422 (com `detalhes.faltando[]`) |
| `SLUG_IMUTAVEL` | 422 |

## Implementação

### Criação (transação)

```
TransactWriteItems:
  Put SLUG#<slug>/META   { casaId }   ConditionExpression: attribute_not_exists(PK)
  Put CASA#<casaId>/META { ... }      ConditionExpression: attribute_not_exists(PK)
  Put CASA#<casaId>/PRECOS { padrões } ConditionExpression: attribute_not_exists(PK)
```

A condição no item de slug é **o que garante a unicidade** (RN3). Não verifique com um
`GetItem` antes e grave depois: duas criações simultâneas passariam.
Falha na condição do item de slug → `409 SLUG_EM_USO`.

O item `PRECOS` é criado junto, com valores padrão zerados e `validado: false`, para
que a tela de preços nunca encontre "não existe".

### Exclusão (transação + limpeza)

```
1. Query GSI1 por reservas da casa em SOLICITADA/CONFIRMADA  → 409 se houver
2. Query OCUPACAO#<casaId> → se houver qualquer ocupação futura, 409
3. TransactWriteItems: Delete CASA#<id>/META, CASA#<id>/PRECOS, SLUG#<slug>/META
4. Apagar os objetos do S3 em midia/casas/<casaId>/ (best-effort, fora da transação)
5. Apagar as ocupações passadas (batch, best-effort)
```

Ordem deliberada: banco primeiro, S3 depois. Objeto órfão no S3 é invisível e custa
frações de centavo; referência para objeto inexistente é imagem quebrada.

### Controle de versão otimista (E9)

O item da casa tem `versao: number`. O `PUT` envia a `versao` que leu, e a escrita usa
`ConditionExpression: versao = :versaoLida`, incrementando-a. Divergência → `409`.

Com um único admin isso parece exagero, até o dia em que ele tem o celular e o
computador abertos na mesma tela. É uma linha de condição que evita sobrescrita
silenciosa.

### Armadilhas

1. **Não validar o slug com `GetItem` antes do `Put`.** Use a condição.
2. **`mapaEmbedUrl` é entrada não confiável** que vai para um `<iframe src>`.
   Allowlist de host + só `https:`. Sem isso, é injeção de iframe arbitrário no site.
3. **Markdown sanitizado na renderização, não só na entrada.** O admin é confiável,
   mas uma conta comprometida injetaria HTML no site público.
4. **`publicacaoPendente`** precisa ser marcado em **toda** alteração — inclusive em
   fotos e preços, que estão em outros UCs. Esquecer faz o admin publicar e não ver a mudança.
5. **Não regenerar `tokenIcal`** ao editar: invalidaria a URL já cadastrada nos canais.

## Interface

```
Casas                                        [ + Nova casa ]
┌──────────────────────────────────────────────────────────────┐
│ ▣  Casa do Lago            ATIVA    8 pessoas   12 fotos  ⋮  │
│    casa-do-lago                     ● alterações não publicadas│
├──────────────────────────────────────────────────────────────┤
│ ▣  Casa da Mata            ATIVA    6 pessoas    8 fotos  ⋮  │
│    casa-da-mata                                               │
├──────────────────────────────────────────────────────────────┤
│ ▣  Chalé do Mirante        RASCUNHO 4 pessoas    0 fotos  ⋮  │
│    chale-do-mirante                 ⚠ falta: fotos, preços   │
└──────────────────────────────────────────────────────────────┘
                                       [ Publicar alterações ]
```

| Padrão | Regra |
|---|---|
| Abas no formulário | Indicador de erro na aba que tem campo inválido |
| Salvar | Explícito, com botão. **Nunca** autossalvar |
| Rascunho | `localStorage` por `casaId`; oferece restaurar ao reabrir |
| "Falta para ativar" | Lista visível na própria linha da casa |
| Pré-visualização | Botão que abre a página renderizada com os dados atuais, sem publicar |
| Excluir | Confirmação que digita o nome da casa; desabilitado se houver reservas |
| Status | Troca em um clique, com validação antes |
| Mobile | A lista e a troca de status funcionam no celular; o formulário completo é otimizado para desktop |

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` em todas as rotas |
| `mapaEmbedUrl` | Allowlist de host; só `https:`; é entrada que vira `<iframe>` |
| Markdown | Sanitizado com allowlist na renderização |
| `enderecoCompleto` | Nunca em endpoint público; só no backoffice e no `PRE_CHECKIN` |
| `tokenIcal` | Só na resposta do detalhe para o admin |
| Log | Registra `casaId`, ação e `sub` do admin; nenhum conteúdo |
| Exclusão | Validada contra reservas; confirmação explícita |

## Critérios de aceite

- [ ] Criar casa gera `casaId`, item de slug, preços padrão e `tokenIcal`.
- [ ] Slug duplicado retorna `409`, inclusive em criações simultâneas.
- [ ] Slug de casa publicada não pode ser alterado.
- [ ] Casa nasce em `RASCUNHO` e não aparece no site.
- [ ] Ativar sem foto/preços/texto alternativo retorna `422` com a lista do que falta.
- [ ] `hospedesInclusos <= capacidadeMaxima` validado.
- [ ] Comodidade fora da lista rejeitada.
- [ ] `mapaEmbedUrl` de host não permitido rejeitada.
- [ ] Qualquer alteração marca `publicacaoPendente`.
- [ ] Excluir casa com reservas ativas retorna `409`.
- [ ] Excluir casa sem reservas apaga item, slug e fotos.
- [ ] Edição concorrente em duas abas gera `409 CONFLITO_VERSAO`.
- [ ] `enderecoCompleto` ausente de toda resposta pública.
- [ ] Duplicar não copia slug, fotos nem token iCal.
- [ ] Rascunho local preservado após falha de sessão.
- [ ] Toda escrita registra `atualizadoPor`.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Criar casa válida | `201`; 3 itens no banco |
| 2 | Criar com slug existente | `409 SLUG_EM_USO` |
| 3 | Duas criações simultâneas com o mesmo slug | 1 sucesso, 1 `409` |
| 4 | Slug `Casa Do Lago!` | `400` |
| 5 | Nome "Casa do Lago" | Slug sugerido `casa-do-lago` |
| 6 | Ativar casa sem fotos | `422` com `faltando: ["fotos"]` |
| 7 | Ativar casa sem preços válidos | `422` |
| 8 | Ativar casa com foto sem texto alternativo | `422` |
| 9 | Ativar casa completa | `200`; `status: ATIVA` |
| 10 | `hospedesInclusos` 10 com capacidade 8 | `400` |
| 11 | Comodidade `PISCINA_AQUECIDA` (não existe) | `400` |
| 12 | `mapaEmbedUrl` em `http://` | `400` |
| 13 | `mapaEmbedUrl` em `evil.com` | `400` |
| 14 | Editar descrição | `publicacaoPendente: true` |
| 15 | Excluir casa com 1 reserva confirmada | `409` |
| 16 | Excluir casa sem reservas | `200`; itens e fotos removidos |
| 17 | Mudar slug de casa publicada | `422` |
| 18 | Mudar slug de casa em `RASCUNHO` | `200`; índice antigo removido |
| 19 | `PUT` com `versao` antiga | `409 CONFLITO_VERSAO` |
| 20 | Duplicar casa | Nova casa sem slug, fotos ou token iCal |
| 21 | `GET /api/casas/{slug}` de casa `RASCUNHO` | `404` |
| 22 | `enderecoCompleto` em resposta pública | Ausente |
| 23 | Editar casa não regenera `tokenIcal` | Token igual |
| 24 | Markdown com `<script>` na descrição | HTML público sem script |
