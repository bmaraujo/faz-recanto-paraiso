import { describe, expect, it } from "vitest";

import {
  configPrecosSchema,
  consultaDisponibilidadeSchema,
  dataISOSchema,
  entradaCotacaoPublicaSchema,
  periodoPrecoSchema,
  ulidSchema,
} from "../src/index";

const ULID_VALIDO = "01HQZX3K4N6P8R0T2V4W6Y8Z0A";

const CONFIG_PRECOS_VALIDA = {
  diariaBaseCentavos: 50_000,
  diariaFimDeSemanaCentavos: 65_000,
  diasFimDeSemana: ["SEX", "SAB"],
  temporadas: [],
  feriados: [
    {
      id: "reveillon-2026",
      nome: "Réveillon",
      inicio: "2026-12-29",
      fim: "2027-01-02",
      diariaCentavos: 120_000,
      minNoites: 4,
    },
  ],
  minNoitesPadrao: 2,
  maxNoites: 60,
  taxaLimpezaCentavos: 25_000,
  hospedesInclusos: 6,
  capacidadeMaxima: 10,
  valorHospedeExtraPorNoiteCentavos: 5_000,
};

describe("dataISOSchema", () => {
  it("aceita data válida e existente no calendário", () => {
    expect(dataISOSchema.safeParse("2026-11-20").success).toBe(true);
  });

  it("rejeita formato diferente e data inexistente, reaproveitando ehDataValida", () => {
    for (const invalido of ["20/11/2026", "2026-11-20T00:00:00Z", "2026-02-30", ""]) {
      expect(dataISOSchema.safeParse(invalido).success).toBe(false);
    }
  });

  it("rejeita o que não é string", () => {
    expect(dataISOSchema.safeParse(20_261_120).success).toBe(false);
    expect(dataISOSchema.safeParse(null).success).toBe(false);
  });
});

describe("ulidSchema", () => {
  it("aceita ULID válido em maiúsculas e minúsculas", () => {
    expect(ulidSchema.safeParse(ULID_VALIDO).success).toBe(true);
    expect(ulidSchema.safeParse(ULID_VALIDO.toLowerCase()).success).toBe(true);
  });

  it("rejeita tamanho errado e caracteres fora do alfabeto de Crockford", () => {
    expect(ulidSchema.safeParse(ULID_VALIDO.slice(0, 20)).success).toBe(false);
    // 'I', 'L', 'O', 'U' não existem no alfabeto de Crockford.
    expect(ulidSchema.safeParse("I".repeat(26)).success).toBe(false);
  });
});

describe("periodoPrecoSchema", () => {
  it("aceita um período válido", () => {
    const resultado = periodoPrecoSchema.safeParse({
      id: "ferias-julho-2027",
      nome: "Férias de julho",
      inicio: "2027-07-01",
      fim: "2027-07-31",
      diariaCentavos: 70_000,
      minNoites: 3,
    });
    expect(resultado.success).toBe(true);
  });

  it("rejeita diária negativa ou fracionária — mas não impõe diária > 0 (regra de negócio)", () => {
    const base = {
      id: "p1",
      nome: "Período",
      inicio: "2026-12-01",
      fim: "2026-12-31",
      minNoites: 1,
    };
    expect(
      periodoPrecoSchema.safeParse({ ...base, diariaCentavos: -1 }).success,
    ).toBe(false);
    expect(
      periodoPrecoSchema.safeParse({ ...base, diariaCentavos: 100.5 }).success,
    ).toBe(false);
    // Zero passa o schema: é `validarConfigPrecos` quem rejeita diária zerada,
    // porque a mensagem de erro específica depende de conhecer a diária base.
    expect(periodoPrecoSchema.safeParse({ ...base, diariaCentavos: 0 }).success).toBe(
      true,
    );
  });

  it("rejeita minNoites zero ou negativo", () => {
    const base = {
      id: "p1",
      nome: "Período",
      inicio: "2026-12-01",
      fim: "2026-12-31",
      diariaCentavos: 1000,
    };
    expect(periodoPrecoSchema.safeParse({ ...base, minNoites: 0 }).success).toBe(false);
    expect(periodoPrecoSchema.safeParse({ ...base, minNoites: -1 }).success).toBe(false);
  });

  it("não valida que fim >= inicio — fica para validarConfigPrecos", () => {
    // Confirma a divisão de responsabilidade: o schema só olha forma de cada campo,
    // nunca a relação entre dois campos do mesmo objeto.
    const invertido = periodoPrecoSchema.safeParse({
      id: "p1",
      nome: "Período",
      inicio: "2026-12-31",
      fim: "2026-12-01",
      diariaCentavos: 1000,
      minNoites: 1,
    });
    expect(invertido.success).toBe(true);
  });
});

describe("configPrecosSchema", () => {
  it("aceita a configuração de exemplo completa", () => {
    expect(configPrecosSchema.safeParse(CONFIG_PRECOS_VALIDA).success).toBe(true);
  });

  it("rejeita dia da semana fora do enum", () => {
    const resultado = configPrecosSchema.safeParse({
      ...CONFIG_PRECOS_VALIDA,
      diasFimDeSemana: ["SEX", "SEXTA"],
    });
    expect(resultado.success).toBe(false);
  });

  it("rejeita centavos em float em qualquer campo monetário", () => {
    for (const campo of [
      "diariaBaseCentavos",
      "diariaFimDeSemanaCentavos",
      "taxaLimpezaCentavos",
      "valorHospedeExtraPorNoiteCentavos",
    ] as const) {
      const resultado = configPrecosSchema.safeParse({
        ...CONFIG_PRECOS_VALIDA,
        [campo]: 500.5,
      });
      expect(resultado.success).toBe(false);
    }
  });

  it("rejeita campo obrigatório ausente", () => {
    const { capacidadeMaxima: _removido, ...semCapacidade } = CONFIG_PRECOS_VALIDA;
    expect(configPrecosSchema.safeParse(semCapacidade).success).toBe(false);
  });

  it("aceita diariaBaseCentavos zero — é validarConfigPrecos quem exige > 0", () => {
    expect(
      configPrecosSchema.safeParse({ ...CONFIG_PRECOS_VALIDA, diariaBaseCentavos: 0 })
        .success,
    ).toBe(true);
  });

  it("propaga a validação de cada período da lista de feriados e temporadas", () => {
    const resultado = configPrecosSchema.safeParse({
      ...CONFIG_PRECOS_VALIDA,
      feriados: [{ ...CONFIG_PRECOS_VALIDA.feriados[0], diariaCentavos: -1 }],
    });
    expect(resultado.success).toBe(false);
  });
});

describe("entradaCotacaoPublicaSchema (UC-P03)", () => {
  const ENTRADA_VALIDA = {
    casaId: ULID_VALIDO,
    checkin: "2026-11-20",
    checkout: "2026-11-23",
    hospedes: 7,
  };

  it("aceita o corpo de exemplo do contrato técnico", () => {
    expect(entradaCotacaoPublicaSchema.safeParse(ENTRADA_VALIDA).success).toBe(true);
  });

  it("rejeita casaId que não é ULID", () => {
    expect(
      entradaCotacaoPublicaSchema.safeParse({ ...ENTRADA_VALIDA, casaId: "casa-do-lago" })
        .success,
    ).toBe(false);
  });

  it("rejeita hóspedes zero, negativo ou fracionário", () => {
    for (const hospedes of [0, -1, 2.5]) {
      expect(
        entradaCotacaoPublicaSchema.safeParse({ ...ENTRADA_VALIDA, hospedes }).success,
      ).toBe(false);
    }
  });

  it("não valida checkout > checkin — fica para calcularCotacao (INTERVALO_INVALIDO)", () => {
    const resultado = entradaCotacaoPublicaSchema.safeParse({
      ...ENTRADA_VALIDA,
      checkin: "2026-11-23",
      checkout: "2026-11-20",
    });
    expect(resultado.success).toBe(true);
  });

  it("rejeita campo ausente ou tipo errado", () => {
    expect(
      entradaCotacaoPublicaSchema.safeParse({ ...ENTRADA_VALIDA, hospedes: "7" }).success,
    ).toBe(false);
    const { checkin: _removido, ...semCheckin } = ENTRADA_VALIDA;
    expect(entradaCotacaoPublicaSchema.safeParse(semCheckin).success).toBe(false);
  });
});

describe("consultaDisponibilidadeSchema (UC-P02)", () => {
  it("aceita de/ate em formato válido", () => {
    expect(
      consultaDisponibilidadeSchema.safeParse({ de: "2026-11-01", ate: "2027-01-31" })
        .success,
    ).toBe(true);
  });

  it("rejeita data malformada em qualquer um dos dois campos", () => {
    expect(
      consultaDisponibilidadeSchema.safeParse({ de: "01-11-2026", ate: "2027-01-31" })
        .success,
    ).toBe(false);
    expect(
      consultaDisponibilidadeSchema.safeParse({ de: "2026-11-01", ate: "2027-13-01" })
        .success,
    ).toBe(false);
  });

  it("não valida ate >= de nem o limite de 13 meses — fica para validarIntervaloConsulta", () => {
    // de > ate passa o schema; é INTERVALO_MUITO_LONGO/ENTRADA_INVALIDA do domínio
    // que rejeita, com o código específico que a UI precisa.
    const resultado = consultaDisponibilidadeSchema.safeParse({
      de: "2027-01-31",
      ate: "2026-11-01",
    });
    expect(resultado.success).toBe(true);
  });
});
