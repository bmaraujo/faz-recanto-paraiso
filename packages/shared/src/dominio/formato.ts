/**
 * Formatação de valores para exibição em pt-BR.
 *
 * Nome e escopo vêm de docs/03-tecnico/14-estrategia-de-testes.md
 * (`formato.test.ts`: "Moeda, data, telefone, mascaramento") e de
 * docs/backend/README.md. **A formatação de data já está em `dominio/datas.ts`**
 * (`formatarDataPtBr`) — não duplicada aqui.
 *
 * **Escopo desta entrega:** só `formatarMoeda` e `formatarValorPorNoite`, porque são
 * as únicas duas que a Fase 1 realmente usa — UC-P03 (simulador) e UC-A04
 * (tela de preços). Normalização de telefone (E.164) e mascaramento de e-mail
 * têm seu primeiro consumidor em UC-A13, UC-P04 e UC-P05, todas Fase 2; construí-las
 * agora, sem um caso de uso puxando a forma exata, seria adiantar fase — a regra
 * não negociável do projeto (CLAUDE.md: "Respeite a fase atual"). Ficam para quando
 * essas UCs entrarem na fila, neste mesmo arquivo.
 */

/**
 * Formata um valor em centavos como moeda brasileira: `220000` → `"R$ 2.200,00"`.
 *
 * Centavos precisa ser um inteiro — é a regra não negociável do projeto ("dinheiro
 * sempre em centavos, inteiro"). Um `float` chegando aqui é sinal de bug em algum
 * lugar antes deste ponto, e falhar alto é melhor que arredondar silenciosamente.
 * Aceita negativo: a linha de `DESCONTO` do detalhamento da cotação
 * (`dominio/precos.ts`) é o caso legítimo de valor negativo em centavos.
 */
export function formatarMoeda(centavos: number): string {
  if (!Number.isInteger(centavos)) {
    throw new TypeError(
      `centavos deve ser um inteiro, recebido: ${String(centavos)}`,
    );
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    centavos / 100,
  );
}

/**
 * Formata o valor médio por noite de uma cotação (UC-P03, RN9): `total / noites`,
 * **arredondado só na exibição** — nunca em centavos inteiros intermediários.
 *
 * É a única divisão do pacote que foge da regra "tudo em centavos inteiros",
 * de propósito: o resultado nunca é persistido nem recalculado, só mostrado.
 */
export function formatarValorPorNoite(totalCentavos: number, noites: number): string {
  if (!Number.isInteger(totalCentavos)) {
    throw new TypeError(
      `totalCentavos deve ser um inteiro, recebido: ${String(totalCentavos)}`,
    );
  }
  if (!Number.isInteger(noites) || noites <= 0) {
    throw new TypeError(`noites deve ser um inteiro positivo, recebido: ${String(noites)}`);
  }

  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    totalCentavos / 100 / noites,
  );
}
