# 03 — API pública

Lambda `api-publica`, exposta pelo CloudFront em `/api/*`.
**Sem autenticação**, exceto as rotas que exigem token de acesso na querystring.

## Convenções

- Corpo e resposta sempre `application/json; charset=utf-8` (exceto `.ics`).
- Toda entrada validada com **zod** antes de qualquer acesso ao banco.
- Erro sempre no formato:

```json
{ "erro": "CODIGO_DO_ERRO", "mensagem": "Texto amigável em português", "detalhes": { } }
```

- `mensagem` é escrita para ser exibida direto ao usuário. `detalhes` é opcional e
  carrega dados estruturados (ex.: `minimoExigido`).
- Datas na API: sempre `YYYY-MM-DD`. Datas/horas: sempre ISO 8601 com offset.
- Valores monetários: sempre inteiros em centavos, com sufixo `Centavos` no nome.
- Nenhuma resposta pública contém dado pessoal, exceto a consulta da própria
  solicitação com token válido.

## Códigos de erro

| Código | HTTP | Significado |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | Falha de schema. `detalhes.campos[]` lista os campos |
| `TOKEN_INVALIDO` | 404 | Token de acesso ausente ou errado (404, não 403 — não confirma a existência do recurso) |
| `NAO_ENCONTRADO` | 404 | Casa ou reserva inexistente |
| `DATA_INVALIDA` | 422 | Data malformada |
| `INTERVALO_INVALIDO` | 422 | `checkout <= checkin` |
| `ANTECEDENCIA_MINIMA` | 422 | Check-in muito próximo |
| `FORA_DA_JANELA` | 422 | Check-in além da janela de reserva |
| `MINIMO_NOITES` | 422 | Abaixo do mínimo. `detalhes.minimoExigido`, `detalhes.periodoNome` |
| `MAXIMO_NOITES` | 422 | Acima do máximo |
| `CAPACIDADE_EXCEDIDA` | 422 | `detalhes.capacidadeMaxima` |
| `INTERVALO_MUITO_LONGO` | 422 | Consulta de disponibilidade acima de 13 meses |
| `DATAS_INDISPONIVEIS` | 409 | Alguma noite já está ocupada. `detalhes.noitesIndisponiveis[]` |
| `TRANSICAO_INVALIDA` | 409 | Operação incompatível com o estado atual. `detalhes.statusAtual` |
| `LIMITE_SOLICITACOES` | 429 | Limite de pendentes por e-mail atingido |
| `MUITAS_REQUISICOES` | 429 | Throttle |
| `ERRO_INTERNO` | 500 | Mensagem genérica; detalhe só no log |

> `TOKEN_INVALIDO` devolve **404** de propósito. Devolver 403 informaria que aquele
> `reservaId` existe, o que é um vazamento por enumeração.

---

## `GET /api/casas`

Lista as casas com `status = ATIVA`, ordenadas por `ordem`.

**Cache:** CloudFront 300 s.

```json
{
  "casas": [
    {
      "casaId": "01HQ...",
      "slug": "casa-do-lago",
      "nome": "Casa do Lago",
      "resumo": "Casa de madeira à beira do lago, para até 8 pessoas.",
      "capacidadeMaxima": 8,
      "quartos": 3,
      "banheiros": 2,
      "diariaMinimaCentavos": 50000,
      "comodidadesDestaque": ["LAGO", "PISCINA", "CHURRASQUEIRA", "WIFI"],
      "fotoPrincipal": {
        "url": "/midia/casas/01HQ.../01HQ-fachada-a3f9c1.webp",
        "textoAlternativo": "Casa de madeira com varanda, vista do lago",
        "largura": 1600, "altura": 1067
      },
      "destaque": true
    }
  ]
}
```

`diariaMinimaCentavos` = menor diária configurada (base, fim de semana, temporadas,
feriados). Serve para o "a partir de R$ ..." nos cards.

---

## `GET /api/casas/{slug}`

Detalhe de uma casa ativa. **Cache:** 300 s.

```json
{
  "casaId": "01HQ...", "slug": "casa-do-lago", "nome": "Casa do Lago",
  "resumo": "...", "descricaoHtml": "<p>...</p>",
  "capacidadeMaxima": 8, "quartos": 3, "banheiros": 2,
  "camas": [{ "tipo": "CASAL", "quantidade": 2, "ambiente": "Suíte" }],
  "comodidades": ["LAGO", "PISCINA"],
  "regrasHtml": "<ul>...</ul>",
  "localizacao": {
    "enderecoPublico": "Zona rural, Município X - UF",
    "mapaEmbedUrl": "https://www.openstreetmap.org/export/embed.html?bbox=...",
    "comoChegarHtml": "<p>...</p>",
    "distancias": [{ "referencia": "Centro da cidade", "km": 12 }]
  },
  "fotos": [{ "url": "...", "legenda": "...", "textoAlternativo": "...", "largura": 1600, "altura": 1067 }],
  "precos": {
    "diariaBaseCentavos": 50000,
    "diariaFimDeSemanaCentavos": 65000,
    "diasFimDeSemana": ["SEX", "SAB"],
    "taxaLimpezaCentavos": 25000,
    "hospedesInclusos": 6,
    "valorHospedeExtraPorNoiteCentavos": 5000,
    "minNoitesPadrao": 2,
    "maxNoites": 60,
    "periodosEspeciais": [
      { "nome": "Réveillon", "inicio": "2026-12-29", "fim": "2027-01-02", "diariaCentavos": 120000, "minNoites": 4 }
    ]
  },
  "horarioCheckin": "14:00", "horarioCheckout": "12:00"
}
```

O `Markdown` de `descricao`, `regras` e `comoChegar` é convertido para HTML **no
servidor** e **sanitizado** com allowlist. O navegador nunca recebe Markdown cru nem
injeta HTML não sanitizado — ver [segurança](../05-conformidade/01-seguranca.md).

`periodosEspeciais` unifica feriados e temporadas e **omite o campo `tipo`**: para o
hóspede, a distinção interna não importa; só o nome, as datas e a diária.

---

## `GET /api/casas/{casaId}/disponibilidade`

| Parâmetro | Obrigatório | Regra |
|---|---|---|
| `de` | sim | `YYYY-MM-DD` |
| `ate` | sim | `YYYY-MM-DD`, `>= de`, no máximo **13 meses** depois de `de` |

**Cache:** 60 s.

```json
{
  "casaId": "01HQ...",
  "de": "2026-11-01",
  "ate": "2026-12-31",
  "noitesOcupadas": ["2026-11-20", "2026-11-21", "2026-11-22", "2026-12-24"],
  "geradoEm": "2026-10-11T18:04:00-03:00"
}
```

Regras:

- Inclui ocupações `RESERVA` confirmadas, `RESERVA` pendentes **não vencidas**,
  `BLOQUEIO` e `EXTERNO`.
- **Exclui** ocupações pendentes com `expiraEm < agora` — elas estão livres.
- **Não revela o tipo.** Ocupado é ocupado.
- Sem nenhum dado pessoal.

> A filtragem por `expiraEm` acontece na Lambda, após a `Query`. Com cache de 60 s,
> uma noite recém-liberada pode aparecer ocupada por até um minuto. Aceitável — e a
> criação da solicitação valida de novo transacionalmente, então a pior consequência
> é o usuário ver uma data indisponível por 60 s, nunca um overbooking.

---

## `POST /api/cotacao`

```json
{ "casaId": "01HQ...", "checkin": "2026-11-20", "checkout": "2026-11-23", "hospedes": 7 }
```

Resposta `200`: objeto `Cotacao` de [regras de preço](../01-negocio/02-regras-de-preco.md),
mais:

```json
{
  "disponivel": true,
  "noitesIndisponiveis": [],
  "estimativa": true,
  "avisoEstimativa": "Valor estimado. O valor final é confirmado pelo proprietário."
}
```

- Validação de preço **e** de disponibilidade. Se as datas estiverem ocupadas,
  responde `200` com `disponivel: false` e `noitesIndisponiveis`, **não** um erro —
  a tela precisa mostrar o preço e a indisponibilidade juntos.
- Erros de validação de regra (mínimo de noites, capacidade, janela) voltam como `422`.
- Sem cache.

---

## `POST /api/solicitacoes`

A rota mais crítica da API pública. Ver [UC-P04](../02-casos-de-uso/publico/UC-P04-solicitar-reserva.md).

```json
{
  "casaId": "01HQ...",
  "checkin": "2026-11-20",
  "checkout": "2026-11-23",
  "hospedes": 7,
  "nome": "Maria Silva",
  "email": "maria@exemplo.com",
  "telefone": "+5511999999999",
  "observacao": "Chegaremos por volta das 18h.",
  "aceiteTermos": true,
  "_hp": "",
  "_t": 8421
}
```

| Campo | Validação |
|---|---|
| `nome` | 3–100 chars, ao menos duas palavras, sem URL |
| `email` | formato válido, até 150 chars, normalizado para minúsculas |
| `telefone` | E.164 após normalização; aceita entrada formatada em pt-BR |
| `observacao` | opcional, até 1.000 chars, sem HTML |
| `aceiteTermos` | deve ser exatamente `true` |
| `_hp` | honeypot: deve vir **vazio** |
| `_t` | milissegundos entre carregar e enviar o formulário; deve ser **≥ 3000** |

Falha de `_hp` ou `_t` responde **`201` com um corpo falso de sucesso** e descarta
silenciosamente. Responder erro ensinaria o robô a ajustar.

> Isso é deliberado e precisa estar comentado no código, senão parece bug.

Resposta `201`:

```json
{
  "reservaId": "01HQ...",
  "tokenAcesso": "aG9yYS1k...",
  "linkAcompanhamento": "https://site/reserva/01HQ...?t=aG9yYS1k...",
  "prazoLimite": "2026-10-13T18:04:00-03:00",
  "cotacao": { },
  "whatsappLink": "https://wa.me/55...?text=..."
}
```

O `tokenAcesso` volta **uma única vez**. O frontend o guarda no `sessionStorage` e o
usuário recebe o link por e-mail. Não há como recuperá-lo depois.

Erros específicos: `409 DATAS_INDISPONIVEIS`, `429 LIMITE_SOLICITACOES`,
além dos `422` de validação de regra.

---

## `GET /api/solicitacoes/{reservaId}?t=<tokenAcesso>`

Única rota pública que devolve dado pessoal. **Nunca cacheada** (CloudFront TTL 0 +
`Cache-Control: private, no-store`).

```json
{
  "reservaId": "01HQ...",
  "status": "SOLICITADA",
  "casa": { "slug": "casa-do-lago", "nome": "Casa do Lago" },
  "checkin": "2026-11-20", "checkout": "2026-11-23",
  "noites": 3, "hospedes": 7,
  "hospede": { "nome": "Maria Silva", "email": "ma***@exemplo.com" },
  "valores": { "totalCentavos": 220000, "detalhamento": [] },
  "prazoLimite": "2026-10-13T18:04:00-03:00",
  "horarioCheckin": "14:00", "horarioCheckout": "12:00",
  "podeCancelar": true,
  "whatsappLink": "https://wa.me/55...?text=...",
  "mensagemStatus": "Recebemos sua solicitação. As datas estão reservadas para você até 13/10 às 18h."
}
```

- O token é comparado com `crypto.timingSafeEqual` sobre buffers de mesmo tamanho.
  Antes, compare os tamanhos — `timingSafeEqual` lança se diferirem.
- O e-mail volta **mascarado**: o usuário só precisa reconhecer qual e-mail usou.
- `mensagemStatus` é gerada no servidor por estado, para a página não duplicar a regra.
- `podeCancelar` é `true` só em `SOLICITADA`.
- **Nunca** retorna `pagamento`, `motivoInterno`, `historico` ou `tokenAcesso`.

---

## `POST /api/solicitacoes/{reservaId}/cancelar?t=<tokenAcesso>`

Desistência do hóspede. Ver [UC-P06](../02-casos-de-uso/publico/UC-P06-cancelar-solicitacao.md).

```json
{ "motivo": "Mudamos a data da viagem" }
```

- Só permitido em `SOLICITADA` → `409 TRANSICAO_INVALIDA` caso contrário.
- Libera as noites na mesma transação.
- Idempotente: se já estiver `CANCELADA`, responde `200` com o estado atual.
- Dispara aviso ao admin.

---

## `GET /api/casas/{casaId}/calendario.ics?t=<tokenIcal>`

Export iCal da casa, para importar em Airbnb/Booking.
`Content-Type: text/calendar; charset=utf-8`. **Cache:** 60 s.

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Recanto Paraiso//Reservas//PT-BR
BEGIN:VEVENT
UID:reserva-01HQ...@recantoparaiso
DTSTAMP:20261011T210400Z
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261123
SUMMARY:Indisponível
END:VEVENT
END:VCALENDAR
```

- `SUMMARY` é sempre literalmente `Indisponível`. Nenhum dado de hóspede.
- `DTEND` é **exclusivo** (= data de check-out).
- Inclui `RESERVA` (confirmadas e pendentes não vencidas) e `BLOQUEIO`.
- **Exclui** `EXTERNO` — [R12](../01-negocio/01-regras-de-disponibilidade.md).
- Noites contíguas são agrupadas em um único `VEVENT`.
- Token inválido → `404` com corpo vazio.

---

## `GET /api/config-publica`

**Cache:** 300 s. Só os campos públicos listados em
[02 — modelo de dados](./02-modelo-de-dados.md#7-configuração-geral).

---

## Proteções sem custo

| Proteção | Como |
|---|---|
| Honeypot | Campo `_hp` oculto por CSS; preenchido = descarte silencioso |
| Tempo de formulário | `_t < 3000 ms` = descarte silencioso |
| Limite por e-mail | `maxSolicitacoesPendentesPorEmail` (padrão 3), via item `ANTIABUSO#` |
| Limite por volume | Concorrência reservada da Lambda (ex.: 5) + cache do CloudFront |
| Payload | Corpo máximo de 16 KB; acima disso, `413` antes de parsear |
| Intervalo de consulta | Máximo 13 meses na disponibilidade |
| Sem enumeração | `404` para token inválido; ULID não é sequencial |
| Timeout de saída | 5 s em toda chamada externa (SES, iCal) |

Não há rate limit por IP: o CloudFront não entrega o IP de forma confiável para essa
finalidade sem WAF, e WAF custa ~US$ 6/mês. A combinação acima é suficiente para o
volume esperado. **Gatilho de revisão:** se o custo mensal passar de US$ 5 por volume
anormal, avaliar o AWS WAF com uma regra de rate limit.
