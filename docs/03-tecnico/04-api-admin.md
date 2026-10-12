# 04 — API do backoffice

Lambda `api-admin`, exposta pelo CloudFront em `/api/admin/*`.
**Toda** rota exige `Authorization: Bearer <JWT do Cognito>` — ver
[08 — Autenticação](./08-autenticacao-e-autorizacao.md).

## Convenções

Iguais às da [API pública](./03-api-publica.md), mais:

- `401 NAO_AUTENTICADO` — token ausente, expirado ou inválido.
- `403 NAO_AUTORIZADO` — token válido mas sem o grupo `admin`.
- Nenhuma rota é cacheada no CloudFront.
- Toda operação de escrita grava quem fez e quando (`atualizadoPor` = `sub` ou e-mail
  do Cognito).
- Toda escrita que muda estado usa **escrita condicional** sobre o estado esperado.

## Resumo das rotas

### Casas
| Método | Rota | UC |
|---|---|---|
| GET | `/api/admin/casas` | [A02](../02-casos-de-uso/admin/UC-A02-gerenciar-casas.md) |
| GET | `/api/admin/casas/{casaId}` | A02 |
| POST | `/api/admin/casas` | A02 |
| PUT | `/api/admin/casas/{casaId}` | A02 |
| POST | `/api/admin/casas/{casaId}/status` | A02 |
| DELETE | `/api/admin/casas/{casaId}` | A02 |

### Fotos
| Método | Rota | UC |
|---|---|---|
| POST | `/api/admin/casas/{casaId}/fotos/upload` | [A03](../02-casos-de-uso/admin/UC-A03-gerenciar-fotos.md) |
| POST | `/api/admin/casas/{casaId}/fotos` | A03 |
| PUT | `/api/admin/casas/{casaId}/fotos/ordem` | A03 |
| PUT | `/api/admin/casas/{casaId}/fotos/{fotoId}` | A03 |
| DELETE | `/api/admin/casas/{casaId}/fotos/{fotoId}` | A03 |

### Preços
| Método | Rota | UC |
|---|---|---|
| GET | `/api/admin/casas/{casaId}/precos` | [A04](../02-casos-de-uso/admin/UC-A04-gerenciar-precos.md) |
| PUT | `/api/admin/casas/{casaId}/precos` | A04 |
| POST | `/api/admin/casas/{casaId}/precos/validar` | A04 |

### Bloqueios
| Método | Rota | UC |
|---|---|---|
| GET | `/api/admin/bloqueios?casaId=&de=&ate=` | [A05](../02-casos-de-uso/admin/UC-A05-gerenciar-bloqueios.md) |
| POST | `/api/admin/bloqueios` | A05 |
| DELETE | `/api/admin/bloqueios/{bloqueioId}` | A05 |

### Agenda e reservas
| Método | Rota | UC |
|---|---|---|
| GET | `/api/admin/agenda?de=&ate=&casaId=` | [A06](../02-casos-de-uso/admin/UC-A06-ver-agenda.md) |
| GET | `/api/admin/painel` | A06 |
| GET | `/api/admin/reservas?de=&ate=&status=&casaId=&q=` | A06 |
| GET | `/api/admin/reservas/{reservaId}` | A06 |
| POST | `/api/admin/reservas` | [A11](../02-casos-de-uso/admin/UC-A11-criar-reserva-manual.md) |
| PUT | `/api/admin/reservas/{reservaId}` | A11 |
| POST | `/api/admin/reservas/{reservaId}/confirmar` | [A07](../02-casos-de-uso/admin/UC-A07-confirmar-reserva.md) |
| POST | `/api/admin/reservas/{reservaId}/recusar` | [A08](../02-casos-de-uso/admin/UC-A08-recusar-ou-cancelar-reserva.md) |
| POST | `/api/admin/reservas/{reservaId}/cancelar` | A08 |
| POST | `/api/admin/reservas/{reservaId}/estender-prazo` | [A09](../02-casos-de-uso/admin/UC-A09-estender-prazo.md) |
| POST | `/api/admin/reservas/{reservaId}/pagamento` | [A10](../02-casos-de-uso/admin/UC-A10-registrar-pagamento.md) |
| POST | `/api/admin/reservas/{reservaId}/reenviar-email` | A06 |

### Templates de e-mail
| Método | Rota | UC |
|---|---|---|
| GET | `/api/admin/templates` | [A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md) |
| GET | `/api/admin/templates/{codigo}` | A12 |
| PUT | `/api/admin/templates/{codigo}` | A12 |
| POST | `/api/admin/templates/{codigo}/previsualizar` | A12 |
| POST | `/api/admin/templates/{codigo}/enviar-teste` | A12 |
| POST | `/api/admin/templates/{codigo}/restaurar-padrao` | A12 |
| GET | `/api/admin/templates/{codigo}/versoes` | A12 |
| POST | `/api/admin/templates/{codigo}/restaurar-versao` | A12 |

### Configuração, publicação, relatório, iCal
| Método | Rota | UC |
|---|---|---|
| GET / PUT | `/api/admin/config` | [A13](../02-casos-de-uso/admin/UC-A13-configuracao-geral.md) |
| POST | `/api/admin/publicar` | [A14](../02-casos-de-uso/admin/UC-A14-publicar-site.md) |
| GET | `/api/admin/publicar/status` | A14 |
| GET | `/api/admin/relatorio?ano=&mes=&casaId=` | [A15](../02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md) |
| GET | `/api/admin/ical` | [A16](../02-casos-de-uso/admin/UC-A16-sincronizar-ical.md) |
| PUT | `/api/admin/ical/{casaId}/{canal}` | A16 |
| POST | `/api/admin/ical/sincronizar` | A16 |

---

## Contratos relevantes

Os detalhes de regra ficam em cada UC. Aqui estão apenas os contratos que mais de um
UC consome.

### `GET /api/admin/painel`

Tudo que a tela inicial precisa, em **uma** requisição — evita cinco chamadas e cinco
estados de carregamento.

```json
{
  "solicitacoesPendentes": [
    {
      "reservaId": "01HQ...", "casaNome": "Casa do Lago",
      "hospedeNome": "Maria Silva", "telefone": "+5511999999999",
      "checkin": "2026-11-20", "checkout": "2026-11-23",
      "hospedes": 7, "totalCentavos": 220000,
      "prazoLimite": "2026-10-13T18:04:00-03:00",
      "horasRestantes": 41,
      "criadoEm": "2026-10-11T18:04:00-03:00"
    }
  ],
  "proximosCheckins": [
    { "reservaId": "01HQ...", "casaNome": "Casa do Lago", "checkin": "2026-10-18",
      "hospedeNome": "João", "diasRestantes": 7, "pagamentoSituacao": "PARCIAL" }
  ],
  "alertas": [
    { "tipo": "CONFLITO_ICAL", "severidade": "ALTA", "mensagem": "...", "em": "...", "casaId": "..." }
  ],
  "ocupacaoMesAtual": [
    { "casaId": "01HQ...", "casaNome": "Casa do Lago",
      "noitesOcupadas": 12, "noitesDoMes": 31, "taxaOcupacao": 0.387 }
  ],
  "publicacaoPendente": true
}
```

`horasRestantes` e `diasRestantes` são calculados no **servidor**, em
`America/Sao_Paulo`. O navegador do admin pode estar em outro fuso — nunca deixe esse
cálculo no cliente.

### `GET /api/admin/agenda`

Visão de calendário. Diferente da disponibilidade pública: aqui o tipo e o dono de
cada noite **aparecem**.

```json
{
  "de": "2026-11-01", "ate": "2026-11-30",
  "casas": [
    {
      "casaId": "01HQ...", "casaNome": "Casa do Lago",
      "noites": [
        { "data": "2026-11-20", "tipo": "RESERVA", "refId": "01HQ...",
          "rotulo": "Maria Silva", "status": "CONFIRMADA", "pendente": false },
        { "data": "2026-11-25", "tipo": "BLOQUEIO", "refId": "01HR...",
          "rotulo": "Manutenção da bomba", "pendente": false },
        { "data": "2026-11-28", "tipo": "EXTERNO", "refId": "AIRBNB:abc123",
          "rotulo": "Airbnb", "pendente": false }
      ]
    }
  ]
}
```

Intervalo máximo: **3 meses** por requisição (a tela mostra um mês por vez).

### `GET /api/admin/reservas`

Filtros: `de`, `ate` (por check-in), `status` (múltiplos, separados por vírgula),
`casaId`, `q` (busca por nome, e-mail ou telefone — aplicada **na Lambda**, não no
banco; aceitável no volume previsto).

Paginação por `cursor` opaco (o `LastEvaluatedKey` do DynamoDB codificado em base64url).
Nunca exponha o `LastEvaluatedKey` cru — ele revela a estrutura das chaves.

### `GET /api/admin/reservas/{reservaId}`

A reserva completa, incluindo o que o público nunca vê: `pagamento`, `motivoInterno`,
`historico`, `historicoEnvios`, `emailsEnviados`, `tokenAcesso` (para o admin poder
reenviar o link), e o bloco de cancelamento calculado:

```json
{
  "cancelamento": {
    "diasAteCheckin": 41,
    "faixaAplicada": { "diasMinimos": 30, "percentualDevolucao": 100 },
    "devolucaoSugeridaCentavos": 110000
  }
}
```

### `POST /api/admin/reservas/{reservaId}/confirmar`

```json
{ "descontoCentavos": 0, "observacaoInterna": "", "enviarEmail": true }
```

Resposta `200` com a reserva atualizada e:

```json
{ "emailEnviado": true, "avisoEmail": null }
```

Se o e-mail falhar: `emailEnviado: false` e `avisoEmail` com o texto a exibir.
**A confirmação permanece válida** — ver
[ciclo de vida](../01-negocio/03-ciclo-de-vida-da-reserva.md#por-que-os-e-mails-ficam-fora-da-transação).

### `GET /api/admin/relatorio`

```json
{
  "ano": 2026, "mes": 11,
  "porCasa": [
    { "casaId": "01HQ...", "casaNome": "Casa do Lago",
      "noitesDoMes": 30, "noitesOcupadas": 12, "taxaOcupacao": 0.4,
      "noitesPorOrigem": { "RESERVA": 10, "BLOQUEIO": 1, "EXTERNO": 1 },
      "reservasConfirmadas": 4, "reservasCanceladas": 1,
      "valorTotalCentavos": 880000, "valorRecebidoCentavos": 440000,
      "diariaMediaCentavos": 73333 }
  ],
  "totais": { },
  "funil": { "solicitacoes": 12, "confirmadas": 4, "recusadas": 2, "expiradas": 6,
             "taxaConversao": 0.333 }
}
```

O funil é o número mais útil do relatório: **quantas solicitações expiram sem resposta**
mede diretamente se o admin está perdendo negócio por demora.

`valorRecebidoCentavos` vem do registro manual de pagamento e é uma informação de
controle, **não contábil**. O relatório deve dizer isso na tela.

---

## Padrão obrigatório de cada handler de escrita

```
1. verificarJwt(evento)                  → 401 / 403
2. validarEntrada(zod)                   → 400 ENTRADA_INVALIDA
3. carregarRecurso()                     → 404 NAO_ENCONTRADO
4. validarTransicao(estadoAtual, acao)   → 409 TRANSICAO_INVALIDA
5. executarTransacaoCondicional()        → 409 em ConditionalCheckFailed
6. responder(200)
7. efeitos colaterais (e-mail, publicação) — fora do caminho crítico
```

Os passos 4 e 5 são redundantes **de propósito**: o 4 dá mensagem boa, o 5 garante
correção sob concorrência. Remover o 5 por achar o 4 suficiente é o bug clássico
deste tipo de sistema.

## Limites de tamanho de entrada

| Rota | Limite do corpo |
|---|---|
| `PUT /api/admin/casas/{id}` | 64 KB |
| `PUT /api/admin/templates/{codigo}` | 64 KB |
| `PUT /api/admin/config` | 128 KB |
| Demais | 16 KB |

Validar o tamanho **antes** de parsear o JSON.
