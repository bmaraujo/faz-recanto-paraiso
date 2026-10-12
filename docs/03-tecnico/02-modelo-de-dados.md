# 02 — Modelo de dados (DynamoDB, tabela única)

Tabela: `recanto-paraiso-<stage>` (`dev` / `prod`).

| Elemento | Valor |
|---|---|
| Chave de partição | `PK` (String) |
| Chave de ordenação | `SK` (String) |
| Modo de cobrança | On-demand (`PAY_PER_REQUEST`) |
| TTL | atributo `ttl` (epoch em segundos) |
| GSI1 | `GSI1PK` (String) / `GSI1SK` (String), projeção `ALL` |
| PITR | Ligado em `prod` (custo ~US$ 0,20/GB/mês; a base é de poucos MB) |
| Deletion protection | Ligado em `prod` |

> **O TTL do DynamoDB não é confiável para regra de negócio.** A exclusão pode levar
> até ~48 h. Toda decisão de disponibilidade compara `expiraEm` com o horário atual.
> O `ttl` existe só para faxina de itens antigos.

## Mapa de itens

| Entidade | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Casa (dados) | `CASA#<casaId>` | `META` | `CASAS` | `<ordem>#<casaId>` |
| Casa (preços) | `CASA#<casaId>` | `PRECOS` | — | — |
| Casa (índice por slug) | `SLUG#<slug>` | `META` | — | — |
| Ocupação de noite | `OCUPACAO#<casaId>` | `NOITE#<YYYY-MM-DD>` | — | — |
| Reserva | `RESERVA#<reservaId>` | `META` | `RESERVA` | `<checkin>#<reservaId>` |
| Bloqueio | `BLOQUEIO#<bloqueioId>` | `META` | `BLOQUEIO#<casaId>` | `<inicio>#<bloqueioId>` |
| Template de e-mail | `TEMPLATE#<codigo>` | `META` | — | — |
| Versão de template | `TEMPLATE#<codigo>` | `V#<ISO datetime>` | — | — |
| Configuração geral | `CONFIG` | `GERAL` | — | — |
| Antiabuso por e-mail | `ANTIABUSO#<hashEmail>` | `META` | — | — |
| Sincronização iCal | `ICAL#<casaId>#<canal>` | `META` | — | — |
| Publicação | `PUBLICACAO` | `ATUAL` | — | — |

Os identificadores (`casaId`, `reservaId`, `bloqueioId`) são **ULID** — ordenáveis por
tempo de criação e seguros para gerar em paralelo.

---

## 1. Casa

```
PK = CASA#<casaId>
SK = META
GSI1PK = CASAS
GSI1SK = <ordem padded 4>#<casaId>     ex.: "0010#01HQ..."
```

| Atributo | Tipo | Observações |
|---|---|---|
| `casaId` | string (ULID) | |
| `slug` | string | `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–60 chars, **único**, imutável após publicar |
| `nome` | string | 3–80 chars |
| `status` | `RASCUNHO \| ATIVA \| INATIVA` | só `ATIVA` aparece no site público |
| `ordem` | number | ordem de exibição na vitrine |
| `resumo` | string | até 200 chars, usado nos cards e na meta description |
| `descricao` | string (Markdown) | até 10.000 chars, sanitizado na renderização |
| `capacidadeMaxima` | number | 1–50 |
| `quartos` | number | |
| `banheiros` | number | |
| `camas` | array | `[{ tipo: "CASAL"\|"SOLTEIRO"\|"BELICHE"\|"REDE", quantidade, ambiente }]` |
| `comodidades` | string[] | códigos de uma lista fechada (ver abaixo) |
| `regras` | string (Markdown) | regras específicas desta casa |
| `localizacao` | object | `{ enderecoPublico, lat, lng, mapaEmbedUrl, comoChegar, distancias[] }` |
| `fotos` | array | ver abaixo. Máx. **40** |
| `tokenIcal` | string | 32 bytes base64url, para o export `.ics` desta casa |
| `destaque` | boolean | aparece em destaque na home |
| `publicacaoPendente` | boolean | `true` quando há edição não publicada |
| `criadoEm`, `atualizadoEm` | ISO datetime | |

### Fotos (embutidas no item da casa)

```json
{
  "fotoId": "01HQ...",
  "chave": "midia/casas/01HQ.../01HQ-fachada-a3f9c1.webp",
  "largura": 1600,
  "altura": 1067,
  "bytes": 184320,
  "legenda": "Fachada vista do lago",
  "textoAlternativo": "Casa de madeira com varanda, vista do lago ao fundo",
  "ordem": 10,
  "principal": true,
  "enviadaEm": "2026-10-11T18:04:00Z"
}
```

**Por que embutidas em vez de itens separados:**
um `GetItem` traz a casa inteira com a galeria pronta, há um único administrador
(sem concorrência de edição), e 40 fotos × ~300 bytes ≈ 12 KB — muito abaixo do limite
de 400 KB por item.

**Consequência aceita:** reordenar ou renomear uma foto reescreve o item inteiro.
Com um admin e poucas fotos isso é irrelevante. Se o limite de 40 virar um problema,
a migração para itens `CASA#<id> / FOTO#<ordem>#<fotoId>` é direta.

**`principal` é exclusiva:** ao marcar uma foto como principal, o handler desmarca as
demais na mesma escrita. Invariante: no máximo uma foto com `principal: true`.

### Comodidades

Lista fechada de códigos, para permitir ícone e tradução consistentes:
`WIFI`, `PISCINA`, `CHURRASQUEIRA`, `LAREIRA`, `AR_CONDICIONADO`, `COZINHA_COMPLETA`,
`MAQUINA_LAVAR`, `TV`, `ESTACIONAMENTO`, `ACEITA_PET`, `LAGO`, `TRILHA`, `CAVALOS`,
`FOGAO_LENHA`, `VARANDA`, `ROUPA_DE_CAMA`, `ACESSIVEL`. Extensível — a lista fica em
`packages/shared/src/comodidades.ts`, não no banco.

### Índice por slug

```
PK = SLUG#<slug>    SK = META
atributos: casaId
```

Item auxiliar que resolve `slug → casaId` com um `GetItem`, sem Scan.
Criado na mesma transação da casa, com condição `attribute_not_exists(PK)` —
é o que **garante a unicidade do slug**.

Ao mudar o slug de uma casa em `RASCUNHO`: transação que cria o novo item e apaga o
antigo. Casa já publicada **não** troca de slug (quebraria links e SEO); se for
realmente necessário, cria-se o novo e mantém-se o antigo apontando para a mesma
`casaId`, servindo de redirecionamento.

---

## 2. Configuração de preços da casa

```
PK = CASA#<casaId>
SK = PRECOS
```

Atributos conforme [regras de preço](../01-negocio/02-regras-de-preco.md).
Fica em item separado do `META` porque muda com frequência diferente e porque
`Query PK = CASA#<casaId>` traz os dois numa única chamada quando necessário.

---

## 3. Ocupação de noite — o item mais importante do banco

```
PK = OCUPACAO#<casaId>
SK = NOITE#<YYYY-MM-DD>
```

| Atributo | Tipo | Observações |
|---|---|---|
| `casaId` | string | |
| `data` | string | `YYYY-MM-DD` |
| `tipo` | `RESERVA \| BLOQUEIO \| EXTERNO` | |
| `refId` | string | `reservaId`, `bloqueioId` ou `<canal>:<uid do VEVENT>` |
| `pendente` | boolean | `true` só enquanto a reserva está `SOLICITADA` |
| `expiraEm` | ISO datetime | presente só se `pendente` |
| `ttl` | number | presente só se `pendente`; `expiraEm + 7 dias` |

**Por que `PK = OCUPACAO#<casaId>` e `SK = NOITE#<data>`:**
permite ler um intervalo de datas de uma casa com uma única `Query` e
`KeyConditionExpression: PK = :pk AND SK BETWEEN :de AND :ate`. É a consulta mais
frequente do sistema (o calendário). Treze meses ≈ 400 itens — uma `Query` paginada,
alguns KB, custo desprezível.

A alternativa `PK = CASA#<id>#NOITE#<data>` exigiria um `GetItem` por dia ou um Scan.
Descartada.

**Partição quente?** Não nesse volume: poucas reservas/mês, calendário cacheado 60 s
no CloudFront. O limite do DynamoDB (3.000 RCU/s por partição) está ordens de
magnitude acima da demanda.

### Condição de escrita (garantia contra dupla reserva)

```
attribute_not_exists(PK)
OR (pendente = :true AND expiraEm < :agora)
```

Em português: *só posso ocupar esta noite se ela está livre, ou se está ocupada por
uma pendência já vencida.* Ver
[05 — Concorrência](./05-concorrencia-e-idempotencia.md).

---

## 4. Reserva

```
PK = RESERVA#<reservaId>
SK = META
GSI1PK = RESERVA
GSI1SK = <checkin>#<reservaId>          ex.: "2026-11-20#01HQ..."
```

| Atributo | Tipo | Observações |
|---|---|---|
| `reservaId` | string (ULID) | |
| `casaId`, `casaNome` | string | `casaNome` denormalizado para listar sem N+1 |
| `status` | enum | ver [ciclo de vida](../01-negocio/03-ciclo-de-vida-da-reserva.md) |
| `origem` | `SITE \| MANUAL` | |
| `checkin`, `checkout` | string | `YYYY-MM-DD` |
| `noites` | string[] | datas ocupadas, `[checkin, checkout)` |
| `hospedes` | number | |
| `hospede` | object | `{ nome, email, telefone }` |
| `observacaoHospede` | string | até 1.000 chars, texto livre do formulário |
| `valores` | object | `{ subtotalDiariasCentavos, acrescimoHospedesCentavos, descontoCentavos, taxaLimpezaCentavos, totalCentavos, detalhamento[] }` |
| `pagamento` | object | `{ situacao, valorRecebidoCentavos, metodo, observacao, registradoEm }` |
| `tokenAcesso` | string | 32 bytes base64url |
| `expiraEm` | ISO datetime | só enquanto `SOLICITADA` |
| `emailsEnviados` | string[] | idempotência de envio automático |
| `historicoEnvios` | array | `[{ codigo, enviadoEm, manual: boolean }]` |
| `historico` | array | `[{ de, para, em, por, motivo }]` — trilha de transições |
| `motivoInterno` | string | recusa/cancelamento; **nunca** vai para o hóspede |
| `confirmadaEm`, `canceladaEm` | ISO datetime | |
| `criadoEm`, `atualizadoEm` | ISO datetime | |
| `ttl` | number | só enquanto `SOLICITADA`; `expiraEm + 90 dias` |

### Por que um GSI só, e como consultar

`GSI1PK = "RESERVA"` (valor literal, partição única) com `GSI1SK = <checkin>#<id>`
dá uma consulta por **intervalo de check-in** ordenada, que é como o admin pensa:
"o que tem em novembro?".

| Necessidade | Consulta |
|---|---|
| Reservas de um período | `Query GSI1 PK=RESERVA, SK BETWEEN "2026-11-01" AND "2026-11-30#~"` |
| Solicitações pendentes | mesma consulta de hoje em diante + `FilterExpression status = SOLICITADA` |
| Reservas de uma casa | mesma consulta + `FilterExpression casaId = :id` |
| Reserva específica | `GetItem PK=RESERVA#<id>, SK=META` |

**Limitação aceita:** partição única no GSI1 e filtro em memória. Com poucas centenas
de reservas por ano isso custa frações de centavo e é mais simples que dois ou três
GSIs. **Gatilho de revisão:** acima de ~5.000 reservas/ano ou se o volume de leitura
do GSI1 passar de 1 RCU/s sustentado, adicionar `GSI2PK = STATUS#<status>`.

> O `#~` no limite superior garante que todos os ULIDs daquela data entrem na faixa
> (`~` é maior que qualquer caractere do alfabeto Crockford base32 do ULID).

---

## 5. Bloqueio

```
PK = BLOQUEIO#<bloqueioId>
SK = META
GSI1PK = BLOQUEIO#<casaId>
GSI1SK = <inicio>#<bloqueioId>
```

Atributos: `casaId`, `inicio`, `fim` (inclusivos, referem-se a **noites**), `motivo`,
`noites[]`, `criadoEm`, `criadoPor`.

Os itens `OCUPACAO#` correspondentes são gravados na mesma transação, com `tipo = BLOQUEIO`.

> Atenção à diferença de convenção: bloqueio usa `inicio`/`fim` **inclusivos**
> (o admin pensa "de 10 a 15 está bloqueado"), enquanto reserva usa
> `checkin`/`checkout` com check-out **exclusivo**. A conversão para `noites[]` é a
> única coisa que importa, e fica em `domain/datas.ts` com teste para as duas
> convenções. Essa diferença já causou bug em todo sistema de hospedagem que existe.

---

## 6. Template de e-mail

```
PK = TEMPLATE#<codigo>     SK = META          (versão vigente)
PK = TEMPLATE#<codigo>     SK = V#<ISO>       (histórico, últimas 10)
```

| Atributo | Tipo | Observações |
|---|---|---|
| `codigo` | string | da lista fechada em [05 — comunicação](../01-negocio/05-comunicacao-e-emails.md) |
| `assunto` | string | até 150 chars, aceita `{{variavel}}` |
| `corpoMarkdown` | string | até 20.000 chars, aceita `{{variavel}}` |
| `ativo` | boolean | só e-mails não essenciais podem ser `false` |
| `versao` | number | incrementa a cada salvamento |
| `atualizadoEm`, `atualizadoPor` | | |

Os textos padrão vivem em `backend/src/templates/` **no código**, e são usados como
fallback. O banco guarda apenas o que o admin alterou. Ver
[ADR-007](../adr/ADR-007-templates-email-no-banco.md) e
[06 — E-mails](./06-emails-e-templates.md).

---

## 7. Configuração geral

```
PK = CONFIG    SK = GERAL
```

```json
{
  "nomeFazenda": "Recanto Paraíso",
  "whatsapp": "+5500000000000",
  "emailAdmin": "proprietario@exemplo.com.br",
  "emailRemetente": "reservas@exemplo.com.br",
  "emailResponder": "proprietario@exemplo.com.br",
  "prazoSolicitacaoHoras": 48,
  "antecedenciaMinimaDias": 1,
  "janelaReservaMeses": 12,
  "horarioCheckin": "14:00",
  "horarioCheckout": "12:00",
  "maxSolicitacoesPendentesPorEmail": 3,
  "faixasCancelamento": [
    { "diasMinimos": 30, "percentualDevolucao": 100 },
    { "diasMinimos": 15, "percentualDevolucao": 50 },
    { "diasMinimos": 0,  "percentualDevolucao": 0 }
  ],
  "devolveTaxaLimpeza": true,
  "textoCancelamento": "...markdown...",
  "textoPrivacidade": "...markdown...",
  "textoTermos": "...markdown...",
  "faq": [{ "pergunta": "...", "resposta": "..." }]
}
```

Campos expostos publicamente em `GET /api/config-publica`: `nomeFazenda`, `whatsapp`,
`horarioCheckin`, `horarioCheckout`, `antecedenciaMinimaDias`, `janelaReservaMeses`,
`faixasCancelamento` e os textos legais. **Nunca** `emailAdmin` nem
`maxSolicitacoesPendentesPorEmail`.

---

## 8. Antiabuso por e-mail

```
PK = ANTIABUSO#<sha256(email normalizado)>
SK = META
atributos: pendentes (number), ultimaEm (ISO), ttl (epoch, 7 dias)
```

Guarda o **hash** do e-mail, não o e-mail: cumpre a finalidade (contar) sem criar mais
um lugar com dado pessoal. Normalização antes do hash: `trim` + minúsculas.

`pendentes` é incrementado na transação de criação da solicitação com
`ConditionExpression: attribute_not_exists(pendentes) OR pendentes < :max`,
e decrementado quando a reserva sai de `SOLICITADA`.

> O decremento pode se perder se um processo morrer no meio. Por isso há o `ttl` de
> 7 dias e um conserto no `cron-diario`: recontar `pendentes` a partir das reservas
> reais quando o valor estiver acima do máximo. Contador aproximado é aceitável aqui —
> é antiabuso, não contabilidade.

---

## 9. Sincronização iCal

```
PK = ICAL#<casaId>#<canal>     SK = META
atributos:
  canal: AIRBNB | BOOKING | OUTRO
  nomeParametroSsm: string      (a URL fica no SSM, não aqui)
  ultimaSyncEm, ultimoSucessoEm: ISO datetime
  falhasConsecutivas: number
  uidsAtivos: string[]          (UIDs dos VEVENTs atualmente importados)
  ativo: boolean
```

A URL do iCal vai para o SSM porque funciona como credencial: quem a tem lê o
calendário. Aqui fica só o **nome do parâmetro**.

---

## 10. Publicação

```
PK = PUBLICACAO    SK = ATUAL
atributos: status (PENDENTE|EM_ANDAMENTO|CONCLUIDA|FALHOU), iniciadaEm,
           concluidaEm, erro?, publicadaPor, casasPublicadas: number
```

Ver [09 — Publicação de conteúdo](./09-publicacao-de-conteudo.md).

---

## Padrões de acesso (resumo)

| # | Necessidade | Operação | Custo |
|---|---|---|---|
| 1 | Listar casas ativas | `Query GSI1 PK=CASAS` | 1 query |
| 2 | Casa por slug | `GetItem SLUG#<slug>` → `GetItem CASA#<id>` | 2 gets |
| 3 | Casa + preços | `Query PK=CASA#<id>` | 1 query |
| 4 | Disponibilidade de um período | `Query PK=OCUPACAO#<casaId>, SK BETWEEN` | 1 query |
| 5 | Criar solicitação | `TransactWriteItems` (1 + N noites + 1) | 1 transação |
| 6 | Reserva por id | `GetItem RESERVA#<id>` | 1 get |
| 7 | Reservas de um período | `Query GSI1 PK=RESERVA, SK BETWEEN` | 1 query |
| 8 | Confirmar reserva | `TransactWriteItems` (1 + N noites) | 1 transação |
| 9 | Liberar noites | `TransactWriteItems` (1 + N deletes) | 1 transação |
| 10 | Template vigente | `GetItem TEMPLATE#<codigo>` | 1 get |
| 11 | Configuração geral | `GetItem CONFIG/GERAL` + cache em memória | 1 get |
| 12 | Relatório do mês | consulta #7 + #4 por casa | poucas queries |

**Nenhum padrão de acesso exige `Scan`.** Se um requisito novo parecer exigir Scan,
é sinal de que falta um item de índice — pare e reveja o modelo.

## Estimativa de tamanho

| Item | Tamanho típico | Quantidade/ano | Total/ano |
|---|---|---|---|
| Casa | ~15 KB (com 40 fotos) | 1–10 | 150 KB |
| Ocupação de noite | ~200 B | ~1.500 | 300 KB |
| Reserva | ~4 KB | ~100 | 400 KB |
| Resto | — | — | < 100 KB |

Menos de **1 MB/ano**. Cabe folgadamente no free tier de 25 GB do DynamoDB, e o PITR
custa centavos.
