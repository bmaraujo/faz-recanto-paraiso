# UC-A16 — Sincronizar calendários externos

| Campo | Valor |
|---|---|
| Ator | Administrador (configuração) e sistema (`cron-ical`, a cada 30 min) |
| Pré-condições | Autenticado; casa com anúncio em canal externo |
| Gatilho | O admin abre `/admin/canais`, ou o EventBridge dispara a sincronização |
| Fase | 4 (opcional) |
| Relacionados | [10 — iCal](../../03-tecnico/10-sincronizacao-ical.md), [UC-P08](../publico/UC-P08-exportar-calendario-ical.md), [Regras de disponibilidade](../../01-negocio/01-regras-de-disponibilidade.md) |

## Objetivo de negócio

Se a casa está anunciada no Airbnb **e** no site, a mesma data pode ser vendida duas
vezes. Overbooking é o único erro deste sistema que não tem solução boa: uma das duas
famílias chega e não tem onde dormir.

A sincronização iCal é a defesa, nos dois sentidos:

| Sentido | O que faz | UC |
|---|---|---|
| **Importar** | Traz as datas ocupadas no Airbnb/Booking para a nossa agenda | este |
| **Exportar** | Entrega as nossas datas ocupadas para eles bloquearem | [UC-P08](../publico/UC-P08-exportar-calendario-ical.md) |

**Limitação honesta:** a sincronização por iCal **não é em tempo real**. O Airbnb
atualiza o `.ics` dele com atraso (minutos a horas) e busca o nosso no ritmo dele.
Existe uma janela — tipicamente de 1 a 4 horas — em que o overbooking é possível.
Isso não é defeito da nossa implementação: é como o protocolo funciona, e **é a razão
pela qual o conflito gera alerta em vez de ser silenciosamente resolvido**.

Essa limitação precisa estar escrita na tela, para o proprietário não confiar demais.

## Fluxo principal — configurar

1. O admin abre `/admin/canais`.
2. Para cada casa, vê os canais configurados e o status de cada um.
3. Clica em **"Adicionar canal"**, escolhe a casa, o canal (Airbnb / Booking / Outro) e
   cola a **URL do calendário** fornecida pelo canal externo.
4. O sistema **testa a URL na hora**: baixa, parseia e mostra quantos eventos encontrou.
5. Salva. A URL vai para o SSM (SecureString); o item no banco guarda só o nome do
   parâmetro.
6. Copia a **URL de exportação** da casa e cola no canal externo.

## Fluxo principal — sincronização automática

A cada 30 minutos, para cada casa × canal ativo:

```
1. ler a URL do SSM
2. baixar o .ics (timeout 10 s, máximo 2 MB, só https, sem IP privado)
3. parsear; converter cada VEVENT em noites (DTEND exclusivo)
4. diff contra uidsAtivos:
     novo     → gravar ocupações EXTERNO
     removido → apagar as ocupações daquele refId
     alterado → apagar as antigas, gravar as novas
5. conflito (noite já é RESERVA ou BLOQUEIO nosso):
     não sobrescrever + registrar + ALERTA_ADMIN (máx. 1/dia por conflito)
6. atualizar uidsAtivos, ultimaSyncEm, falhasConsecutivas
```

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Admin dispara sincronização manual | `POST /api/admin/ical/sincronizar`, opcionalmente para uma casa/canal; resposta `202` |
| A2 | Admin desativa um canal temporariamente | `ativo = false`; as ocupações já importadas **permanecem** |
| A3 | Admin remove um canal | Confirmação; as ocupações `EXTERNO` daquele canal são apagadas |
| A4 | Admin rotaciona o token de exportação | Nova URL; aviso de que precisa recadastrar nos canais |
| A5 | Casa anunciada em três canais | Três entradas para a mesma casa |
| A6 | Admin resolve um conflito | Cancela a reserva de um lado e dispara sincronização manual |

> A2 vs. A3 é uma distinção importante: **desativar** para de importar mas mantém as
> datas já bloqueadas (seguro). **Remover** libera as datas (pode causar overbooking se
> o anúncio externo continuar ativo). A tela precisa explicar a diferença antes de
> remover.

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | URL inválida ao configurar | `422 URL_INVALIDA` | "Não conseguimos baixar este calendário. Confira a URL no Airbnb." |
| E2 | URL `http://` | `422` | "O endereço precisa começar com https://." |
| E3 | URL apontando para IP privado ou metadados | `422 URL_NAO_PERMITIDA` | "Este endereço não é permitido." |
| E4 | `.ics` inválido ao configurar | `422` | "O arquivo não é um calendário válido." |
| E5 | `.ics` acima de 2 MB | `422` | "O calendário é muito grande." |
| E6 | Falha de download na sincronização | — | `falhasConsecutivas++`; **nada é apagado**; status "com problema" |
| E7 | 3 falhas consecutivas | — | **Um** `ALERTA_ADMIN` |
| E8 | 10 falhas consecutivas | — | Canal **desativado automaticamente** + alerta |
| E9 | `.ics` vem vazio | — | Tratado como **falha**; nada é apagado |
| E10 | Conflito com reserva nossa | — | Reserva preservada + `ALERTA_ADMIN` + destaque no painel |
| E11 | Mesmo conflito em 48 execuções/dia | — | **Um** alerta por dia |
| E12 | Evento com mais de 60 noites | — | Ignorado (provável lixo) + log |
| E13 | Evento inteiramente no passado | — | Ignorado |
| E14 | Muitas casas × canais, orçamento de tempo esgotado | — | Processa o que couber em 50 s; retoma na próxima execução |

> **E9 é a regra mais importante do UC.** Um `.ics` vazio **não** significa "não há
> reservas" — significa "não sabemos". Se o Airbnb tiver um problema e devolver um
> arquivo vazio, apagar as ocupações liberaria datas realmente ocupadas e causaria
> exatamente o overbooking que o recurso existe para prevenir.
>
> A regra geral: **em caso de dúvida, mais ocupado é mais seguro que mais livre.**
>
> **E11 existe para o alerta continuar funcionando como alerta.** Um conflito não
> resolvido gerando 48 e-mails por dia treina o admin a ignorar a caixa de alertas — e
> aí o próximo conflito, que ele poderia resolver, passa batido.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Uma configuração por casa × canal |
| RN2 | A URL fica no **SSM SecureString**; o banco guarda só o nome do parâmetro |
| RN3 | Só `https:`; IP privado, `localhost` e `169.254.169.254` bloqueados |
| RN4 | Timeout de 10 s; máximo 2 MB; até 3 redirecionamentos, só para `https:` |
| RN5 | `DTEND` do iCal é **exclusivo** |
| RN6 | Ocupações importadas têm `tipo = EXTERNO`, `refId = <canal>:<uid>` |
| RN7 | Importação **nunca** sobrescreve `RESERVA` ou `BLOQUEIO` |
| RN8 | Importação **pode** sobrescrever pendência vencida |
| RN9 | Conflito gera `ALERTA_ADMIN`, no máximo 1 por dia por conflito |
| RN10 | Falha de download **nunca** apaga ocupações |
| RN11 | 3 falhas → um alerta; 10 falhas → canal desativado + alerta |
| RN12 | `.ics` vazio ou inválido = falha |
| RN13 | Sincronização a cada 30 min; manual sob demanda |
| RN14 | Downloads em paralelo, concorrência 5, orçamento de 50 s por execução |
| RN15 | Remover um canal apaga as ocupações `EXTERNO` dele |
| RN16 | Desativar um canal **mantém** as ocupações |
| RN17 | A exportação **exclui** `EXTERNO` (evita eco) |
| RN18 | A URL do `.ics` **nunca** aparece em log |

## Contrato técnico

### `GET /api/admin/ical`

```json
{
  "canais": [
    {
      "casaId": "01HQ...", "casaNome": "Casa do Lago",
      "canal": "AIRBNB", "ativo": true,
      "urlConfigurada": true,
      "urlMascarada": "https://www.airbnb.com.br/calendar/ical/123...****",
      "ultimaSyncEm": "2026-10-11T18:00:00-03:00",
      "ultimoSucessoEm": "2026-10-11T18:00:00-03:00",
      "falhasConsecutivas": 0,
      "eventosImportados": 7,
      "noitesImportadas": 23,
      "conflitos": [
        { "data": "2026-11-25", "reservaId": "01HQ8X...", "hospedeNome": "Maria Silva",
          "detectadoEm": "2026-10-11T18:00:00-03:00" }
      ],
      "urlExportacao": "https://<site>/api/casas/01HQ.../calendario.ics?t=..."
    }
  ],
  "avisoLimitacao": "A sincronização acontece a cada 30 minutos e depende do ritmo de atualização de cada canal. Existe uma janela de algumas horas em que a mesma data pode ser reservada nos dois lugares."
}
```

A URL de importação volta **mascarada** — ela é credencial. O admin não precisa vê-la
de novo; se perdeu, recadastra.

### `PUT /api/admin/ical/{casaId}/{canal}`

```json
{ "url": "https://www.airbnb.com.br/calendar/ical/12345.ics?s=abc", "ativo": true }
```

O servidor valida a URL, **testa o download** e só então grava no SSM.

Resposta `200`:

```json
{
  "canal": "AIRBNB", "ativo": true,
  "teste": { "sucesso": true, "eventosEncontrados": 7, "noitesEncontradas": 23,
             "primeiroEvento": "2026-11-01", "ultimoEvento": "2027-02-15" }
}
```

Mostrar "7 eventos, 23 noites" é o que dá confiança de que a URL está certa — muito
melhor que um "salvo com sucesso".

### Outras rotas

| Rota | Função |
|---|---|
| `DELETE /api/admin/ical/{casaId}/{canal}` | Remove o canal e as ocupações dele |
| `POST /api/admin/ical/sincronizar` | `{ "casaId"?, "canal"? }` → `202` |
| `POST /api/admin/casas/{casaId}/token-ical/rotacionar` | Novo token de exportação |

### Erros

| Código | HTTP |
|---|---|
| `ENTRADA_INVALIDA` | 400 |
| `NAO_ENCONTRADO` | 404 |
| `URL_INVALIDA` | 422 |
| `URL_NAO_PERMITIDA` | 422 |
| `ICAL_INVALIDO` | 422 |

## Implementação

Algoritmo e detalhes de protocolo em
[10 — Sincronização iCal](../../03-tecnico/10-sincronizacao-ical.md).
Aqui, o que é específico deste UC:

### Proteção contra SSRF

```ts
const BLOQUEADOS = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^::1$/, /^fc00:/, /^fe80:/,
];

async function validarUrlExterna(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new ErroHttp(422, "URL_INVALIDA");
  const { address } = await dns.promises.lookup(u.hostname);
  if (BLOQUEADOS.some((p) => p.test(address))) {
    throw new ErroHttp(422, "URL_NAO_PERMITIDA");
  }
}
```

Validado ao configurar **e antes de cada download** — o DNS pode mudar entre os dois
(ataque de *DNS rebinding*).

> Isso é obrigatório mesmo sendo a URL cadastrada pelo próprio admin: uma URL
> configurável que o servidor busca é, por definição, um vetor de SSRF. A Lambda não
> está em VPC, mas o endpoint de metadados `169.254.169.254` existe no ambiente de
> execução.

### Anti-spam de alerta (RN9/E11)

```
Chave do alerta: ALERTA_ICAL#<casaId>#<canal>#<hash das datas em conflito>
Item com ttl de 24 h.
Enviar o e-mail só se o Put condicional (attribute_not_exists) tiver sucesso.
```

### Orçamento de tempo (RN14/E14)

```
inicio = Date.now()
para cada lote de 5 canais em paralelo:
  se Date.now() - inicio > 50_000: salvar `proximoIndice` e sair
  processar o lote
```

Com 10 casas × 2 canais e timeout de 10 s por download, o pior caso sequencial seria
200 s — bem acima do timeout de 60 s da Lambda. Paralelismo 5 + orçamento de 50 s
resolve, e o `proximoIndice` garante que ninguém fica sem sincronizar.

### Armadilhas

1. **`DTEND` exclusivo** (RN5). Errar bloqueia um dia a mais por reserva externa —
   invisível no começo, caro no fim.
2. **Nunca apagar em caso de falha** (RN10/E9).
3. **Anti-spam de alerta** (RN9).
4. **SSRF** (RN3) — validar também antes de cada download.
5. **URL nunca em log** (RN18). É credencial.
6. **Idempotência**: reimportar o mesmo `.ics` não muda nada. A condição
   `refId = :mesmoRef` garante.
7. **Export não ecoa** (RN17).
8. **Fuso**: `VALUE=DATE` não tem fuso. Se um `VEVENT` vier com `DATE-TIME` e fuso,
   converter para `America/Sao_Paulo` antes de extrair a data.
9. **Remover canal apaga ocupações; desativar não** (RN15/RN16) — e a tela precisa
   explicar a diferença.

## Interface

```
Canais externos
┌──────────────────────────────────────────────────────────────────┐
│ ⓘ A sincronização roda a cada 30 minutos e depende do ritmo de   │
│   cada canal. Existe uma janela de algumas horas em que a mesma  │
│   data pode ser reservada nos dois lugares. Confira a agenda     │
│   antes de confirmar reservas de última hora.                    │
├──────────────────────────────────────────────────────────────────┤
│ CASA DO LAGO                                                      │
│                                                                   │
│  Airbnb                                              ● ativo      │
│  https://www.airbnb.com.br/calendar/ical/123...****               │
│  Última sincronização: hoje às 18h00 ✓                            │
│  7 eventos · 23 noites importadas                                 │
│  ⚠ 1 conflito: 25/11 também tem reserva de Maria Silva  [ Ver ]  │
│                             [ Sincronizar agora ] [ Editar ] [ 🗑 ]│
│                                                                   │
│  Booking                                          ⚠ com problema  │
│  https://admin.booking.com/ical/...****                           │
│  Última tentativa: hoje às 18h00 ✗ (3 falhas seguidas)            │
│  Último sucesso: ontem às 14h30                                   │
│  Erro: tempo de resposta esgotado                                 │
│                             [ Sincronizar agora ] [ Editar ] [ 🗑 ]│
│                                                                   │
│  CALENDÁRIO DESTA CASA (para exportar)                            │
│  https://site/api/casas/01HQ.../calendario.ics?t=...  [ Copiar ] │
│  Cole esta URL no Airbnb e no Booking para que eles bloqueiem      │
│  as datas já ocupadas aqui.                                       │
│  [ Gerar novo link ]  ⚠ invalida o atual                          │
│                                                                   │
│                                    [ + Adicionar canal ]          │
└──────────────────────────────────────────────────────────────────┘
```

Diálogo de adicionar:

```
┌──────────────────────────────────────────────────────┐
│  Adicionar canal                                      │
│                                                        │
│  Casa *    [ Casa do Lago            ▾ ]              │
│  Canal *   [ Airbnb                  ▾ ]              │
│  URL do calendário *                                   │
│  [ https://www.airbnb.com.br/calendar/ical/... ]      │
│                                                        │
│  Onde encontrar: no Airbnb, vá em Calendário →         │
│  Disponibilidade → Sincronizar calendários →           │
│  Exportar calendário.                                  │
│                                                        │
│  [ Testar ]                                            │
│  ✓ Calendário válido: 7 eventos, 23 noites,            │
│    de 01/11/2026 a 15/02/2027                          │
│                                                        │
│              [ Voltar ]  [ Salvar ]                    │
└──────────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| Aviso de limitação | **Permanente** no topo, não escondido |
| URL mascarada | É credencial |
| Teste antes de salvar | Mostra eventos e noites encontrados |
| Instrução de onde achar a URL | O admin não sabe navegar no painel do Airbnb |
| Conflito com link | Acionável, não só sinalizado |
| Status por canal | Última sincronização, último sucesso, erro |
| Remover | Confirmação explicando que as datas serão **liberadas** |
| Desativar | Alternativa oferecida no mesmo diálogo |
| Rotacionar token | Confirmação explicando que invalida a URL já cadastrada |
| Mobile | Funciona; copiar URL com um toque |

## Segurança e privacidade

| Risco | Mitigação |
|---|---|
| **SSRF** | `https` obrigatório + bloqueio de IP privado e metadados, verificado antes de cada download |
| Resposta gigante | Limite de 2 MB |
| Travamento | Timeout de 10 s; orçamento de 50 s na execução |
| Redirecionamento malicioso | Máximo 3, só `https:`, validados |
| Vazamento da URL | SSM SecureString; mascarada na interface; nunca em log |
| Vazamento pelo export | Só datas + `Indisponível` ([UC-P08](../publico/UC-P08-exportar-calendario-ical.md)) |
| Eco entre plataformas | Export exclui `EXTERNO` |
| Overbooking | Conflito nunca sobrescreve; alerta imediato |
| Fadiga de alerta | 1 alerta por dia por conflito |
| Perda de dados por falha externa | Nunca apagar em caso de falha |

## Critérios de aceite

- [ ] Configurar um canal testa a URL e mostra eventos/noites encontrados.
- [ ] URL `http://` é rejeitada.
- [ ] URL para IP privado ou `169.254.169.254` é rejeitada.
- [ ] A URL fica no SSM e aparece mascarada na interface.
- [ ] A URL nunca aparece em log.
- [ ] `DTEND` exclusivo: evento 20→23 ocupa 20, 21 e 22.
- [ ] Reimportar o mesmo `.ics` não muda nada.
- [ ] Evento removido do `.ics` libera as noites.
- [ ] Conflito com reserva nossa **preserva** a reserva e gera alerta.
- [ ] O mesmo conflito gera **um** alerta por dia.
- [ ] Falha de download **não** apaga nada.
- [ ] `.ics` vazio é tratado como falha.
- [ ] 3 falhas consecutivas geram um alerta.
- [ ] 10 falhas desativam o canal.
- [ ] Sincronização manual responde `202`.
- [ ] Desativar mantém as ocupações; remover apaga.
- [ ] O export não contém eventos `EXTERNO`.
- [ ] Rotacionar o token invalida a URL anterior.
- [ ] A tela exibe o aviso de limitação permanentemente.
- [ ] O orçamento de tempo é respeitado e a execução retoma de onde parou.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Configurar URL válida | `200` com eventos e noites |
| 2 | URL `http://` | `422` |
| 3 | URL `https://127.0.0.1/x.ics` | `422 URL_NAO_PERMITIDA` |
| 4 | URL `https://169.254.169.254/` | `422` |
| 5 | URL que redireciona para IP privado | `422` |
| 6 | `.ics` de 5 MB | `422` |
| 7 | Arquivo que não é `.ics` | `422` |
| 8 | Evento `DTSTART` 20, `DTEND` 23 | Noites 20, 21, 22 |
| 9 | Evento de 1 noite | 1 noite |
| 10 | Reimportar o mesmo arquivo | Nenhuma mudança |
| 11 | Evento removido | Noites liberadas |
| 12 | Evento com datas alteradas | Antigas apagadas, novas gravadas |
| 13 | Evento sobre reserva nossa | Reserva **intacta** + alerta |
| 14 | Mesmo conflito em 4 execuções | 1 alerta |
| 15 | Mesmo conflito no dia seguinte | Novo alerta |
| 16 | Timeout no download | Nada apagado; contador + 1 |
| 17 | `.ics` vazio | Nada apagado; tratado como falha |
| 18 | 3ª falha consecutiva | 1 alerta |
| 19 | 10ª falha consecutiva | Canal desativado + alerta |
| 20 | Sucesso após falhas | Contador zerado |
| 21 | Evento de 90 noites | Ignorado + log |
| 22 | Evento inteiramente no passado | Ignorado |
| 23 | Desativar canal | Ocupações mantidas; sem novas importações |
| 24 | Remover canal | Ocupações `EXTERNO` apagadas |
| 25 | Remover canal com conflito pendente | Ocupações apagadas; reserva nossa intacta |
| 26 | Export após importar | Nenhum evento `EXTERNO` |
| 27 | Rotacionar token | URL antiga retorna `404` |
| 28 | 10 casas × 2 canais | Todos processados ou retomados |
| 29 | Log da sincronização | Sem a URL |
| 30 | Evento com `DATE-TIME` e fuso | Data convertida para `America/Sao_Paulo` |
| 31 | Invariantes após importação | I1 válida |
