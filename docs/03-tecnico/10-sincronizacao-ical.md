# 10 — Sincronização iCal

Objetivo único: **não dar a mesma data duas vezes** quando a casa também está
anunciada no Airbnb e/ou no Booking.

Escopo: Fase 4 (opcional). Só vale implementar se o proprietário realmente anunciar
em canais externos. Ver [fases](../06-planejamento/01-fases-e-criterios-de-aceite.md).

## Dois sentidos, assimétricos

```
IMPORTAÇÃO  (a cada 30 min, Lambda cron-ical)
  Airbnb .ics  ──┐
  Booking .ics ──┴──▶ ocupações tipo EXTERNO no nosso banco

EXPORTAÇÃO  (sob demanda, api-publica)
  nosso .ics ──▶ Airbnb e Booking importam
     inclui: RESERVA (confirmada e pendente não vencida) + BLOQUEIO
     exclui: EXTERNO   ← evita eco entre plataformas
```

A assimetria é essencial. Se exportássemos o que importamos, uma data cancelada no
Airbnb continuaria ocupada para sempre, ricocheteando entre as plataformas.

## Importação

### Configuração

Uma entrada por casa e canal:

```
Item:  ICAL#<casaId>#<canal> / META
SSM:   /recanto-paraiso/<stage>/ical/<casaId>/<canal>   (SecureString)
```

A URL do `.ics` vai para o SSM porque **é uma credencial**: quem a tem lê o calendário
daquela propriedade. O item no banco guarda apenas o nome do parâmetro.

### Algoritmo

```
Para cada casa × canal ativo:
  1. ler a URL do SSM
  2. baixar o .ics          timeout 10 s, máximo 2 MB
     falha? → incrementa falhasConsecutivas, loga, NÃO apaga nada, próximo canal
  3. parsear com `node-ical`
  4. para cada VEVENT:
       uid    = evento.uid
       noites = datas de DTSTART até DTEND − 1 dia   (DTEND é EXCLUSIVO)
       descartar eventos inteiramente no passado
       descartar eventos acima de 60 noites (provável lixo)
  5. diff contra `uidsAtivos`:
       novo       → gravar ocupações EXTERNO
       removido   → apagar as ocupações daquele refId
       alterado   → apagar as antigas e gravar as novas
  6. atualizar uidsAtivos, ultimaSyncEm, ultimoSucessoEm, falhasConsecutivas = 0
```

### A regra do `DTEND`

```
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261123
   → noites ocupadas: 20, 21, 22   (NÃO o dia 23)
```

Mesma convenção do nosso check-out. Essa é a regra mais fácil de errar em todo o
sistema e precisa de teste explícito. Um erro aqui bloqueia uma noite a mais por
reserva externa — invisível no começo, caro no fim.

### Gravação (condicional, não transacional)

```
Put OCUPACAO#<casaId>/NOITE#<data>
  Item: { tipo: "EXTERNO", refId: "<canal>:<uid>" }
  ConditionExpression:
    attribute_not_exists(PK)
    OR refId = :mesmoRef
    OR (pendente = :verdadeiro AND expiraEm < :agora)
```

Eventos são independentes, então cada noite é gravada individualmente. Não há
transação: se metade das noites de um evento externo for gravada, a próxima execução
(em 30 min) completa — e o resultado é "mais ocupado do que o real", que é o lado
seguro do erro.

### Conflito

A condição falha quando a noite pertence a uma `RESERVA` nossa (confirmada ou
pendente válida) ou a um `BLOQUEIO`. Nesse caso:

1. **Não sobrescrever.** A ocupação do site permanece.
2. Registrar o conflito no item `ICAL#...` (`conflitos[]`, últimos 20).
3. Enviar `ALERTA_ADMIN` **imediato**, com: casa, canal, datas, `reservaId` envolvido,
   nome do hóspede e telefone.
4. Marcar a casa com `temConflito: true`, para o painel do admin destacar.

O e-mail de alerta precisa ser acionável: o admin tem minutos, não dias, para decidir
qual reserva honrar.

**Anti-spam de alerta:** o mesmo conflito (mesma casa, mesmas datas, mesmo canal) gera
alerta **uma vez por dia**, não a cada 30 minutos. Controlado por um item com TTL de
24 h. Sem isso, um conflito não resolvido gera 48 e-mails por dia e o admin passa a
ignorar os alertas — o pior resultado possível.

### Falhas de download

| Situação | Ação |
|---|---|
| Timeout ou erro HTTP | `falhasConsecutivas++`, log, **nada é apagado** |
| 3 falhas consecutivas | `ALERTA_ADMIN` (uma vez; não repetir a cada ciclo) |
| 10 falhas consecutivas | `ativo = false` automaticamente + alerta. Para de tentar |
| Sucesso | `falhasConsecutivas = 0` |
| `.ics` vazio ou inválido | Tratado como falha. **Nunca** apagar tudo por isso |

> A regra "nunca apagar nada em caso de falha" é crítica. Um `.ics` que vem vazio por
> problema no Airbnb não significa "não há reservas" — significa "não sabemos".
> Apagar liberaria datas realmente ocupadas e causaria overbooking.

### Limites de segurança no download

| Limite | Valor | Por quê |
|---|---|---|
| Timeout | 10 s | Não travar a Lambda |
| Tamanho máximo | 2 MB | Evitar esgotar memória com resposta gigante |
| Redirecionamentos | Máximo 3, só para `https:` | Evitar SSRF por redirecionamento |
| Esquema da URL | Só `https:` | Validado ao salvar no SSM e antes de cada download |
| Host | **Bloquear** IPs privados, `localhost`, `169.254.169.254` | **SSRF** — a URL é configurável, portanto é entrada não confiável |

> O bloqueio de IP privado e do endpoint de metadados é obrigatório mesmo sendo a URL
> cadastrada pelo próprio admin: uma URL configurável que o servidor busca é, por
> definição, um vetor de SSRF. A Lambda não está em VPC, mas o endpoint de metadados
> `169.254.169.254` existe no ambiente de execução.

## Exportação

`GET /api/casas/{casaId}/calendario.ics?t=<tokenIcal>` — ver
[API pública](./03-api-publica.md).

| Regra | Valor |
|---|---|
| Inclui | `RESERVA` confirmada, `RESERVA` pendente não vencida, `BLOQUEIO` |
| Exclui | `EXTERNO` |
| `SUMMARY` | Sempre `Indisponível`. Nenhum dado pessoal |
| `UID` | `<tipo>-<refId>@recantoparaiso` — estável entre gerações |
| `DTEND` | Exclusivo (dia seguinte à última noite) |
| Agrupamento | Noites contíguas do **mesmo** `refId` em um `VEVENT` |
| Janela | De hoje até +13 meses |
| `Content-Type` | `text/calendar; charset=utf-8` |
| Quebra de linha | **CRLF** (`\r\n`) — exigência do RFC 5545 |
| Dobra de linha | Linhas acima de 75 octetos dobradas com `\r\n ` |
| Cache | 60 s |

> CRLF e a dobra de linha de 75 octetos não são detalhe estético: parsers de canais
> externos rejeitam `.ics` que não os respeite. Gere o arquivo com uma função testada
> em `lib/ical.ts`, com um teste que valida o arquivo contra um parser real
> (`node-ical` lendo o que acabamos de gerar).

### Por que pendentes entram no export

Uma solicitação segura a data por 48 h. Se não exportássemos, alguém poderia reservar
a mesma data no Airbnb nesse intervalo. Exportar pendentes é mais conservador —
no pior caso perde-se uma reserva externa por uma solicitação que expirou, o que é
muito melhor que overbooking.

## Agendamento

| Item | Valor |
|---|---|
| Gatilho | EventBridge Scheduler, `rate(30 minutes)` |
| Fuso | Irrelevante (intervalo fixo) |
| Timeout da Lambda | 60 s |
| Memória | 512 MB (parse de `.ics` é CPU-bound) |
| Custo | 1.440 invocações/mês → free tier |

Com 10 casas × 2 canais = 20 downloads por execução, sequenciais com timeout de 10 s
no pior caso = 200 s > timeout. Por isso: **downloads em paralelo com limite de
concorrência 5**, e o handler respeita um orçamento de tempo total de 50 s,
deixando o restante para a próxima execução (registrado em `ultimaCasaProcessada`
para retomar de onde parou).

## Sincronização manual

`POST /api/admin/ical/sincronizar` (opcionalmente com `casaId` e `canal`) invoca a
`cron-ical` de forma assíncrona e responde `202`. O admin usa isso depois de resolver
um conflito, sem esperar 30 minutos.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | `VEVENT` com `DTEND` exclusivo | Noite do `DTEND` **não** ocupada |
| 2 | Evento de 1 noite (`DTSTART` 20, `DTEND` 21) | Exatamente uma noite |
| 3 | Evento removido do `.ics` | Ocupações apagadas |
| 4 | Evento com datas alteradas | Antigas apagadas, novas gravadas |
| 5 | Reimportar o mesmo `.ics` | Nenhuma mudança (idempotente) |
| 6 | Evento externo sobre reserva nossa | Reserva preservada + alerta |
| 7 | Mesmo conflito em 4 execuções seguidas | **Um** alerta por dia |
| 8 | Download com timeout | Nada apagado; contador incrementado |
| 9 | `.ics` vazio | Nada apagado; tratado como falha |
| 10 | 3 falhas consecutivas | Um alerta |
| 11 | 10 falhas consecutivas | Canal desativado + alerta |
| 12 | URL apontando para `169.254.169.254` | Rejeitada |
| 13 | URL `http://` | Rejeitada |
| 14 | `.ics` de 10 MB | Download abortado em 2 MB |
| 15 | Export relido por `node-ical` | Mesmas noites de volta |
| 16 | Export não contém nenhum evento `EXTERNO` | Confirmado |
| 17 | Export com noites contíguas | Um único `VEVENT` |
| 18 | Export com reserva pendente válida | Incluída |
| 19 | Export com reserva pendente **vencida** | **Não** incluída |
| 20 | Linhas do export | Terminam em CRLF; nenhuma acima de 75 octetos |
