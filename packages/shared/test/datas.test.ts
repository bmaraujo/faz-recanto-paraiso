import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DIAS_DA_SEMANA,
  DataInvalidaError,
  IntervaloInvalidoError,
  compararDatas,
  diaDaSemana,
  diferencaEmDias,
  dtEndDeCheckout,
  ehDataValida,
  estaNoIntervaloInclusivo,
  formatarDataPtBr,
  formatarInstanteIso,
  hojeEmSaoPaulo,
  noitesDe,
  noitesDePeriodoInclusivo,
  nomeDoDiaDaSemana,
  somarDias,
  somarMeses,
  validarData,
} from "../src/dominio/datas";

/**
 * Os 14 casos obrigatorios de docs/03-tecnico/14-estrategia-de-testes.md,
 * na mesma ordem e numeracao do documento.
 */
describe("casos obrigatorios", () => {
  it("1. noitesDe exclui o dia do check-out", () => {
    expect(noitesDe("2026-11-20", "2026-11-23")).toEqual([
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
  });

  it("2. check-in igual ao check-out nao ocupa nenhuma noite", () => {
    expect(noitesDe("2026-11-20", "2026-11-20")).toEqual([]);
  });

  it("3. atravessa a virada de mes", () => {
    expect(noitesDe("2026-11-30", "2026-12-02")).toEqual(["2026-11-30", "2026-12-01"]);
  });

  it("4. atravessa a virada de ano com o ano correto nas duas pontas", () => {
    expect(noitesDe("2026-12-31", "2027-01-02")).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("5. inclui 29 de fevereiro em ano bissexto", () => {
    expect(noitesDe("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29"]);
  });

  it("6. as 23:30 em Sao Paulo o dia local ainda e o anterior ao de UTC", () => {
    // 2026-11-20 23:30 BRT (UTC-3) == 2026-11-21 02:30 UTC
    const instante = new Date("2026-11-21T02:30:00Z");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-11-21"); // o que UTC diria
    expect(hojeEmSaoPaulo(instante)).toBe("2026-11-20");
  });

  it("7. as 00:30 em Sao Paulo o dia local e o do proprio dia", () => {
    // 2026-11-20 00:30 BRT == 2026-11-20 03:30 UTC
    expect(hojeEmSaoPaulo(new Date("2026-11-20T03:30:00Z"))).toBe("2026-11-20");
  });

  it("8. diaDaSemana de 2026-11-20 e sexta-feira", () => {
    expect(diaDaSemana("2026-11-20")).toBe("SEX");
    expect(nomeDoDiaDaSemana("2026-11-20")).toBe("Sexta-feira");
  });

  it("9. diferencaEmDias ignora mudanca de horario de verao", () => {
    // 2018-11-04 foi o ultimo inicio de horario de verao no Brasil (dia de 23 h).
    expect(diferencaEmDias("2018-11-03", "2018-11-05")).toBe(2);
    // 2018-02-18 foi um fim de horario de verao (dia de 25 h).
    expect(diferencaEmDias("2018-02-17", "2018-02-19")).toBe(2);
    expect(noitesDe("2018-11-03", "2018-11-05")).toHaveLength(2);
  });

  it("10. periodo inclusivo de bloqueio, de 10 a 15, tem 6 noites", () => {
    expect(noitesDePeriodoInclusivo("2026-01-10", "2026-01-15")).toEqual([
      "2026-01-10",
      "2026-01-11",
      "2026-01-12",
      "2026-01-13",
      "2026-01-14",
      "2026-01-15",
    ]);
  });

  it("11. periodo exclusivo de reserva, de 10 a 15, tem 5 noites", () => {
    expect(noitesDe("2026-01-10", "2026-01-15")).toHaveLength(5);
  });

  it("12. DTEND do iCal e exclusivo e igual ao check-out", () => {
    const checkin = "2026-01-10";
    const checkout = "2026-01-15";
    const dtEnd = dtEndDeCheckout(checkout);

    expect(dtEnd).toBe(checkout);
    // A ultima noite ocupada e o dia anterior ao DTEND.
    const noites = noitesDe(checkin, dtEnd);
    expect(noites.at(-1)).toBe("2026-01-14");
  });

  it("13. data inexistente no calendario e erro, nao vira o dia seguinte", () => {
    expect(ehDataValida("2026-02-30")).toBe(false);
    expect(() => validarData("2026-02-30")).toThrow(DataInvalidaError);
    expect(() => noitesDe("2026-02-30", "2026-03-02")).toThrow(DataInvalidaError);
    // Contraste com o comportamento nativo que estamos evitando: fevereiro de
    // 2026 tem 28 dias, e o Date rola 30/02 para 02/03 sem avisar ninguem.
    expect(new Date("2026-02-30T00:00:00Z").toISOString().slice(0, 10)).toBe("2026-03-02");
  });

  it("14. formato diferente de YYYY-MM-DD e erro", () => {
    for (const invalido of ["20/11/2026", "2026-11-20T00:00:00Z", "2026-1-5", ""]) {
      expect(ehDataValida(invalido)).toBe(false);
      expect(() => validarData(invalido)).toThrow(DataInvalidaError);
    }
  });
});

describe("ehDataValida", () => {
  it("aceita datas reais, incluindo 29/02 de ano bissexto", () => {
    expect(ehDataValida("2026-11-20")).toBe(true);
    expect(ehDataValida("2028-02-29")).toBe(true);
  });

  it("rejeita 29/02 em ano nao bissexto e ano secular nao bissexto", () => {
    expect(ehDataValida("2026-02-29")).toBe(false);
    expect(ehDataValida("1900-02-29")).toBe(false);
    expect(ehDataValida("2000-02-29")).toBe(true);
  });

  it("rejeita mes e dia fora de faixa", () => {
    expect(ehDataValida("2026-13-01")).toBe(false);
    expect(ehDataValida("2026-00-10")).toBe(false);
    expect(ehDataValida("2026-11-00")).toBe(false);
    expect(ehDataValida("2026-11-32")).toBe(false);
    expect(ehDataValida("2026-04-31")).toBe(false);
  });

  it("rejeita o que nao e string", () => {
    for (const invalido of [undefined, null, 20261120, new Date(), {}, []]) {
      expect(ehDataValida(invalido)).toBe(false);
    }
  });

  it("nomeia o campo na mensagem de erro", () => {
    expect(() => validarData("x", "checkin")).toThrow(/checkin/);
  });
});

describe("somarDias", () => {
  it("soma, subtrai e atravessa viradas", () => {
    expect(somarDias("2026-11-20", 3)).toBe("2026-11-23");
    expect(somarDias("2026-11-20", 0)).toBe("2026-11-20");
    expect(somarDias("2026-01-01", -1)).toBe("2025-12-31");
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(somarDias("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("exige numero inteiro de dias", () => {
    expect(() => somarDias("2026-11-20", 1.5)).toThrow(TypeError);
    expect(() => somarDias("2026-11-20", Number.NaN)).toThrow(TypeError);
  });
});

describe("somarMeses", () => {
  it("usa meses de calendario para a janela de reserva", () => {
    expect(somarMeses("2026-11-20", 12)).toBe("2027-11-20");
    expect(somarMeses("2026-11-20", 0)).toBe("2026-11-20");
    expect(somarMeses("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("trunca para o ultimo dia do mes quando o dia nao existe no destino", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(somarMeses("2026-08-31", 1)).toBe("2026-09-30");
  });

  it("exige numero inteiro de meses", () => {
    expect(() => somarMeses("2026-11-20", 0.5)).toThrow(TypeError);
  });
});

describe("diferencaEmDias e compararDatas", () => {
  it("conta dias nos dois sentidos", () => {
    expect(diferencaEmDias("2026-11-20", "2026-11-23")).toBe(3);
    expect(diferencaEmDias("2026-11-23", "2026-11-20")).toBe(-3);
    expect(diferencaEmDias("2026-11-20", "2026-11-20")).toBe(0);
  });

  it("ordena datas como strings ordenaveis", () => {
    expect(compararDatas("2026-11-20", "2026-11-23")).toBe(-1);
    expect(compararDatas("2026-11-23", "2026-11-20")).toBe(1);
    expect(compararDatas("2026-11-20", "2026-11-20")).toBe(0);

    const desordenadas = ["2026-12-01", "2026-01-05", "2026-11-20"];
    expect([...desordenadas].sort(compararDatas)).toEqual([
      "2026-01-05",
      "2026-11-20",
      "2026-12-01",
    ]);
  });
});

describe("noitesDe e noitesDePeriodoInclusivo", () => {
  it("rejeitam fim anterior ao inicio em vez de devolver lista vazia", () => {
    expect(() => noitesDe("2026-11-23", "2026-11-20")).toThrow(IntervaloInvalidoError);
    expect(() => noitesDePeriodoInclusivo("2026-11-23", "2026-11-20")).toThrow(
      IntervaloInvalidoError,
    );
  });

  it("periodo inclusivo de um unico dia tem uma noite", () => {
    expect(noitesDePeriodoInclusivo("2026-11-20", "2026-11-20")).toEqual(["2026-11-20"]);
  });

  it("protegem contra intervalo absurdo", () => {
    expect(() => noitesDe("2026-01-01", "2030-01-01")).toThrow(RangeError);
  });
});

describe("diaDaSemana", () => {
  it("cobre a semana inteira a partir de um domingo conhecido", () => {
    // 2026-11-22 e um domingo.
    const esperado = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
    const obtido = noitesDePeriodoInclusivo("2026-11-22", "2026-11-28").map(diaDaSemana);
    expect(obtido).toEqual(esperado);
  });

  it("nomeia todos os dias em pt-BR", () => {
    const nomes = noitesDePeriodoInclusivo("2026-11-22", "2026-11-28").map(
      nomeDoDiaDaSemana,
    );
    expect(nomes).toEqual([
      "Domingo",
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
    ]);
  });
});

describe("estaNoIntervaloInclusivo", () => {
  // Semantica de temporada e feriado: as duas pontas contam.
  const inicio = "2026-12-29";
  const fim = "2027-01-02";

  it("inclui as duas pontas", () => {
    expect(estaNoIntervaloInclusivo(inicio, inicio, fim)).toBe(true);
    expect(estaNoIntervaloInclusivo(fim, inicio, fim)).toBe(true);
  });

  it("inclui o meio e exclui o que esta fora", () => {
    expect(estaNoIntervaloInclusivo("2026-12-31", inicio, fim)).toBe(true);
    expect(estaNoIntervaloInclusivo("2026-12-28", inicio, fim)).toBe(false);
    expect(estaNoIntervaloInclusivo("2027-01-03", inicio, fim)).toBe(false);
  });
});

describe("hojeEmSaoPaulo", () => {
  it("rejeita instante invalido", () => {
    expect(() => hojeEmSaoPaulo(new Date("nao e data"))).toThrow(TypeError);
    // @ts-expect-error -- contrato violado de proposito: a fronteira precisa barrar
    expect(() => hojeEmSaoPaulo("2026-11-20")).toThrow(TypeError);
  });

  it("vira o dia exatamente a meia-noite local", () => {
    // 03:00 UTC == 00:00 BRT
    expect(hojeEmSaoPaulo(new Date("2026-11-20T02:59:59Z"))).toBe("2026-11-19");
    expect(hojeEmSaoPaulo(new Date("2026-11-20T03:00:00Z"))).toBe("2026-11-20");
  });
});

describe("formatarDataPtBr", () => {
  it("formata como dd/mm/aaaa", () => {
    expect(formatarDataPtBr("2026-11-20")).toBe("20/11/2026");
    expect(formatarDataPtBr("2027-01-02")).toBe("02/01/2027");
  });

  it("valida antes de formatar", () => {
    expect(() => formatarDataPtBr("20/11/2026")).toThrow(DataInvalidaError);
  });
});

describe("formatarInstanteIso", () => {
  it("usa o offset de America/Sao_Paulo, nao Z", () => {
    // 21:04 UTC == 18:04 BRT (-03:00)
    expect(formatarInstanteIso(new Date("2026-10-11T21:04:00Z"))).toBe(
      "2026-10-11T18:04:00-03:00",
    );
  });

  it("vira o dia local corretamente perto da meia-noite", () => {
    // 02:59:59 UTC == 23:59:59 BRT do dia anterior
    expect(formatarInstanteIso(new Date("2026-11-20T02:59:59Z"))).toBe(
      "2026-11-19T23:59:59-03:00",
    );
  });

  it("rejeita instante invalido", () => {
    expect(() => formatarInstanteIso(new Date("nao e data"))).toThrow(TypeError);
    // @ts-expect-error -- contrato violado de proposito: a fronteira precisa barrar
    expect(() => formatarInstanteIso("2026-11-20")).toThrow(TypeError);
  });
});

/**
 * Propriedades de docs/03-tecnico/14-estrategia-de-testes.md.
 * Protegem o modulo de refatoracao futura melhor que qualquer caso pontual.
 */
describe("propriedades", () => {
  const arbData = fc
    .date({
      min: new Date("2000-01-01T00:00:00Z"),
      max: new Date("2060-12-31T00:00:00Z"),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10));

  const arbEstadia = fc
    .tuple(arbData, fc.integer({ min: 0, max: 60 }))
    .map(([checkin, noites]) => ({ checkin, checkout: somarDias(checkin, noites), noites }));

  it("noitesDe(a, b).length === diferencaEmDias(a, b)", () => {
    fc.assert(
      fc.property(arbEstadia, ({ checkin, checkout }) => {
        expect(noitesDe(checkin, checkout)).toHaveLength(
          diferencaEmDias(checkin, checkout),
        );
      }),
    );
  });

  it("as noites sao consecutivas, sem buraco nem repeticao", () => {
    fc.assert(
      fc.property(arbEstadia, ({ checkin, checkout }) => {
        const noites = noitesDe(checkin, checkout);
        for (let i = 1; i < noites.length; i += 1) {
          expect(diferencaEmDias(noites[i - 1] as string, noites[i] as string)).toBe(1);
        }
        expect(new Set(noites).size).toBe(noites.length);
      }),
    );
  });

  it("a primeira noite e o check-in e a ultima e o dia anterior ao check-out", () => {
    fc.assert(
      fc.property(
        arbEstadia.filter(({ noites }) => noites > 0),
        ({ checkin, checkout }) => {
          const noites = noitesDe(checkin, checkout);
          expect(noites[0]).toBe(checkin);
          expect(noites.at(-1)).toBe(somarDias(checkout, -1));
        },
      ),
    );
  });

  it("somarDias e diferencaEmDias sao inversas", () => {
    fc.assert(
      fc.property(arbData, fc.integer({ min: -3650, max: 3650 }), (data, dias) => {
        const destino = somarDias(data, dias);
        expect(diferencaEmDias(data, destino)).toBe(dias);
        expect(somarDias(destino, -dias)).toBe(data);
      }),
    );
  });

  it("toda data valida tem um dia da semana conhecido", () => {
    fc.assert(
      fc.property(arbData, (data) => {
        expect(DIAS_DA_SEMANA).toContain(diaDaSemana(data));
      }),
    );
  });

  it("o periodo inclusivo tem sempre uma noite mais que o exclusivo", () => {
    fc.assert(
      fc.property(arbEstadia, ({ checkin, checkout }) => {
        expect(noitesDePeriodoInclusivo(checkin, checkout)).toHaveLength(
          noitesDe(checkin, checkout).length + 1,
        );
      }),
    );
  });

  it("formatarDataPtBr preserva os componentes da data", () => {
    fc.assert(
      fc.property(arbData, (data) => {
        const [ano, mes, dia] = data.split("-");
        expect(formatarDataPtBr(data)).toBe(`${dia}/${mes}/${ano}`);
      }),
    );
  });
});
