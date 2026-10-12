import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { formatarMoeda, formatarValorPorNoite } from "../src/dominio/formato";

/**
 * `Intl.NumberFormat("pt-BR", { style: "currency", ... })` separa "R$" do valor com
 * um espaço **não quebrável** (` `), não um espaço comum — invisível ao olhar
 * o texto, mas falha `toBe` com um literal digitado normalmente. Daí este helper:
 * monta o esperado com o próprio `Intl`, em vez de arriscar o caractere errado.
 */
const NBSP = " ";
const esperado = (reais: number): string =>
  `R$${NBSP}${reais.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Casos de teste de UC-P03-simular-preco.md que pertencem a este módulo. */
describe("casos obrigatórios (UC-P03)", () => {
  it("6. total de R$ 2.200,00 é exibido como 'R$ 2.200,00'", () => {
    expect(formatarMoeda(220_000)).toBe(`R$${NBSP}2.200,00`);
  });

  it("7. estadia de 3 noites, total 220000, mostra 'R$ 733,33 por noite'", () => {
    expect(formatarValorPorNoite(220_000, 3)).toBe(`R$${NBSP}733,33`);
  });
});

describe("formatarMoeda", () => {
  it("formata valores redondos, com separador de milhar e vírgula decimal", () => {
    expect(formatarMoeda(50_000)).toBe(esperado(500));
    expect(formatarMoeda(1_000_000)).toBe(esperado(10_000));
  });

  it("formata centavos avulsos sem arredondar", () => {
    expect(formatarMoeda(1)).toBe(esperado(0.01));
    expect(formatarMoeda(99)).toBe(esperado(0.99));
  });

  it("formata zero", () => {
    expect(formatarMoeda(0)).toBe(esperado(0));
  });

  it("formata negativo — a linha de desconto do detalhamento", () => {
    expect(formatarMoeda(-180_000)).toBe(`-${esperado(1_800)}`);
  });

  it("rejeita valor fracionário: dinheiro nunca é float", () => {
    expect(() => formatarMoeda(100.5)).toThrow(TypeError);
  });

  it("rejeita NaN e Infinity", () => {
    expect(() => formatarMoeda(Number.NaN)).toThrow(TypeError);
    expect(() => formatarMoeda(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("formatarValorPorNoite", () => {
  it("divide o total pelas noites, arredondando só na exibição", () => {
    expect(formatarValorPorNoite(100_000, 1)).toBe(esperado(1_000));
    expect(formatarValorPorNoite(100_000, 3)).toBe(esperado(333.33));
  });

  it("rejeita total fracionário", () => {
    expect(() => formatarValorPorNoite(100.5, 2)).toThrow(TypeError);
  });

  it("rejeita noites zero, negativa ou fracionária", () => {
    for (const noites of [0, -1, 1.5]) {
      expect(() => formatarValorPorNoite(100_000, noites)).toThrow(TypeError);
    }
  });
});

describe("propriedades", () => {
  it("formatarMoeda nunca lança para qualquer inteiro de centavos", () => {
    fc.assert(
      fc.property(fc.integer(), (centavos) => {
        expect(() => formatarMoeda(centavos)).not.toThrow();
      }),
    );
  });

  it("formatarValorPorNoite com noites=1 é igual a formatarMoeda do mesmo total", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (totalCentavos) => {
        expect(formatarValorPorNoite(totalCentavos, 1)).toBe(formatarMoeda(totalCentavos));
      }),
    );
  });

  it("toda saída começa com 'R$' ou '-R$', nunca mostra o valor em centavos", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (centavos) => {
        const resultado = formatarMoeda(centavos);
        expect(resultado.startsWith("R$") || resultado.startsWith("-R$")).toBe(true);
      }),
    );
  });
});
