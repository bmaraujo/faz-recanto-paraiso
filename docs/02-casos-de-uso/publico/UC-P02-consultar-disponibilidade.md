# UC-P02 — Consultar disponibilidade

| Campo | Valor |
|---|---|
| Ator | Interessado (visitante anônimo) |
| Pré-condições | Casa `ATIVA` publicada |
| Gatilho | A página da casa carrega o calendário, ou o visitante navega entre meses |
| Fase | 1 |
| Relacionados | [Regras de disponibilidade](../../01-negocio/01-regras-de-disponibilidade.md), [UC-P03](./UC-P03-simular-preco.md), [API pública](../../03-tecnico/03-api-publica.md) |

## Objetivo de negócio

Responder à pergunta que hoje consome a maior parte das mensagens no WhatsApp:
**"a data X está livre?"**. Cada visitante que descobre isso sozinho é uma conversa
que o proprietário não precisa ter, e um visitante que não desiste esperando resposta.

## Fluxo principal

1. A página da casa carrega; o calendário hidrata quando entra na tela.
2. Busca `GET /api/casas/{casaId}/disponibilidade?de=<hoje>&ate=<hoje + 3 meses>`.
3. Enquanto carrega, os dias aparecem **desabilitados** com indicador de carregamento.
4. Com a resposta, o calendário marca:
   - noites ocupadas: indisponíveis, visualmente distintas (não só cinza-claro);
   - datas fora da janela permitida: desabilitadas;
   - datas livres: selecionáveis.
5. O visitante toca numa data livre → vira check-in provisório.
6. O visitante toca numa segunda data → vira check-out.
7. O intervalo é destacado e a cotação é calculada ([UC-P03](./UC-P03-simular-preco.md)).
8. Ao navegar para um mês ainda não carregado, busca os 3 meses seguintes e acumula.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Segundo toque é **antes** do check-in | Reinicia a seleção com essa data como novo check-in |
| A2 | Segundo toque é igual ao check-in | Ignorado (estadia de zero noite não existe) |
| A3 | Intervalo contém noite ocupada | Seleção recusada, com aviso: "Há datas ocupadas nesse período" |
| A4 | Intervalo abaixo do mínimo de noites | Seleção aceita; a cotação informa o mínimo exigido |
| A5 | Visitante chega com `?checkin=&checkout=` na URL | Pré-seleciona (vem do link de WhatsApp ou de um e-mail) |
| A6 | Visitante navega para trás, antes de hoje | Botão de mês anterior desabilitado |

## Fluxos de exceção

| # | Situação | Comportamento |
|---|---|---|
| E1 | A API falha | Mensagem "Não conseguimos carregar as datas disponíveis" + botão **Tentar novamente**. Os dias permanecem **desabilitados** |
| E2 | A API demora mais de 10 s | Timeout; mesmo tratamento de E1 |
| E3 | `casaId` inexistente | `404`; o calendário mostra erro genérico |
| E4 | Intervalo acima de 13 meses | `422 INTERVALO_MUITO_LONGO`; não deve acontecer pela UI |
| E5 | Data ocupada entre o carregamento e a solicitação | A solicitação recusa com `409` e o calendário se atualiza ([UC-P04](./UC-P04-solicitar-reserva.md)) |

> E1 e E2 têm a regra mais importante deste UC: **em caso de falha, os dias ficam
> desabilitados, nunca habilitados**. Mostrar tudo disponível por não saber levaria
> o visitante a selecionar uma data ocupada e tomar um erro no envio — pior
> experiência e um pedido perdido.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Noite ocupada = `RESERVA` confirmada, `RESERVA` pendente **não vencida**, `BLOQUEIO` ou `EXTERNO` |
| RN2 | Pendência **vencida** é noite livre |
| RN3 | O tipo da ocupação **não** é revelado: ocupado é ocupado |
| RN4 | A resposta não contém nenhum dado pessoal |
| RN5 | Datas selecionáveis: de `hoje + antecedenciaMinimaDias` até `hoje + janelaReservaMeses` |
| RN6 | O dia do check-out **não** precisa estar livre — só as noites `[checkin, checkout)` |
| RN7 | Intervalo máximo por consulta: 13 meses |
| RN8 | Cache de 60 s no CloudFront |

RN6 é a regra que mais confunde: uma reserva que **termina** no dia 20 não impede
outra que **começa** no dia 20. O calendário precisa refletir isso — marcar o dia 20
como totalmente ocupado perderia reservas.

### Como representar o dia de transição na interface

```
Reserva existente: check-in 17, check-out 20  →  noites 17, 18, 19 ocupadas

dia 17  ocupado
dia 18  ocupado
dia 19  ocupado
dia 20  LIVRE para check-in   (mas não para ser uma noite)
```

Visualmente: o dia 20 é selecionável. Se o visitante escolher o dia 19 como check-in,
a seleção é recusada (o dia 19 é noite ocupada). A representação recomendada é a
diagonal partida (meia célula ocupada) usada por Airbnb e Booking — já é a convenção
que o usuário conhece.

## Contrato técnico

```http
GET /api/casas/{casaId}/disponibilidade?de=2026-11-01&ate=2027-01-31
```

```json
{
  "casaId": "01HQ...",
  "de": "2026-11-01",
  "ate": "2027-01-31",
  "noitesOcupadas": ["2026-11-20", "2026-11-21", "2026-11-22"],
  "geradoEm": "2026-10-11T18:04:00-03:00"
}
```

| Erro | HTTP |
|---|---|
| `ENTRADA_INVALIDA` | 400 |
| `NAO_ENCONTRADO` | 404 |
| `INTERVALO_MUITO_LONGO` | 422 |

Cabeçalhos: `Cache-Control: public, max-age=60`.

## Implementação

### Backend

```
1. valida `de` e `ate` (zod): formato, ordem, intervalo <= 13 meses
2. resolve a casa (deve estar ATIVA)
3. Query PK = OCUPACAO#<casaId>, SK BETWEEN NOITE#<de> AND NOITE#<ate>
   paginando se necessário (ate 400 itens)
4. filtra em memória: descarta `pendente = true AND expiraEm < agora`
5. projeta apenas `data`
6. responde ordenado
```

A `ProjectionExpression` na `Query` deve pedir **só** `SK`, `pendente` e `expiraEm`.
Trazer o item inteiro desperdiça RCU e arrisca vazar `refId` por descuido numa
refatoração futura.

### Frontend

| Arquivo | O que faz |
|---|---|
| `site/src/components/publico/Calendario.tsx` | Ilha Preact, `client:visible` |
| `site/src/lib/api.ts` | Cliente com timeout de 10 s e `AbortController` |

Estado do componente:

```ts
type Estado =
  | { fase: "carregando" }
  | { fase: "erro"; mensagem: string }
  | { fase: "pronto"; ocupadas: Set<string>; carregados: string[] /* meses */ };
```

### Armadilhas

1. **Fuso horário.** `new Date("2026-11-20")` é interpretado como **UTC** e, em
   `America/Sao_Paulo`, pode virar 19/11 às 21h. **Nunca** construir `Date` a partir
   da string de data para comparar dias. Trabalhe com strings `YYYY-MM-DD` e
   compare lexicograficamente, ou use as funções de `packages/shared`.
2. **`Set` para as ocupadas.** Lista com `includes` por célula é O(n·m); um `Set` é O(1)
   e a diferença aparece com 13 meses carregados.
3. **Acumular, não substituir.** Ao buscar novos meses, faça união com as já carregadas.
4. **Dia de transição.** Ver RN6. É o bug mais provável deste UC.
5. **Cache de 60 s.** Não tente contornar com cache-buster: o cache é o que mantém o
   custo baixo. 60 s de defasagem é aceitável porque a criação valida de novo.

## Interface

| Estado | Comportamento |
|---|---|
| Carregando | Dias desabilitados + indicador. Nunca habilitados |
| Pronto | Ocupadas com padrão visual distinto (não apenas cor — acessibilidade) |
| Erro | Mensagem + "Tentar novamente". Dias permanecem desabilitados |
| Seleção parcial | Check-in destacado; instrução "Escolha a data de saída" |
| Seleção completa | Intervalo destacado, com o número de noites |
| Intervalo inválido | Aviso inline, seleção reiniciada |

Acessibilidade: cada célula com `aria-label` em pt-BR
(`"20 de novembro de 2026, indisponível"`), navegação por setas, `Enter` seleciona,
`Esc` limpa, e `aria-live="polite"` anunciando a seleção atual.

> Distinguir ocupado de livre **só por cor** reprova no Lighthouse de acessibilidade
> e é critério de aceite. Use padrão/hachura ou tachado, além da cor.

## Segurança e privacidade

- Resposta com **apenas datas**. Nenhum `refId`, `tipo`, nome ou valor.
- Rota pública e cacheável — portanto não pode conter nada sensível por construção.
- `ProjectionExpression` restrita (defesa contra vazamento por refatoração).
- Casa `RASCUNHO`/`INATIVA` responde `404`.

## Critérios de aceite

- [ ] O calendário mostra as noites ocupadas da casa correta.
- [ ] Pendência não vencida aparece como ocupada.
- [ ] Pendência vencida aparece como livre.
- [ ] A resposta não contém nenhum dado além de datas.
- [ ] Falha da API deixa os dias **desabilitados** e oferece nova tentativa.
- [ ] O dia de check-out de uma reserva é selecionável como check-in de outra.
- [ ] Datas fora da janela permitida estão desabilitadas.
- [ ] Navegar entre meses não perde as ocupações já carregadas.
- [ ] Ocupado é distinguível sem depender de cor.
- [ ] Operável por teclado.
- [ ] Consulta acima de 13 meses retorna 422.
- [ ] Resposta com `Cache-Control: max-age=60`.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Reserva confirmada 20–23 | Noites 20, 21, 22 ocupadas; 23 livre |
| 2 | Solicitação pendente válida | Noites ocupadas |
| 3 | Solicitação pendente vencida | Noites livres |
| 4 | Bloqueio 10–15 (inclusivo) | 6 noites ocupadas |
| 5 | Evento externo | Noites ocupadas, sem revelar o canal |
| 6 | Resposta JSON | Só `casaId`, `de`, `ate`, `noitesOcupadas`, `geradoEm` |
| 7 | Intervalo de 14 meses | 422 |
| 8 | `de > ate` | 400 |
| 9 | `casaId` de casa inativa | 404 |
| 10 | API com erro 500 | Dias desabilitados + botão |
| 11 | Timeout de 10 s | Mesmo tratamento |
| 12 | Selecionar intervalo com noite ocupada no meio | Recusado com aviso |
| 13 | Segundo toque antes do primeiro | Reinicia com o novo check-in |
| 14 | Navegar 2 meses à frente e voltar | Ocupações preservadas |
| 15 | Consulta às 23:30 BRT | `hoje` é a data local |
