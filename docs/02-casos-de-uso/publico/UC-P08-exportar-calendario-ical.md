# UC-P08 — Exportar calendário iCal

| Campo | Valor |
|---|---|
| Ator | Sistema externo (Airbnb, Booking, Google Calendar) ou o próprio administrador |
| Pré-condições | Casa existente com `tokenIcal` gerado |
| Gatilho | O sistema externo busca a URL periodicamente, ou o admin abre o arquivo |
| Fase | 4 |
| Relacionados | [10 — iCal](../../03-tecnico/10-sincronizacao-ical.md), [UC-A16](../admin/UC-A16-sincronizar-ical.md), [Regras de disponibilidade](../../01-negocio/01-regras-de-disponibilidade.md) |

## Objetivo de negócio

Impedir **overbooking** quando a casa está anunciada também no Airbnb e/ou no Booking.
O canal externo importa esta URL e bloqueia as datas já ocupadas pelo nosso site.

É o sentido **saída** da sincronização; a entrada está em
[UC-A16](../admin/UC-A16-sincronizar-ical.md).

Benefício secundário: o próprio proprietário pode assinar a URL no Google Calendar do
celular e ver a agenda da casa junto com os compromissos pessoais.

## Fluxo principal

1. O administrador copia a URL do `.ics` da casa no backoffice.
2. Cola na área de sincronização de calendário do Airbnb/Booking.
3. O canal externo busca a URL periodicamente (o intervalo é definido por eles,
   tipicamente de 1 a 4 horas — **não controlamos isso**).
4. A `api-publica` valida o `tokenIcal`, lê as ocupações dos próximos 13 meses e devolve
   um `VCALENDAR`.
5. O canal externo bloqueia as datas na sua própria agenda.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Casa sem nenhuma ocupação | `VCALENDAR` **válido e vazio** (sem `VEVENT`). Nunca erro |
| A2 | Admin assina no Google Calendar | Funciona; o Google atualiza a cada ~8 h |
| A3 | Admin rotaciona o token | A URL antiga passa a responder `404`; a tela avisa que é preciso recadastrar nos canais |
| A4 | Várias casas | Uma URL por casa. Cada anúncio externo aponta para a sua |

## Fluxos de exceção

| # | Situação | Resposta |
|---|---|---|
| E1 | Sem `?t=` | `404`, corpo vazio |
| E2 | Token errado | `404`, corpo vazio |
| E3 | Token de outra casa | `404`, corpo vazio |
| E4 | `casaId` inexistente | `404` |
| E5 | Erro interno | `500` com corpo vazio. **Nunca** devolver um `.ics` parcial |

> E5 é a regra mais importante aqui. Um `.ics` incompleto faria o canal externo
> **liberar** datas que estão ocupadas — exatamente o overbooking que o recurso
> existe para evitar. Falhar é seguro; responder pela metade não é.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | `tokenIcal` obrigatório; inválido → `404` |
| RN2 | Inclui `RESERVA` **confirmada** |
| RN3 | Inclui `RESERVA` **pendente não vencida** (conservador: ver abaixo) |
| RN4 | Inclui `BLOQUEIO` |
| RN5 | **Exclui** `EXTERNO` — evita eco entre plataformas |
| RN6 | `SUMMARY` é sempre literalmente `Indisponível` |
| RN7 | Nenhum dado pessoal: nem nome, nem e-mail, nem telefone, nem valor |
| RN8 | `DTEND` é **exclusivo** (dia seguinte à última noite) |
| RN9 | Noites contíguas do **mesmo** `refId` viram um único `VEVENT` |
| RN10 | Janela: de hoje até hoje + 13 meses |
| RN11 | `UID` estável entre gerações: `<tipo>-<refId>@recantoparaiso` |
| RN12 | Linhas terminam em **CRLF**; linhas acima de 75 octetos são dobradas |
| RN13 | Cache de 60 s |
| RN14 | Em caso de erro parcial, falhar inteiro |

### Por que pendentes entram (RN3)

Uma solicitação segura a data por 48 h. Se não a exportássemos, alguém poderia
reservar o mesmo período no Airbnb nesse intervalo e criar um conflito real.

O custo é assimétrico e a escolha é clara:

| Decisão | Pior caso |
|---|---|
| **Incluir pendentes** | Perde-se uma reserva externa por uma solicitação que depois expirou |
| Não incluir | **Overbooking**: duas famílias com reserva para a mesma casa |

Perder uma reserva é prejuízo; overbooking é prejuízo **mais** uma situação
inadministrável no dia do check-in.

## Contrato técnico

```http
GET /api/casas/{casaId}/calendario.ics?t=<tokenIcal>

HTTP/1.1 200 OK
Content-Type: text/calendar; charset=utf-8
Cache-Control: public, max-age=60
Content-Disposition: inline; filename="casa-do-lago.ics"
```

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Recanto Paraiso//Reservas 1.0//PT-BR
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Casa do Lago - Indisponibilidade
BEGIN:VEVENT
UID:reserva-01HQ8X7Y3Z@recantoparaiso
DTSTAMP:20261011T210400Z
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261123
SUMMARY:Indisponível
TRANSP:OPAQUE
END:VEVENT
BEGIN:VEVENT
UID:bloqueio-01HR2A@recantoparaiso
DTSTAMP:20261011T210400Z
DTSTART;VALUE=DATE:20261210
DTEND;VALUE=DATE:20261216
SUMMARY:Indisponível
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR
```

| Campo | Observação |
|---|---|
| `VERSION:2.0` | Obrigatório pelo RFC 5545 |
| `DTSTAMP` | UTC, formato `YYYYMMDDTHHMMSSZ` |
| `DTSTART`/`DTEND` | `VALUE=DATE` — evento de dia inteiro, sem hora nem fuso |
| `TRANSP:OPAQUE` | Marca o período como ocupado (não "livre") |
| `METHOD:PUBLISH` | Calendário publicado, não convite |

> Usar `VALUE=DATE` em vez de `DATE-TIME` elimina toda a classe de bugs de fuso
> horário na sincronização. Um evento de dia inteiro não tem hora para ser
> reinterpretada no destino.

## Implementação

| Arquivo | O que faz |
|---|---|
| `backend/src/lib/ical.ts` | `gerarIcs(eventos)` e `parsearIcs(texto)` |
| `backend/src/domain/disponibilidade.ts` | `agruparNoitesContiguas(ocupacoes)` — pura |
| `backend/src/handlers/api-publica.ts` | Rota do `.ics` |

### Algoritmo

```
1. GetItem CASA#<casaId>/META           → 404 se não existir
2. validar tokenIcal (timingSafeEqual)  → 404
3. Query OCUPACAO#<casaId>, SK BETWEEN NOITE#<hoje> AND NOITE#<hoje+13m>
4. filtrar: descartar tipo EXTERNO
            descartar pendente com expiraEm < agora
5. agrupar noites contíguas por refId
6. gerar VEVENT por grupo, com DTEND = ultimaNoite + 1 dia
7. serializar com CRLF e dobra de 75 octetos
8. responder 200
```

### `agruparNoitesContiguas` — função pura, testada

```
Entrada: [{data:"2026-11-20",refId:"A"}, {data:"2026-11-21",refId:"A"},
          {data:"2026-11-22",refId:"A"}, {data:"2026-11-25",refId:"B"}]
Saída:   [{refId:"A", inicio:"2026-11-20", fim:"2026-11-22"},
          {refId:"B", inicio:"2026-11-25", fim:"2026-11-25"}]
```

Dois grupos não se fundem se o `refId` difere, **mesmo que as datas sejam contíguas** —
duas reservas seguidas são dois eventos, e fundi-las mudaria os `UID`s a cada geração.

### Armadilhas

1. **CRLF.** `\n` sozinho faz parsers rejeitarem o arquivo. Use `\r\n` em toda linha,
   inclusive a última.
2. **Dobra de 75 octetos.** Conta **octetos**, não caracteres — `Indisponível` tem
   acento e ocupa mais bytes que caracteres em UTF-8. A continuação começa com **um
   espaço**.
3. **`DTEND` exclusivo.** Última noite 22 → `DTEND` 23. Errar aqui bloqueia um dia a
   mais (ou a menos) em todos os canais.
4. **Fuso no `DTSTAMP`.** É UTC, com `Z`. O resto é `VALUE=DATE`, sem fuso.
5. **Não vazar dados.** Nenhum `DESCRIPTION`, `LOCATION`, `ATTENDEE` ou `ORGANIZER`.
   É tentador colocar o nome do hóspede para o admin ver no Google Calendar — **não
   faça**: esse arquivo vai para servidores de terceiros.
6. **Teste de ida e volta.** Gerar e reparsear com `node-ical` deve devolver as mesmas
   noites. É o único teste que pega os erros 1, 2 e 3 de uma vez.

## Interface

Não há interface pública. No backoffice
([UC-A16](../admin/UC-A16-sincronizar-ical.md)):

```
Calendário desta casa (para exportar)
┌───────────────────────────────────────────────────────┐
│ https://<site>/api/casas/01HQ.../calendario.ics?t=... │
│                                        [ Copiar ]      │
│                                                        │
│ Cole esta URL no Airbnb ou no Booking para que eles    │
│ bloqueiem as datas já ocupadas aqui.                   │
│                                                        │
│ [ Gerar novo link ]  ⚠ invalida o link atual — você    │
│                        precisará recadastrar nos canais│
└───────────────────────────────────────────────────────┘
```

A URL completa (com token) só aparece na tela do admin autenticado, e a ação de
rotacionar exige confirmação que explica a consequência.

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | `tokenIcal` por casa, 256 bits, comparado em tempo constante |
| Dados expostos | **Apenas datas.** Nenhum campo descritivo |
| Enumeração | `404` uniforme; `casaId` é ULID |
| Log | O parâmetro `t` é redigido |
| Cache | 60 s público — seguro porque o conteúdo não tem dado pessoal |
| Rotação | Possível a qualquer momento pelo admin |
| Risco residual | A URL fica armazenada no Airbnb/Booking. Se vazar, expõe **datas ocupadas**, não pessoas |

> O conteúdo ser propositalmente pobre (só datas + "Indisponível") é o que torna
> aceitável uma URL com token fixo armazenada em serviços de terceiros.

## Critérios de aceite

- [ ] `.ics` válido pelo RFC 5545, aceito por `node-ical` e pelo Google Calendar.
- [ ] `DTEND` exclusivo.
- [ ] Noites contíguas do mesmo `refId` em um único `VEVENT`.
- [ ] Reservas confirmadas e pendentes válidas incluídas.
- [ ] Pendentes vencidas **não** incluídas.
- [ ] Bloqueios incluídos.
- [ ] Nenhum evento de origem `EXTERNO`.
- [ ] `SUMMARY` sempre `Indisponível`; nenhum dado pessoal em nenhum campo.
- [ ] Token inválido/ausente → `404` com corpo vazio.
- [ ] Token de outra casa → `404`.
- [ ] Linhas em CRLF, nenhuma acima de 75 octetos.
- [ ] Casa sem ocupações → `VCALENDAR` válido e vazio.
- [ ] Erro interno → `500` sem corpo (nunca `.ics` parcial).
- [ ] `Content-Type: text/calendar; charset=utf-8`.
- [ ] Token redigido nos logs.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Reserva confirmada 20–23 | `DTSTART` 20261120, `DTEND` 20261123 |
| 2 | Reserva de 1 noite | `DTSTART` 20, `DTEND` 21 |
| 3 | Duas reservas contíguas (`refId` diferentes) | Dois `VEVENT` |
| 4 | Bloqueio de 10 a 15 inclusivo | `DTSTART` 10, `DTEND` 16 |
| 5 | Evento externo presente no banco | Ausente do `.ics` |
| 6 | Pendente válida | Presente |
| 7 | Pendente vencida | Ausente |
| 8 | Casa sem ocupações | `VCALENDAR` vazio, `200` |
| 9 | Sem token | `404`, corpo vazio |
| 10 | Token errado | `404` |
| 11 | Token de outra casa | `404` |
| 12 | Token de tamanho diferente | `404`, sem `500` |
| 13 | Ida e volta com `node-ical` | Mesmas noites |
| 14 | Inspeção de todos os campos | Nenhum dado pessoal |
| 15 | Linhas do arquivo | Todas em CRLF, ≤ 75 octetos |
| 16 | Reserva daqui a 14 meses | Ausente (fora da janela) |
| 17 | Reserva no passado | Ausente |
| 18 | Log da requisição | `t=[REDIGIDO]` |
| 19 | Importação no Google Calendar | Datas corretas, sem deslocamento de um dia |
