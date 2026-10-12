# UC-A14 — Publicar o conteúdo no site

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; ao menos uma casa `ATIVA` completa |
| Gatilho | O admin clica em "Publicar site", na faixa do topo ou em `/admin/config` |
| Fase | 1 |
| Relacionados | [09 — Publicação](../../03-tecnico/09-publicacao-de-conteudo.md), [ADR-009](../../adr/ADR-009-conteudo-no-banco-com-publicacao.md), [UC-A02](./UC-A02-gerenciar-casas.md) |

## Objetivo de negócio

O conteúdo editado no backoffice vive no DynamoDB; o site é estático no S3. Publicar é
o ato que leva um ao outro.

Ter esse passo explícito, em vez de publicar a cada salvamento, é **deliberado**:

| Vantagem | Por quê |
|---|---|
| O admin edita em paz | Pode mexer em cinco casas e publicar uma vez, sem expor meio-trabalho |
| Validação em um ponto | É aqui que se garante que nenhuma casa ativa está incompleta |
| Menos builds | Cada publicação consome minutos de CI e invalidações do CloudFront |
| Reversível antes de ir ao ar | O site atual continua intacto até a publicação concluir |

## Fluxo principal

1. Depois de editar algo, o admin vê a faixa: **"Há alterações não publicadas"** com o
   botão **Publicar site**.
2. Clica. A tela mostra o que será publicado (quais casas mudaram, o que mudou na
   configuração).
3. O servidor valida (ver "Validações").
4. Se tudo estiver certo, marca a publicação como `EM_ANDAMENTO`, invoca
   `publicar-conteudo` de forma **assíncrona** e responde `202` **imediatamente**.
5. A tela mostra o progresso, consultando `GET /api/admin/publicar/status` a cada 3 s.
6. A Lambda gera os JSONs públicos, dispara o rebuild no GitHub Actions, aguarda o
   resultado, invalida o CloudFront e marca `CONCLUIDA`.
7. A tela mostra "Site publicado" com o link e o horário.
8. A faixa de "alterações não publicadas" desaparece.

> O passo 4 é a aplicação da regra "nunca bloquear o usuário": a publicação leva de 1 a
> 3 minutos. Deixar o admin olhando um botão travado por três minutos (e arriscar um
> timeout de Lambda) seria inaceitável.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Nada pendente | O botão fica disponível; republicar é inofensivo e às vezes útil |
| A2 | Admin fecha a aba durante a publicação | A publicação **continua**; o status aparece ao reabrir |
| A3 | Admin quer pré-visualizar antes | Pré-visualização por casa ([UC-A02](./UC-A02-gerenciar-casas.md)) renderiza sem publicar |
| A4 | Publicação concluída com avisos | Concluída; os avisos ficam visíveis |
| A5 | Admin publica do celular | Funciona; o status é consultado igual |
| A6 | Primeira publicação | Idêntica; só o conteúdo é novo |

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Nenhuma casa `ATIVA` | `422 NENHUMA_CASA_ATIVA` | "Ative pelo menos uma casa antes de publicar." |
| E2 | Casa `ATIVA` sem foto | `422 CONTEUDO_INCOMPLETO` | Lista por casa do que falta, com link para corrigir |
| E3 | Casa `ATIVA` sem foto principal | `422` | Idem |
| E4 | Foto sem texto alternativo | `422` | Idem |
| E5 | Casa `ATIVA` sem preços válidos | `422` | Idem |
| E6 | Configuração sem WhatsApp ou e-mails | `422` | Idem |
| E7 | Publicação já em andamento | `409 PUBLICACAO_EM_ANDAMENTO` | "Uma publicação está em andamento desde 18h04." + status |
| E8 | Build do Astro falha | status `FALHOU` | "A publicação falhou." + erro + "Tentar novamente". **O site atual continua no ar** |
| E9 | GitHub Actions indisponível | status `FALHOU` | Mesma tela, com o erro |
| E10 | Invalidação do CloudFront falha | status `CONCLUIDA` + aviso | "Publicado, mas o cache pode levar alguns minutos para atualizar." |
| E11 | Publicação travada há mais de 10 min | status `FALHOU` (pelo cron) | "A publicação não respondeu." + Tentar novamente |
| E12 | Falha de rede na consulta de status | — | "Não conseguimos verificar o andamento." + Tentar novamente. **A publicação continua** |

> **E8 é a garantia mais importante deste UC:** o `s3 sync` só roda **depois** de o
> build ter sucesso. Build quebrado significa que nada é enviado, e o site anterior
> continua servindo normalmente. Uma publicação que falha nunca derruba o site.
>
> **E10 é um "sucesso com ressalva" honesto:** o conteúdo foi para o S3, mas o cache
> antigo pode persistir por alguns minutos. Dizer isso é melhor que declarar sucesso e
> o admin achar que a mudança não funcionou.

## Validações antes de publicar

| # | Validação | Severidade |
|---|---|---|
| 1 | Existe ao menos uma casa `ATIVA` | **Bloqueia** |
| 2 | Toda casa `ATIVA` tem ao menos 1 foto | **Bloqueia** |
| 3 | Toda casa `ATIVA` tem foto principal | **Bloqueia** |
| 4 | Toda foto tem `textoAlternativo` | **Bloqueia** |
| 5 | Toda casa `ATIVA` tem preços válidos | **Bloqueia** |
| 6 | Toda casa `ATIVA` tem `resumo` e `descricao` | **Bloqueia** |
| 7 | `CONFIG/GERAL` tem WhatsApp, `emailAdmin` e `emailRemetente` | **Bloqueia** |
| 8 | Casa `ATIVA` com menos de 5 fotos | Aviso |
| 9 | Algum texto legal vazio | Aviso |
| 10 | Casa `ATIVA` sem localização | Aviso |
| 11 | `emailRemetente` não verificado no SES | Aviso |

As bloqueantes retornam `422` com a lista **agrupada por casa** — o admin precisa saber
exatamente o que corrigir e onde:

```json
{
  "erro": "CONTEUDO_INCOMPLETO",
  "mensagem": "Algumas casas ativas estão incompletas.",
  "detalhes": {
    "porCasa": [
      { "casaId": "01HQ...", "casaNome": "Chalé do Mirante",
        "faltando": ["FOTOS", "PRECOS"],
        "mensagens": ["Nenhuma foto cadastrada", "Preços não configurados"] }
    ]
  }
}
```

> Validar aqui, e não ao ativar a casa, é redundante de propósito: ativar também valida
> ([UC-A02](./UC-A02-gerenciar-casas.md) RN7), mas uma foto pode ser excluída depois.
> A publicação é o último portão antes do público.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Só casas `ATIVA` são publicadas |
| RN2 | As validações bloqueantes impedem a publicação |
| RN3 | Publicação concorrente é rejeitada |
| RN4 | A publicação é assíncrona; a resposta é `202` |
| RN5 | O site anterior continua no ar até a nova publicação concluir |
| RN6 | `publicacaoPendente` é limpo apenas nas casas efetivamente publicadas |
| RN7 | Publicação travada há mais de 10 min é marcada `FALHOU` pelo `cron-diario` |
| RN8 | A falha gera `ALERTA_ADMIN` |
| RN9 | Republicar sem alterações é permitido |
| RN10 | Registra quem publicou e quando |
| RN11 | A invalidação usa **prefixos**, não arquivos individuais |
| RN12 | O `s3 sync --delete` **nunca** apaga `midia/*` nem `_dados/*` |
| RN13 | O `sitemap.xml` é regerado só com casas `ATIVA` |

> **RN12 é o item mais perigoso de todo o projeto.** Um `aws s3 sync --delete` sem o
> `--exclude "midia/*"` **apaga todas as fotos de todas as casas**, e elas não estão
> versionadas no S3 (versionamento desligado por custo). O workflow precisa de um
> comentário explicando isso, e o teste de deploy precisa verificar que uma foto
> sobrevive a uma publicação.

## Contrato técnico

### `POST /api/admin/publicar`

Sem corpo. Resposta `202`:

```json
{
  "status": "EM_ANDAMENTO",
  "iniciadaEm": "2026-10-11T18:04:00-03:00",
  "casasAPublicar": 3,
  "avisos": [
    { "codigo": "POUCAS_FOTOS", "casaNome": "Casa da Mata",
      "mensagem": "Apenas 3 fotos. Recomendamos ao menos 5." }
  ]
}
```

### `GET /api/admin/publicar/status`

```json
{
  "status": "EM_ANDAMENTO",
  "etapa": "GERANDO_PAGINAS",
  "etapaDescricao": "Gerando as páginas do site...",
  "iniciadaEm": "2026-10-11T18:04:00-03:00",
  "duracaoSegundos": 47,
  "publicadaPor": "proprietario@exemplo.com.br",
  "ultimaPublicacaoBemSucedida": "2026-10-10T14:22:00-03:00",
  "casasPublicadas": null,
  "erro": null,
  "urlAcompanhamento": "https://github.com/.../actions/runs/123"
}
```

Etapas: `VALIDANDO` → `GERANDO_DADOS` → `GERANDO_PAGINAS` → `ENVIANDO` →
`LIMPANDO_CACHE` → `CONCLUIDA` (ou `FALHOU` em qualquer ponto).

> As etapas nomeadas em linguagem comum transformam uma espera de três minutos de
> "travou?" em "está gerando as páginas". É a diferença entre o admin esperar e o
> admin clicar de novo.

### Erros

| Código | HTTP |
|---|---|
| `NENHUMA_CASA_ATIVA` | 422 |
| `CONTEUDO_INCOMPLETO` | 422 (com `detalhes.porCasa[]`) |
| `CONFIGURACAO_INCOMPLETA` | 422 |
| `PUBLICACAO_EM_ANDAMENTO` | 409 (com o status atual) |

## Implementação

Mecanismo completo em [09 — Publicação](../../03-tecnico/09-publicacao-de-conteudo.md).
Aqui, o que é específico do UC:

### `api-admin` (síncrona, rápida)

```
1. exigirAdmin()
2. carregar casas ATIVA + preços + CONFIG/GERAL
3. validar (lista acima)                  → 422 agrupado por casa
4. Update PUBLICACAO/ATUAL
     SET status = EM_ANDAMENTO, iniciadaEm = :agora, publicadaPor = :quem
     ConditionExpression: attribute_not_exists(#s) OR #s <> :emAndamento
                          OR iniciadaEm < :dezMinAtras
   → 409 se a condição falhar
5. lambda.invoke("publicar-conteudo", { InvocationType: "Event" })
6. 202
```

A condição do passo 4 inclui `iniciadaEm < :dezMinAtras` — assim uma publicação
travada não bloqueia o admin para sempre, mesmo que o cron ainda não a tenha limpado.

### `publicar-conteudo` (assíncrona)

```
1. etapa = GERANDO_DADOS
   gerar _dados/casas.json, _dados/casas/<slug>.json, _dados/config.json
   PutObject no S3 com Cache-Control: public, max-age=60
2. etapa = GERANDO_PAGINAS
   POST repository_dispatch no GitHub, com event_type "publicar-site"
3. aguardar o callback do workflow (até 8 min), consultando o status do run
4. etapa = LIMPANDO_CACHE
   CreateInvalidation: ["/", "/index.html", "/_dados/*", "/casas/*", "/sitemap.xml"]
5. limpar publicacaoPendente das casas publicadas
6. status = CONCLUIDA
```

Em qualquer falha: `status = FALHOU`, `erro` com a mensagem, `ALERTA_ADMIN`, e **nada
é enviado ao S3 além dos JSONs** (que são inofensivos — o site antigo não os lê até o
HTML novo existir).

> O passo 3 é a parte frágil: aguardar um workflow externo. Timeout de 8 min, dentro
> do timeout de 120 s da Lambda? **Não cabe.** Solução: a Lambda **não aguarda** — ela
> dispara e o próprio workflow chama um endpoint de callback no fim
> (`POST /api/admin/publicar/callback`, autenticado por um segredo no SSM) que atualiza
> o status. O `cron-diario` cobre o caso de o callback nunca chegar (RN7).

### Armadilhas

1. **`--exclude "midia/*"` no `s3 sync --delete`** (RN12). O erro mais destrutivo possível.
2. **Lambda não aguarda o workflow** — ver acima. Tentar aguardar estoura o timeout e
   deixa a publicação eternamente `EM_ANDAMENTO`.
3. **Invalidação por prefixo** (RN11): a cota de 1.000 caminhos/mês é por caminho; usar
   um por arquivo esgota rápido.
4. **`publicacaoPendente` só das casas publicadas** (RN6): se o admin editar uma casa
   **durante** a publicação, essa edição não entrou e a flag dela precisa permanecer.
   Solução: guardar a `versao` de cada casa no início e limpar a flag só se a versão
   não mudou.
5. **Não interpolar `client_payload` em shell** no workflow — injeção de comando em
   pipeline. Use `env:` e valide `stage` contra `dev|prod`.
6. **Validar antes de marcar `EM_ANDAMENTO`**: marcar e só então descobrir que falta
   uma foto deixaria o estado sujo.
7. **Token do GitHub no SSM**, com escopo mínimo e rotação documentada.

## Interface

### Faixa persistente

```
┌─────────────────────────────────────────────────────────────┐
│ ● Há alterações não publicadas (2 casas, configuração)       │
│                              [ Ver o que mudou ] [ Publicar ]│
└─────────────────────────────────────────────────────────────┘
```

Aparece no topo de **todas** as telas do backoffice enquanto houver pendência — é o que
evita o admin editar e esquecer de publicar, que seria a reclamação número um.

### Durante

```
┌──────────────────────────────────────────────────────┐
│  Publicando o site...                                 │
│                                                        │
│  ✓ Validando o conteúdo                               │
│  ✓ Gerando os dados                                   │
│  ⟳ Gerando as páginas do site...            (47s)     │
│  · Enviando para o servidor                           │
│  · Limpando o cache                                   │
│                                                        │
│  Isso leva de 1 a 3 minutos. Você pode continuar       │
│  trabalhando — avisaremos quando terminar.             │
│                                                        │
│  O site atual continua no ar normalmente.              │
└──────────────────────────────────────────────────────┘
```

### Sucesso / falha

```
✓ Site publicado às 18h06                 [ Abrir o site ]
  3 casas publicadas.

⚠ Publicado, mas o cache pode levar alguns minutos para atualizar.

✗ A publicação falhou às 18h06
  Erro: o build não foi concluído (erro na página da Casa da Mata).
  O site atual continua no ar.
  [ Tentar novamente ]  [ Ver detalhes ]
```

| Padrão | Regra |
|---|---|
| Faixa persistente | Impede esquecer de publicar |
| "Ver o que mudou" | Lista as casas e os campos alterados |
| Etapas nomeadas | Espera compreensível |
| "Você pode continuar trabalhando" | Reforça que não está travado |
| "O site atual continua no ar" | Remove o medo de publicar |
| Erro acionável | Diz **onde** foi o erro, não só que falhou |
| Erro de validação | Agrupado por casa, com link para corrigir |
| Status ao reabrir | Publicação em andamento aparece de qualquer tela |

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` |
| Token do GitHub | SSM SecureString; escopo mínimo; rotação documentada |
| Callback do workflow | Autenticado por segredo no SSM, comparado em tempo constante |
| `client_payload` | Nunca interpolado em shell; `stage` validado contra allowlist |
| IAM da Lambda | `s3:PutObject` só em `_dados/*`; invalidação só na distribuição do stage |
| Conteúdo publicado | Só campos públicos; `enderecoCompleto` **nunca** vai para os JSONs |
| Concorrência | Condição no item de publicação |
| Log | `publicadaPor`, etapas, duração. Nenhum conteúdo |

> O item mais importante: o gerador dos JSONs públicos usa uma **allowlist de campos**,
> não uma denylist. `enderecoCompleto`, `tokenIcal` e dados internos ficam de fora por
> construção, e um campo novo no modelo não vaza por esquecimento.

## Critérios de aceite

- [ ] A faixa de "alterações não publicadas" aparece em todas as telas quando há pendência.
- [ ] Publicar sem casa `ATIVA` retorna `422`.
- [ ] Casa `ATIVA` incompleta retorna `422` agrupado por casa, com o que falta.
- [ ] A resposta é `202` e a publicação roda em segundo plano.
- [ ] O status mostra a etapa atual em linguagem comum.
- [ ] Publicação concorrente retorna `409`.
- [ ] Publicação travada há mais de 10 min pode ser reiniciada.
- [ ] Build falho mantém o site anterior no ar.
- [ ] Falha gera `ALERTA_ADMIN` e mostra o erro na tela.
- [ ] **As fotos sobrevivem ao `s3 sync --delete`.**
- [ ] `publicacaoPendente` é limpo só das casas publicadas.
- [ ] Casa editada durante a publicação mantém a pendência.
- [ ] A invalidação usa prefixos.
- [ ] O `sitemap.xml` contém só casas `ATIVA`.
- [ ] `enderecoCompleto` e `tokenIcal` ausentes dos JSONs públicos.
- [ ] Fechar a aba não interrompe a publicação.
- [ ] Republicar sem alterações é permitido.
- [ ] A tela diz que o site atual continua no ar.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Publicar com 3 casas completas | `202`; conclui; 3 páginas no ar |
| 2 | Nenhuma casa `ATIVA` | `422 NENHUMA_CASA_ATIVA` |
| 3 | Casa `ATIVA` sem foto | `422` nomeando a casa |
| 4 | Casa `ATIVA` sem foto principal | `422` |
| 5 | Foto sem texto alternativo | `422` |
| 6 | Casa `ATIVA` sem preços | `422` |
| 7 | Configuração sem WhatsApp | `422` |
| 8 | Casa com 3 fotos | `202` + aviso |
| 9 | Texto legal vazio | `202` + aviso |
| 10 | Publicar duas vezes seguidas | A segunda recebe `409` |
| 11 | `EM_ANDAMENTO` há 15 min | Nova publicação aceita |
| 12 | `cron-diario` com publicação travada | Marcada `FALHOU` |
| 13 | Build do Astro falha | `FALHOU`; site antigo intacto; alerta |
| 14 | **Foto no S3 após publicação com `--delete`** | **Ainda lá** |
| 15 | `_dados/*` após `--delete` | Ainda lá |
| 16 | Invalidação falha | `CONCLUIDA` + aviso |
| 17 | Casa editada durante a publicação | `publicacaoPendente` mantido |
| 18 | `publicacaoPendente` após sucesso | `false` nas publicadas |
| 19 | Casa de `ATIVA` para `INATIVA` + publicar | Página removida; fora do sitemap |
| 20 | JSONs publicados | Sem `enderecoCompleto` nem `tokenIcal` |
| 21 | Campo novo no modelo | Ausente dos JSONs (allowlist) |
| 22 | Fechar a aba no meio | Publicação conclui |
| 23 | Reabrir durante a publicação | Status visível |
| 24 | Callback com segredo errado | `401`; status não muda |
| 25 | Republicar sem alterações | `202`; conclui |
| 26 | Caminhos da invalidação | Prefixos, não arquivos individuais |
