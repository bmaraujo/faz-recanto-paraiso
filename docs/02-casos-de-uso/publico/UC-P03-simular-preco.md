# UC-P03 — Simular o preço da estadia

| Campo | Valor |
|---|---|
| Ator | Interessado (visitante anônimo) |
| Pré-condições | Casa `ATIVA` com configuração de preços válida |
| Gatilho | O visitante seleciona datas e/ou altera o número de hóspedes |
| Fase | 1 |
| Relacionados | [Regras de preço](../../01-negocio/02-regras-de-preco.md), [UC-P02](./UC-P02-consultar-disponibilidade.md), [UC-A04](../admin/UC-A04-gerenciar-precos.md) |

## Objetivo de negócio

Eliminar a segunda pergunta mais comum do WhatsApp: **"quanto fica?"**.
Mostrar o preço antes do contato filtra quem não tem orçamento e aumenta a qualidade
das solicitações que chegam.

**Restrição de negócio importante:** como o pagamento acontece fora do site, o valor
é uma **estimativa**. Isso precisa estar visível, não em letras miúdas — se o
proprietário cobrar diferente depois, o hóspede precisa não se sentir enganado.

## Fluxo principal

1. O visitante seleciona check-in e check-out no calendário.
2. O número de hóspedes já tem um valor padrão (`hospedesInclusos` da casa).
3. **Imediatamente**, o componente calcula a cotação localmente com
   `calcularCotacao` de `packages/shared` e exibe o detalhamento — sem esperar o servidor.
4. Em paralelo, chama `POST /api/cotacao` para confirmar e obter o status de
   disponibilidade.
5. Com a resposta, substitui os valores locais pelos do servidor (que é a autoridade).
6. O visitante vê:

```
Casa do Lago · 20 a 23 de novembro de 2026 · 3 noites · 7 hóspedes

Sex 20/11   fim de semana            R$   650,00
Sáb 21/11   fim de semana            R$   650,00
Dom 22/11   diária                   R$   500,00
                                     ───────────
Subtotal das diárias                 R$ 1.800,00
1 hóspede extra × 3 noites           R$   150,00
Taxa de limpeza                      R$   250,00
                                     ═══════════
Valor estimado                       R$ 2.200,00
                             (R$ 733,33 por noite)

ⓘ Valor estimado. O valor final é confirmado pelo proprietário no contato.
   O pagamento é combinado direto com ele — este site não cobra nada.
```

7. Ao mudar hóspedes ou datas, recalcula na hora (passos 3–5).

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Nenhuma data selecionada | Mostra "a partir de R$ X por noite" e o convite para escolher as datas |
| A2 | Só o check-in selecionado | Mostra a diária daquela noite e pede a data de saída |
| A3 | Noites abaixo do mínimo | Mostra a cotação **e** o aviso: "Mínimo de 4 noites no Réveillon". Botão de solicitar desabilitado |
| A4 | Hóspedes acima da capacidade | Campo limitado ao máximo; mensagem com a capacidade da casa |
| A5 | Estadia atravessa temporada | Cada noite mostra sua tarifa e o nome do período |
| A6 | Datas indisponíveis | Cotação exibida **mais** o aviso de indisponibilidade; botão desabilitado |
| A7 | Hóspedes ≤ `hospedesInclusos` | Linha de hóspede extra omitida (não exibir "R$ 0,00") |

> A6 é deliberado: mostrar o preço mesmo com a data ocupada permite ao visitante
> avaliar outra data com a informação que ele queria. Esconder o preço o faria sair.

## Fluxos de exceção

| # | Situação | Comportamento |
|---|---|---|
| E1 | `POST /api/cotacao` falha | **Mantém o valor calculado localmente** com nota discreta: "Não conseguimos confirmar o valor agora." O botão de solicitar continua ativo — o servidor recalcula no envio |
| E2 | Divergência entre o valor local e o do servidor | Exibe o do servidor, sem alarme para o usuário. Em `dev`, loga aviso no console |
| E3 | Erro `422` de regra | Exibe a mensagem específica e desabilita o botão |
| E4 | Casa sem preços configurados | Simulador oculto; só o contato por WhatsApp |
| E5 | Timeout de 8 s | Trata como E1 |

E1 é a aplicação da regra "nunca bloquear o usuário": a falha de uma chamada de
confirmação não pode impedir alguém de pedir a reserva, porque a validação real
acontece de novo na criação.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | O cálculo segue exatamente o algoritmo de [regras de preço](../../01-negocio/02-regras-de-preco.md) |
| RN2 | Precedência da diária: feriado > temporada > fim de semana > base |
| RN3 | Taxa de limpeza: uma vez por estadia |
| RN4 | Hóspede extra: `(hospedes − hospedesInclusos) × valor × noites`, só se positivo |
| RN5 | A cotação pública **nunca** tem desconto (`descontoCentavos = 0`) |
| RN6 | O detalhamento é exibido linha a linha, com o tipo de tarifa |
| RN7 | A soma do detalhamento é **sempre** igual ao total |
| RN8 | O aviso de estimativa é **obrigatório** e visualmente próximo do valor |
| RN9 | O valor por noite exibido é `total / noites`, arredondado só na exibição |
| RN10 | Nenhum valor em centavos aparece ao usuário; sempre `R$ X.XXX,XX` |

## Contrato técnico

```http
POST /api/cotacao
Content-Type: application/json

{ "casaId": "01HQ...", "checkin": "2026-11-20", "checkout": "2026-11-23", "hospedes": 7 }
```

```json
{
  "noites": 3,
  "subtotalDiariasCentavos": 180000,
  "acrescimoHospedesCentavos": 15000,
  "descontoCentavos": 0,
  "taxaLimpezaCentavos": 25000,
  "totalCentavos": 220000,
  "minNoitesExigido": 2,
  "detalhamento": [
    { "tipo": "NOITE", "data": "2026-11-20", "tarifa": "FIM_DE_SEMANA", "rotulo": "Sexta-feira", "valorCentavos": 65000 },
    { "tipo": "NOITE", "data": "2026-11-21", "tarifa": "FIM_DE_SEMANA", "rotulo": "Sábado",      "valorCentavos": 65000 },
    { "tipo": "NOITE", "data": "2026-11-22", "tarifa": "BASE",          "rotulo": "Domingo",     "valorCentavos": 50000 },
    { "tipo": "HOSPEDE_EXTRA", "quantidade": 1, "rotulo": "1 hóspede extra × 3 noites", "valorCentavos": 15000 },
    { "tipo": "TAXA_LIMPEZA", "rotulo": "Taxa de limpeza", "valorCentavos": 25000 }
  ],
  "disponivel": true,
  "noitesIndisponiveis": [],
  "estimativa": true,
  "avisoEstimativa": "Valor estimado. O valor final é confirmado pelo proprietário."
}
```

Erros `422`: `INTERVALO_INVALIDO`, `ANTECEDENCIA_MINIMA`, `FORA_DA_JANELA`,
`MINIMO_NOITES` (com `detalhes.minimoExigido` e `detalhes.periodoNome`),
`MAXIMO_NOITES`, `CAPACIDADE_EXCEDIDA` (com `detalhes.capacidadeMaxima`).

Sem cache.

## Implementação

| Arquivo | O que faz |
|---|---|
| `packages/shared/src/precos.ts` | `calcularCotacao` — **a mesma função** usada no servidor e no navegador |
| `backend/src/domain/precos.ts` | Reexporta de `shared`; nenhuma lógica duplicada |
| `backend/src/handlers/api-publica.ts` | Rota `POST /api/cotacao` |
| `site/src/components/publico/Cotacao.tsx` | Ilha Preact |

### Por que a função é compartilhada

Duas implementações da mesma regra divergem — é questão de tempo. Compartilhar a
função pura garante que a estimativa local e a oficial sejam idênticas por construção.

**O que isso NÃO significa:** que o servidor pode confiar no cliente. O servidor
executa a função com a configuração que **ele** lê do banco, nunca com valores
recebidos na requisição. O cliente executa a mesma função com a configuração que veio
publicada no HTML. Mesma lógica, fontes de dados diferentes e independentes.

### Armadilhas

1. **`Date` e fuso.** Ver [UC-P02](./UC-P02-consultar-disponibilidade.md#armadilhas).
   `diaDaSemana` precisa operar sobre a string, não sobre `new Date(...)`.
2. **Arredondamento na exibição.** Calcule em centavos inteiros e formate só na saída.
   Nunca arredonde no meio da conta.
3. **`Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`** sobre
   `centavos / 100`. Não monte a string à mão — separador de milhar e vírgula decimal
   dão errado.
4. **Debounce.** Mudança de hóspedes dispara `POST /api/cotacao`; aplique debounce de
   400 ms, mas atualize o cálculo **local** sem debounce (é instantâneo e grátis).
5. **Não enviar o valor calculado** ao criar a solicitação. O servidor recalcula; um
   campo de valor na requisição é um convite a manipulação.

## Interface

| Estado | Comportamento |
|---|---|
| Sem datas | "A partir de R$ X por noite" + convite para escolher datas |
| Calculando (local) | Instantâneo; não há estado de carregamento |
| Confirmando (servidor) | Indicador discreto junto ao total; o valor **continua visível** |
| Confirmado | Valores do servidor |
| Erro de regra | Mensagem específica, botão desabilitado, detalhamento ainda visível |
| Indisponível | Aviso + sugestão de datas próximas livres, se houver |
| Falha de rede | Valor local mantido + nota discreta |

> O valor **nunca** é substituído por um spinner. Trocar um número por um indicador de
> carregamento a cada tecla é o padrão que mais irrita em simuladores de preço.

## Segurança e privacidade

- Rota sem dado pessoal na entrada e na saída.
- Nenhum valor monetário vem do cliente; o servidor usa só a configuração do banco.
- Payload limitado a 1 KB.
- Sem cache (a resposta depende da disponibilidade, que muda).
- Como a rota é pública e sem autenticação, protege-se por concorrência reservada
  da Lambda, não por rate limit por IP ([API pública](../../03-tecnico/03-api-publica.md)).

## Critérios de aceite

- [ ] A cotação aparece **imediatamente** ao selecionar as datas, sem esperar a rede.
- [ ] O detalhamento mostra uma linha por noite com o tipo de tarifa.
- [ ] A soma do detalhamento é igual ao total em todos os casos.
- [ ] Precedência feriado > temporada > fim de semana > base.
- [ ] Taxa de limpeza cobrada uma vez.
- [ ] Hóspede extra só quando positivo.
- [ ] Mínimo de noites informa o valor exigido e o nome do período.
- [ ] O aviso de estimativa está visível junto ao valor.
- [ ] Datas ocupadas mostram preço **e** aviso de indisponibilidade.
- [ ] Falha da API mantém o valor local e não bloqueia o botão.
- [ ] Nenhum valor em centavos exibido.
- [ ] O cliente não envia valor na criação da solicitação.

## Casos de teste

Os 17 casos de [regras de preço](../../01-negocio/02-regras-de-preco.md#casos-de-teste-obrigatórios)
valem aqui, e **todos** devem rodar contra a função compartilhada. Além deles:

| # | Cenário | Esperado |
|---|---|---|
| 1 | Cotação local vs. servidor, mesma entrada | Valores idênticos |
| 2 | API fora do ar | Valor local exibido; botão ativo |
| 3 | Datas ocupadas | `disponivel: false` + preço exibido |
| 4 | Mudar hóspedes 5 vezes em 1 s | 1 chamada ao servidor (debounce); 5 atualizações locais |
| 5 | `hospedes = hospedesInclusos` | Sem linha de hóspede extra |
| 6 | Total R$ 2.200,00 | Exibido `R$ 2.200,00` |
| 7 | Estadia de 3 noites, total 220000 | "R$ 733,33 por noite" |
| 8 | Réveillon com mínimo 4, pedido de 3 | Mensagem com `minimoExigido: 4` e nome do período |
| 9 | Payload de 2 KB | Rejeitado |
