# UC-A08 — Recusar ou cancelar uma reserva

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; reserva em `SOLICITADA` (recusar) ou `CONFIRMADA` (cancelar) |
| Gatilho | O admin clica em "Recusar" ou "Cancelar reserva" |
| Fase | 2 |
| Relacionados | [Política de cancelamento](../../01-negocio/04-politica-de-cancelamento.md), [Ciclo de vida](../../01-negocio/03-ciclo-de-vida-da-reserva.md), [UC-A05](./UC-A05-gerenciar-bloqueios.md) |

## Objetivo de negócio

Duas operações diferentes, agrupadas porque têm o mesmo efeito técnico (liberar as
noites) e exigem o mesmo cuidado (comunicar o hóspede):

| | **Recusar** | **Cancelar** |
|---|---|---|
| Estado de origem | `SOLICITADA` | `CONFIRMADA` |
| Significado | "Não vou aceitar este pedido" | "Desfazer um compromisso assumido" |
| Compromisso financeiro | Nenhum | Existe; há política de cancelamento |
| Tom do e-mail | Cordial, convida a outra data | Explicativo, com o que acontece com o valor |
| Gravidade | Baixa | **Alta** |
| Confirmação na tela | Simples | Reforçada, com o cálculo de devolução |

O sistema **não movimenta dinheiro** em nenhum dos dois. Ele libera as datas, registra
a decisão e comunica.

## Fluxo principal — recusar

1. O admin vê a solicitação no painel.
2. Clica em **"Recusar"**.
3. Informa o motivo **interno** (obrigatório) e escolhe se envia o e-mail (padrão: sim).
4. Confirma.
5. O servidor muda para `RECUSADA` e **apaga as ocupações**, em uma transação.
6. Envia `SOLICITACAO_RECUSADA` ao hóspede.
7. As datas voltam a ficar disponíveis.

## Fluxo principal — cancelar

1. O admin abre o detalhe da reserva `CONFIRMADA`.
2. Clica em **"Cancelar reserva"**.
3. A tela mostra:
   - resumo da reserva e dias até o check-in;
   - valor total e o que foi registrado como recebido;
   - **faixa da política** e a **devolução sugerida**;
   - campo de motivo interno (obrigatório);
   - campo opcional "valor que vou devolver" (apenas registro);
   - opção de enviar o e-mail (padrão: sim).
4. Confirma digitando o nome do hóspede ou marcando "Entendo que esta ação é
   definitiva".
5. O servidor muda para `CANCELADA`, apaga as ocupações e registra a devolução
   informada.
6. Envia `RESERVA_CANCELADA` ao hóspede.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Admin não quer enviar e-mail (vai avisar por WhatsApp) | Desmarca; pode reenviar depois |
| A2 | Admin cancela para bloquear o período | Depois de cancelar, a tela oferece "Bloquear estas datas" ([UC-A05](./UC-A05-gerenciar-bloqueios.md)) |
| A3 | Hóspede pediu o cancelamento | Campo `solicitadoPeloHospede` muda o texto do e-mail |
| A4 | Reserva com check-in no passado | Cancelamento permitido, com aviso de que é registro histórico |
| A5 | Admin registra devolução parcial | Gravada em `pagamento.valorDevolvidoCentavos` |
| A6 | Admin recusa várias solicitações do mesmo período | Uma por uma; não há ação em lote (risco alto demais) |

> A2 é o fluxo real: o proprietário cancela porque vai usar a casa. Oferecer o bloqueio
> em seguida evita que ele esqueça e receba outro pedido para as mesmas datas.
>
> A6: não há cancelamento em lote de propósito. Cada cancelamento dispara um e-mail a
> uma pessoa real; um botão que faz isso em lote é um acidente esperando acontecer.

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Recusar reserva `CONFIRMADA` | `409 TRANSICAO_INVALIDA` | "Esta reserva está confirmada. Use 'Cancelar reserva'." |
| E2 | Cancelar reserva `SOLICITADA` | `409` | "Esta solicitação ainda não foi confirmada. Use 'Recusar'." |
| E3 | Reserva já `RECUSADA`/`CANCELADA` | `200` (idempotente) | Tela atualizada; sem erro |
| E4 | Reserva `EXPIRADA` | `409` | "Esta solicitação já expirou." |
| E5 | Reserva `CONCLUIDA` | `409` | "Esta estadia já aconteceu e não pode ser cancelada." |
| E6 | Motivo vazio | `400` | Campo marcado |
| E7 | Uma noite já pertence a outra reserva | — | Cancelamento **conclui**; aquela noite não é apagada |
| E8 | Falha no e-mail | `200` | "Reserva cancelada. O e-mail não pôde ser enviado." + botão de reenviar |
| E9 | Falha de rede | — | Mensagem + Tentar novamente; **sem retentativa automática** |
| E10 | Dois cliques | 1 sucesso, 1 `200` (idempotente) | Um único e-mail |

> **E3 e E10:** aqui a idempotência devolve `200`, diferente de [UC-A07](./UC-A07-confirmar-reserva.md).
> Motivo: o resultado desejado (datas liberadas) **já aconteceu**. Mostrar erro para
> uma ação que teve sucesso confunde. O que a resposta precisa garantir é que o e-mail
> não sai duas vezes — e `emailsEnviados` garante.
>
> **E7 é o mesmo cuidado de [UC-P06](../publico/UC-P06-cancelar-solicitacao.md):**
> filtrar as ocupações próprias antes de montar a transação, senão a reserva fica presa.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Recusar: só de `SOLICITADA` |
| RN2 | Cancelar: só de `CONFIRMADA` |
| RN3 | Ambos apagam as ocupações cujo `refId` é desta reserva |
| RN4 | Ambos são atômicos |
| RN5 | Ambos são idempotentes (`200` se já no estado final) |
| RN6 | O motivo é **obrigatório** e **interno** — nunca vai para o hóspede |
| RN7 | Recusar envia `SOLICITACAO_RECUSADA`; cancelar envia `RESERVA_CANCELADA` |
| RN8 | Falha de e-mail não invalida a operação |
| RN9 | O sistema **não** movimenta dinheiro; a devolução é só registro |
| RN10 | A faixa de devolução é calculada e **sugerida**, nunca imposta |
| RN11 | Registra `canceladaEm`, `canceladoPor`, `motivoInterno`, `solicitadoPeloHospede` e a entrada no `historico` |
| RN12 | Recusar decrementa o contador antiabuso |
| RN13 | Reserva `CONCLUIDA` não pode ser cancelada |
| RN14 | Após a operação, as datas ficam imediatamente disponíveis |

> RN6: o motivo interno existe para o admin se lembrar por que recusou ("hóspede
> queria levar 15 pessoas"). Vazá-lo no e-mail criaria constrangimento. O e-mail usa
> um texto genérico e cordial, do template.

## Contrato técnico

### `POST /api/admin/reservas/{reservaId}/recusar`

```json
{ "motivo": "Período já comprometido com a família", "enviarEmail": true }
```

### `POST /api/admin/reservas/{reservaId}/cancelar`

```json
{
  "motivo": "Hóspede pediu cancelamento por mudança de data",
  "solicitadoPeloHospede": true,
  "valorDevolvidoCentavos": 110000,
  "enviarEmail": true
}
```

| Campo | Validação |
|---|---|
| `motivo` | **obrigatório**, 3–500 chars, sem HTML |
| `solicitadoPeloHospede` | booleano, padrão `false` |
| `valorDevolvidoCentavos` | opcional, inteiro ≥ 0, ≤ `valorRecebidoCentavos` |
| `enviarEmail` | booleano, padrão `true` |

Resposta `200`:

```json
{
  "reserva": { "status": "CANCELADA", "canceladaEm": "..." },
  "noitesLiberadas": 3,
  "noitesNaoLiberadas": [],
  "emailEnviado": true,
  "avisoEmail": null,
  "proximosPassos": ["BLOQUEAR_DATAS"]
}
```

`noitesNaoLiberadas` lista as noites que já pertenciam a outra reserva (E7) — o admin
precisa saber que elas continuam ocupadas.

### Erros

| Código | HTTP | `detalhes` |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | `campos[]` |
| `NAO_ENCONTRADO` | 404 | — |
| `TRANSICAO_INVALIDA` | 409 | `statusAtual`, `acaoCorreta` |
| `VALOR_INVALIDO` | 422 | `valorRecebidoCentavos` |

`detalhes.acaoCorreta` permite à interface oferecer o botão certo em E1 e E2.

## Implementação

### Padrão compartilhado: `liberarNoitesETransicionar`

Recusar, cancelar, expirar ([cron](../../03-tecnico/01-arquitetura.md)) e a desistência
do hóspede ([UC-P06](../publico/UC-P06-cancelar-solicitacao.md)) fazem **a mesma coisa**.
Uma única função, com os estados como parâmetro:

```ts
async function liberarNoitesETransicionar(opcoes: {
  reservaId: string;
  deStatus: StatusReserva[];        // estados de origem aceitos
  paraStatus: StatusReserva;
  campos: Record<string, unknown>;  // canceladaEm, motivoInterno, ...
  decrementarAntiabuso: boolean;
}): Promise<{ noitesLiberadas: number; noitesNaoLiberadas: string[] }>;
```

```
1. GetItem da reserva                              → 404
2. se status === paraStatus                        → retorna (idempotente)
3. se status ∉ deStatus                            → 409
4. Query das ocupações de reserva.noites
5. minhas = ocupações com refId === reservaId
6. TransactWriteItems:
     Update reserva (ConditionExpression: status IN deStatus)
     Delete de cada ocupação em `minhas`
       (ConditionExpression: refId = :reservaId)
     Update decremento do antiabuso, se pedido
7. em TransactionCanceledException: reler e repetir, até 3 vezes
8. após 3 falhas: log de erro + ALERTA_ADMIN + 409
```

Quatro casos de uso cobertos por uma função testada em um só lugar — é onde o DRY
realmente paga, porque é a lógica mais delicada do sistema.

### Cálculo da devolução sugerida

Função pura `faixaCancelamento(politica, checkin, hoje)` de
[política de cancelamento](../../01-negocio/04-politica-de-cancelamento.md).
Calculada no **servidor** e devolvida no detalhe da reserva
([UC-A06](./UC-A06-ver-agenda.md)) — a interface não recalcula.

### Armadilhas

1. **Passo 5 obrigatório** (E7). Sem filtrar, uma noite de outro dono derruba a
   transação e prende a reserva.
2. **Idempotência antes da validação de transição** (passos 2 e 3 nessa ordem).
3. **Decrementar o antiabuso só ao recusar** (RN12) — ao cancelar, a reserva já estava
   confirmada e o contador já foi decrementado na confirmação. Decrementar de novo
   produziria contador negativo.
4. **Motivo nunca no e-mail.** O template de recusa/cancelamento **não tem** a
   variável `motivoInterno` na allowlist — o impedimento é estrutural, não por
   disciplina. Ver [06 — E-mails](../../03-tecnico/06-emails-e-templates.md).
5. **`valorDevolvidoCentavos` é registro**, não instrução de pagamento. A tela precisa
   dizer isso.
6. **Não retentar automaticamente após timeout de rede** (E9).

## Interface

### Recusar

```
┌──────────────────────────────────────────────────┐
│  Recusar solicitação                              │
│                                                    │
│  Maria Silva · Casa do Lago · 20 a 23/11/2026      │
│  As datas serão liberadas imediatamente.           │
│                                                    │
│  Motivo (uso interno) *                            │
│  [ Período comprometido com a família ________ ]   │
│  ⓘ Este motivo não é enviado ao hóspede.          │
│                                                    │
│  [x] Enviar e-mail avisando o hóspede              │
│                                                    │
│            [ Voltar ]  [ Recusar ]                 │
└──────────────────────────────────────────────────┘
```

### Cancelar

```
┌─────────────────────────────────────────────────────┐
│  ⚠ Cancelar reserva confirmada                       │
│                                                       │
│  Maria Silva · (11) 99999-9999                        │
│  Casa do Lago · 20 a 23/11/2026                       │
│  Check-in em 41 dias                                  │
│                                                       │
│  Valor da reserva           R$ 2.200,00               │
│  Registrado como recebido   R$ 1.100,00               │
│                                                       │
│  Política: mais de 30 dias antes → devolver 100%      │
│  Devolução sugerida         R$ 1.100,00               │
│  ⓘ O site não devolve nada automaticamente. Combine  │
│    a devolução direto com o hóspede.                  │
│                                                       │
│  Motivo (uso interno) *                               │
│  [ ______________________________________ ]           │
│  [ ] O cancelamento foi pedido pelo hóspede           │
│                                                       │
│  Valor que você vai devolver (apenas registro)        │
│  R$ [ 1.100,00 ]                                      │
│                                                       │
│  [x] Enviar e-mail avisando o hóspede                 │
│                                                       │
│  [ ] Entendo que esta ação é definitiva               │
│                                                       │
│          [ Voltar ]  [ Cancelar reserva ]             │
└─────────────────────────────────────────────────────┘
```

| Padrão | Regra |
|---|---|
| Botão de confirmação | Desabilitado até marcar "Entendo que é definitiva" |
| Foco inicial | "Voltar" |
| Nome e datas no diálogo | Sempre — nunca um "Tem certeza?" genérico |
| Devolução | Sugerida e editável; a tela diz que é só registro |
| Após sucesso | "Reserva cancelada" + atalho "Bloquear estas datas" |
| `noitesNaoLiberadas` | Exibidas com explicação, se houver |
| Mobile | Funciona; é uma ação que o admin faz do celular |

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Autorização | JWT com grupo `admin` |
| Integridade | Escrita condicional em status e em `refId` por noite |
| `motivoInterno` | Nunca em e-mail nem em endpoint público; **nem na allowlist do template** |
| Ação destrutiva | Confirmação explícita, com os dados à vista |
| Auditoria | `historico` com quem, quando e por quê |
| Log | `reservaId`, estados, `sub` do admin. **Nunca** nome, contato ou valores |
| Lote | Inexistente, por decisão de segurança |

## Critérios de aceite

- [ ] Recusar `SOLICITADA` libera as noites e envia `SOLICITACAO_RECUSADA`.
- [ ] Cancelar `CONFIRMADA` libera as noites e envia `RESERVA_CANCELADA`.
- [ ] Recusar `CONFIRMADA` retorna `409` com `acaoCorreta: "CANCELAR"`.
- [ ] Cancelar `SOLICITADA` retorna `409` com `acaoCorreta: "RECUSAR"`.
- [ ] Cancelar `CONCLUIDA` retorna `409`.
- [ ] Repetir a operação retorna `200` e **não** envia segundo e-mail.
- [ ] Motivo obrigatório.
- [ ] O motivo **não** aparece em nenhum e-mail.
- [ ] Noite de outra reserva não é apagada e aparece em `noitesNaoLiberadas`.
- [ ] A faixa e a devolução sugerida são calculadas no servidor.
- [ ] `valorDevolvidoCentavos` acima do recebido retorna `422`.
- [ ] Recusar decrementa o antiabuso; cancelar **não**.
- [ ] Falha de e-mail mantém a operação e informa.
- [ ] A tela de cancelamento exige confirmação explícita.
- [ ] As datas ficam disponíveis imediatamente após a operação.
- [ ] A tela oferece bloquear as datas depois de cancelar.
- [ ] Nenhum dado pessoal em log.
- [ ] Não existe ação em lote.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Recusar `SOLICITADA` | `200`; 3 ocupações apagadas |
| 2 | Cancelar `CONFIRMADA` | `200`; 3 ocupações apagadas |
| 3 | Recusar `CONFIRMADA` | `409` com `acaoCorreta: CANCELAR` |
| 4 | Cancelar `SOLICITADA` | `409` com `acaoCorreta: RECUSAR` |
| 5 | Cancelar `CONCLUIDA` | `409` |
| 6 | Recusar `EXPIRADA` | `409` |
| 7 | Recusar duas vezes | `200` nas duas; 1 e-mail |
| 8 | Dois cliques simultâneos | 1 e-mail |
| 9 | Motivo vazio | `400` |
| 10 | Motivo com HTML | `400` |
| 11 | E-mail enviado | **Não** contém o motivo interno |
| 12 | Uma noite virou de outra reserva | Cancelada; `noitesNaoLiberadas` com aquela data |
| 13 | Cancelar a 45 dias | Devolução sugerida 100% |
| 14 | Cancelar a 20 dias | 50% |
| 15 | Cancelar a 5 dias | 0% |
| 16 | `valorDevolvido` acima do recebido | `422` |
| 17 | Recusar: contador antiabuso | Decrementado |
| 18 | Cancelar: contador antiabuso | **Não** alterado |
| 19 | SES falha | `200`, `emailEnviado: false`, alerta |
| 20 | `enviarEmail: false` | Nenhum e-mail |
| 21 | Disponibilidade pública após cancelar | Noites livres |
| 22 | `.ics` após cancelar | Reserva ausente |
| 23 | `historico` | Entrada com quem, quando e motivo |
| 24 | Log | Sem nome, contato ou valores |
| 25 | Invariantes após as operações | I3 válida |
| 26 | 3 falhas de transação | `409` + `ALERTA_ADMIN` |
