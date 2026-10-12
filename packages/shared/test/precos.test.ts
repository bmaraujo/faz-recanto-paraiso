import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { DIAS_DA_SEMANA, hojeEmSaoPaulo, somarDias } from "../src/dominio/datas";
import {
  type ConfigGeralCotacao,
  type ConfigPrecos,
  type Cotacao,
  type EntradaCotacao,
  type PeriodoPreco,
  MAX_NOITES_PERMITIDO,
  calcularCotacao,
  ehErroCotacao,
  validarConfigPrecos,
} from "../src/dominio/precos";

/**
 * Valores de exemplo de docs/06-planejamento/02-pendencias-definir.md.
 * São configuração por casa, não constantes do sistema.
 */
const CONFIG_BASE: ConfigPrecos = {
  diariaBaseCentavos: 50_000,
  diariaFimDeSemanaCentavos: 65_000,
  diasFimDeSemana: ["SEX", "SAB"],
  temporadas: [],
  feriados: [],
  minNoitesPadrao: 2,
  maxNoites: 60,
  taxaLimpezaCentavos: 25_000,
  hospedesInclusos: 6,
  capacidadeMaxima: 10,
  valorHospedeExtraPorNoiteCentavos: 5_000,
};

const CONFIG_GERAL: ConfigGeralCotacao = {
  antecedenciaMinimaDias: 1,
  janelaReservaMeses: 12,
};

const HOJE = "2026-11-01";

function periodo(dados: Partial<PeriodoPreco> = {}): PeriodoPreco {
  return {
    id: "p1",
    nome: "Período",
    inicio: "2026-12-01",
    fim: "2026-12-31",
    diariaCentavos: 70_000,
    minNoites: 2,
    ...dados,
  };
}

/** Cota e exige sucesso — mantém os testes legíveis sem repetir o discriminador. */
function cotar(
  config: Partial<ConfigPrecos>,
  entrada: Partial<EntradaCotacao> & Pick<EntradaCotacao, "checkin" | "checkout">,
): Cotacao {
  const resultado = calcularCotacao(
    { ...CONFIG_BASE, ...config },
    { hospedes: 6, hoje: HOJE, configGeral: CONFIG_GERAL, ...entrada },
  );
  if (ehErroCotacao(resultado)) {
    throw new Error(`esperava cotação, veio erro ${resultado.erro}: ${resultado.mensagem}`);
  }
  return resultado;
}

/** Cota e exige erro. */
function cotarComErro(
  config: Partial<ConfigPrecos>,
  entrada: Partial<EntradaCotacao> & Pick<EntradaCotacao, "checkin" | "checkout">,
) {
  const resultado = calcularCotacao(
    { ...CONFIG_BASE, ...config },
    { hospedes: 6, hoje: HOJE, configGeral: CONFIG_GERAL, ...entrada },
  );
  if (!ehErroCotacao(resultado)) {
    throw new Error("esperava erro de validação, veio uma cotação");
  }
  return resultado;
}

const tarifas = (c: Cotacao): string[] =>
  c.detalhamento.filter((l) => l.tipo === "NOITE").map((l) => l.tarifa);

const somaDetalhamento = (c: Cotacao): number =>
  c.detalhamento.reduce((soma, linha) => soma + linha.valorCentavos, 0);

/**
 * Os 17 casos obrigatórios de docs/01-negocio/02-regras-de-preco.md,
 * na mesma numeração do documento. O caso 15 é um teste de propriedade, mais abaixo.
 */
describe("casos obrigatórios", () => {
  it("1. sexta + sábado + domingo: duas noites de fim de semana e uma base", () => {
    const c = cotar({}, { checkin: "2026-11-20", checkout: "2026-11-23" });

    expect(tarifas(c)).toEqual(["FIM_DE_SEMANA", "FIM_DE_SEMANA", "BASE"]);
    expect(c.subtotalDiariasCentavos).toBe(180_000);
    expect(c.totalCentavos).toBe(205_000);
  });

  it("2. estadia que atravessa o início de uma temporada", () => {
    const temporada = periodo({
      nome: "Férias",
      inicio: "2026-11-22",
      fim: "2026-11-30",
      diariaCentavos: 70_000,
    });
    const c = cotar(
      { temporadas: [temporada] },
      { checkin: "2026-11-20", checkout: "2026-11-24" },
    );

    expect(tarifas(c)).toEqual([
      "FIM_DE_SEMANA",
      "FIM_DE_SEMANA",
      "TEMPORADA",
      "TEMPORADA",
    ]);
    expect(c.subtotalDiariasCentavos).toBe(65_000 * 2 + 70_000 * 2);
  });

  it("3. estadia que atravessa o fim de um feriado", () => {
    const reveillon = periodo({
      nome: "Réveillon",
      inicio: "2026-12-29",
      fim: "2027-01-02",
      diariaCentavos: 120_000,
      minNoites: 4,
    });
    const c = cotar(
      { feriados: [reveillon] },
      { checkin: "2027-01-01", checkout: "2027-01-05" },
    );

    // 01/01 e 02/01 ainda são feriado; 03 e 04 voltam à base.
    expect(tarifas(c)).toEqual(["FERIADO", "FERIADO", "BASE", "BASE"]);
    expect(c.subtotalDiariasCentavos).toBe(120_000 * 2 + 50_000 * 2);
  });

  it("4. noite coberta por feriado e temporada: o feriado vence", () => {
    const c = cotar(
      {
        temporadas: [periodo({ id: "t", nome: "Verão", diariaCentavos: 70_000 })],
        feriados: [
          periodo({
            id: "f",
            nome: "Natal",
            inicio: "2026-12-25",
            fim: "2026-12-26",
            diariaCentavos: 120_000,
          }),
        ],
      },
      { checkin: "2026-12-24", checkout: "2026-12-27" },
    );

    expect(tarifas(c)).toEqual(["TEMPORADA", "FERIADO", "FERIADO"]);
    // 25/12/2026 é sexta: o feriado vence o fim de semana também.
    const noiteDeNatal = c.detalhamento.find(
      (l) => l.tipo === "NOITE" && l.data === "2026-12-25",
    );
    expect(noiteDeNatal).toMatchObject({ tarifa: "FERIADO", periodoNome: "Natal" });
  });

  it("5. dois feriados sobrepostos na mesma noite: vence a maior diária", () => {
    const c = cotar(
      {
        minNoitesPadrao: 1,
        feriados: [
          periodo({
            id: "a",
            nome: "Natal",
            inicio: "2026-12-24",
            fim: "2026-12-26",
            diariaCentavos: 100_000,
            minNoites: 1,
          }),
          periodo({
            id: "b",
            nome: "Natal estendido",
            inicio: "2026-12-26",
            fim: "2026-12-28",
            diariaCentavos: 150_000,
            minNoites: 1,
          }),
        ],
      },
      { checkin: "2026-12-26", checkout: "2026-12-27" },
    );

    expect(c.subtotalDiariasCentavos).toBe(150_000);
    expect(c.detalhamento[0]).toMatchObject({ periodoNome: "Natal estendido" });
  });

  it("6. feriado com mínimo de 4 noites e pedido de 3", () => {
    const e = cotarComErro(
      {
        feriados: [
          periodo({
            nome: "Réveillon",
            inicio: "2026-12-29",
            fim: "2027-01-02",
            diariaCentavos: 120_000,
            minNoites: 4,
          }),
        ],
      },
      { checkin: "2026-12-30", checkout: "2027-01-02" },
    );

    expect(e.erro).toBe("MINIMO_NOITES");
    expect(e.detalhes).toMatchObject({ minimoExigido: 4, periodoNome: "Réveillon" });
    expect(e.mensagem).toContain("Réveillon");
  });

  it("7. hóspedes igual aos inclusos: nenhum acréscimo e nenhuma linha", () => {
    const c = cotar({}, { checkin: "2026-11-20", checkout: "2026-11-23", hospedes: 6 });

    expect(c.acrescimoHospedesCentavos).toBe(0);
    expect(c.detalhamento.some((l) => l.tipo === "HOSPEDE_EXTRA")).toBe(false);
  });

  it("8. dois hóspedes extras em 3 noites", () => {
    const c = cotar({}, { checkin: "2026-11-20", checkout: "2026-11-23", hospedes: 8 });

    expect(c.acrescimoHospedesCentavos).toBe(2 * 5_000 * 3);
    expect(c.detalhamento).toContainEqual({
      tipo: "HOSPEDE_EXTRA",
      quantidade: 2,
      rotulo: "2 hóspedes extras × 3 noites",
      valorCentavos: 30_000,
    });
  });

  it("9. hóspedes acima da capacidade", () => {
    const e = cotarComErro(
      {},
      { checkin: "2026-11-20", checkout: "2026-11-23", hospedes: 11 },
    );

    expect(e.erro).toBe("CAPACIDADE_EXCEDIDA");
    expect(e.detalhes).toMatchObject({ capacidadeMaxima: 10 });
  });

  it("10. desconto maior que o subtotal não deixa o total negativo", () => {
    const c = cotar(
      {},
      { checkin: "2026-11-20", checkout: "2026-11-23", descontoCentavos: 999_999 },
    );

    // O desconto é limitado ao subtotal e nunca toca a taxa de limpeza.
    expect(c.descontoCentavos).toBe(180_000);
    expect(c.totalCentavos).toBe(25_000);
    expect(c.detalhamento).toContainEqual({
      tipo: "DESCONTO",
      rotulo: "Desconto",
      valorCentavos: -180_000,
    });
  });

  it("11. taxa de limpeza em estadia de 10 noites é cobrada uma vez", () => {
    const c = cotar({}, { checkin: "2026-11-20", checkout: "2026-11-30" });

    expect(c.noites).toBe(10);
    expect(c.detalhamento.filter((l) => l.tipo === "TAXA_LIMPEZA")).toHaveLength(1);
    expect(c.taxaLimpezaCentavos).toBe(25_000);
  });

  it("12. check-in ontem", () => {
    const e = cotarComErro({}, { checkin: "2026-10-31", checkout: "2026-11-05" });

    expect(e.erro).toBe("ANTECEDENCIA_MINIMA");
    expect(e.detalhes).toMatchObject({ primeiroCheckinPermitido: "2026-11-02" });
  });

  it("13. estadia de 61 noites", () => {
    const e = cotarComErro(
      {},
      { checkin: "2026-11-20", checkout: somarDias("2026-11-20", 61) },
    );

    expect(e.erro).toBe("MAXIMO_NOITES");
    expect(e.detalhes).toMatchObject({ maxNoites: 60, noitesPedidas: 61 });
  });

  it("14. configuração sem temporadas nem feriados usa só base e fim de semana", () => {
    const c = cotar({}, { checkin: "2026-11-16", checkout: "2026-11-23" });

    expect(tarifas(c)).toEqual([
      "BASE",
      "BASE",
      "BASE",
      "BASE",
      "FIM_DE_SEMANA",
      "FIM_DE_SEMANA",
      "BASE",
    ]);
    expect(c.subtotalDiariasCentavos).toBe(50_000 * 5 + 65_000 * 2);
  });

  // 15. A soma do detalhamento é igual ao total: ver "propriedades", abaixo.

  it("16. virada de ano dentro da estadia", () => {
    const c = cotar({}, { checkin: "2026-12-30", checkout: "2027-01-02" });

    expect(c.detalhamento.filter((l) => l.tipo === "NOITE").map((l) => l.data)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
    expect(c.subtotalDiariasCentavos).toBe(50_000 * 2 + 65_000);
  });

  it("17. às 23h em São Paulo, 'hoje' é a data local e não a de UTC", () => {
    // 2026-11-20 23:30 BRT == 2026-11-21 02:30 UTC
    const instante = new Date("2026-11-21T02:30:00Z");
    const estadia = { checkin: "2026-11-21", checkout: "2026-11-24" } as const;

    const comDataLocal = calcularCotacao(CONFIG_BASE, {
      ...estadia,
      hospedes: 6,
      hoje: hojeEmSaoPaulo(instante),
      configGeral: CONFIG_GERAL,
    });
    expect(ehErroCotacao(comDataLocal)).toBe(false);

    // Usar a data de UTC adiantaria o calendário em um dia e recusaria a reserva.
    const comDataDeUtc = calcularCotacao(CONFIG_BASE, {
      ...estadia,
      hospedes: 6,
      hoje: instante.toISOString().slice(0, 10),
      configGeral: CONFIG_GERAL,
    });
    expect(comDataDeUtc).toMatchObject({ erro: "ANTECEDENCIA_MINIMA" });
  });
});

describe("validações restantes de calcularCotacao", () => {
  it("rejeita data malformada ou inexistente, nomeando o campo", () => {
    expect(cotarComErro({}, { checkin: "20/11/2026", checkout: "2026-11-23" })).toMatchObject({
      erro: "DATA_INVALIDA",
      detalhes: { campo: "checkin" },
    });
    expect(cotarComErro({}, { checkin: "2026-11-20", checkout: "2026-02-30" })).toMatchObject({
      erro: "DATA_INVALIDA",
      detalhes: { campo: "checkout" },
    });
    expect(
      cotarComErro({}, { checkin: "2026-11-20", checkout: "2026-11-23", hoje: "x" }),
    ).toMatchObject({ erro: "DATA_INVALIDA", detalhes: { campo: "hoje" } });
  });

  it("rejeita check-out igual ou anterior ao check-in", () => {
    expect(cotarComErro({}, { checkin: "2026-11-20", checkout: "2026-11-20" }).erro).toBe(
      "INTERVALO_INVALIDO",
    );
    expect(cotarComErro({}, { checkin: "2026-11-20", checkout: "2026-11-19" }).erro).toBe(
      "INTERVALO_INVALIDO",
    );
  });

  it("pluraliza a mensagem de antecedência quando o mínimo é maior que um dia", () => {
    const resultado = calcularCotacao(CONFIG_BASE, {
      checkin: "2026-11-03",
      checkout: "2026-11-06",
      hospedes: 6,
      hoje: HOJE,
      configGeral: { ...CONFIG_GERAL, antecedenciaMinimaDias: 3 },
    });

    expect(resultado).toMatchObject({
      erro: "ANTECEDENCIA_MINIMA",
      detalhes: { antecedenciaMinimaDias: 3, primeiroCheckinPermitido: "2026-11-04" },
    });
    expect(ehErroCotacao(resultado) && resultado.mensagem).toContain("3 dias");
  });

  it("aceita o check-in exatamente no limite da antecedência", () => {
    expect(cotar({}, { checkin: "2026-11-02", checkout: "2026-11-05" }).noites).toBe(3);
  });

  it("recusa check-in além da janela e aceita no último dia dela", () => {
    expect(cotarComErro({}, { checkin: "2027-11-02", checkout: "2027-11-05" }).erro).toBe(
      "FORA_DA_JANELA",
    );
    expect(cotar({}, { checkin: "2027-11-01", checkout: "2027-11-04" }).noites).toBe(3);
  });

  it("recusa hóspedes abaixo de 1 ou fracionário", () => {
    for (const hospedes of [0, -1, 2.5, Number.NaN]) {
      expect(
        cotarComErro({}, { checkin: "2026-11-20", checkout: "2026-11-23", hospedes }).erro,
      ).toBe("CAPACIDADE_EXCEDIDA");
    }
  });

  it("respeita o limite técnico de 60 noites mesmo com maxNoites maior", () => {
    const e = cotarComErro(
      { maxNoites: 90 },
      { checkin: "2026-11-20", checkout: somarDias("2026-11-20", 61) },
    );
    expect(e.detalhes).toMatchObject({ maxNoites: MAX_NOITES_PERMITIDO });
  });

  it("usa o maior mínimo entre os períodos tocados", () => {
    const e = cotarComErro(
      {
        feriados: [
          periodo({ id: "f", nome: "Feriado", inicio: "2026-12-05", fim: "2026-12-06", minNoites: 4 }),
        ],
        temporadas: [periodo({ id: "t", nome: "Temporada", minNoites: 3 })],
      },
      { checkin: "2026-12-04", checkout: "2026-12-06" },
    );

    expect(e.detalhes).toMatchObject({ minimoExigido: 4, periodoNome: "Feriado" });
  });

  it("basta tocar o período para o mínimo dele valer", () => {
    // A estadia entra no feriado só na última noite, e já herda o mínimo dele.
    const e = cotarComErro(
      {
        feriados: [periodo({ nome: "Feriado", inicio: "2026-12-10", fim: "2026-12-12", minNoites: 5 })],
      },
      { checkin: "2026-12-08", checkout: "2026-12-11" },
    );
    expect(e.detalhes).toMatchObject({ minimoExigido: 5 });
  });

  it("não nomeia período quando o mínimo vem do padrão da casa", () => {
    const e = cotarComErro({}, { checkin: "2026-11-20", checkout: "2026-11-21" });

    expect(e.detalhes).toMatchObject({ minimoExigido: 2 });
    expect(e.detalhes.periodoNome).toBeUndefined();
  });

  it("omite a taxa de limpeza do detalhamento quando ela é zero", () => {
    const c = cotar(
      { taxaLimpezaCentavos: 0 },
      { checkin: "2026-11-20", checkout: "2026-11-23" },
    );

    expect(c.detalhamento.some((l) => l.tipo === "TAXA_LIMPEZA")).toBe(false);
    expect(c.totalCentavos).toBe(c.subtotalDiariasCentavos);
  });

  it("ignora desconto negativo e preserva a soma do detalhamento", () => {
    const c = cotar(
      {},
      { checkin: "2026-11-20", checkout: "2026-11-23", descontoCentavos: -500 },
    );

    expect(c.descontoCentavos).toBe(0);
    expect(somaDetalhamento(c)).toBe(c.totalCentavos);
  });

  it("reproduz o exemplo do contrato de UC-P03", () => {
    const c = cotar({}, { checkin: "2026-11-20", checkout: "2026-11-23", hospedes: 7 });

    expect(c).toMatchObject({
      noites: 3,
      subtotalDiariasCentavos: 180_000,
      acrescimoHospedesCentavos: 15_000,
      descontoCentavos: 0,
      taxaLimpezaCentavos: 25_000,
      totalCentavos: 220_000,
      minNoitesExigido: 2,
    });
    expect(c.detalhamento).toEqual([
      { tipo: "NOITE", data: "2026-11-20", tarifa: "FIM_DE_SEMANA", rotulo: "Sexta-feira", valorCentavos: 65_000 },
      { tipo: "NOITE", data: "2026-11-21", tarifa: "FIM_DE_SEMANA", rotulo: "Sábado", valorCentavos: 65_000 },
      { tipo: "NOITE", data: "2026-11-22", tarifa: "BASE", rotulo: "Domingo", valorCentavos: 50_000 },
      { tipo: "HOSPEDE_EXTRA", quantidade: 1, rotulo: "1 hóspede extra × 3 noites", valorCentavos: 15_000 },
      { tipo: "TAXA_LIMPEZA", rotulo: "Taxa de limpeza", valorCentavos: 25_000 },
    ]);
  });
});

describe("validarConfigPrecos", () => {
  const codigos = (lista: { codigo: string }[]): string[] => lista.map((p) => p.codigo);

  it("aceita a configuração de exemplo sem erro nem aviso", () => {
    expect(validarConfigPrecos(CONFIG_BASE, HOJE)).toEqual({ erros: [], avisos: [] });
  });

  it("exige centavos inteiros e não negativos", () => {
    const { erros } = validarConfigPrecos({
      ...CONFIG_BASE,
      diariaFimDeSemanaCentavos: 650.5,
      taxaLimpezaCentavos: -1,
    });
    expect(codigos(erros).filter((c) => c === "VALOR_INVALIDO")).toHaveLength(2);
  });

  it("exige diária base maior que zero", () => {
    expect(codigos(validarConfigPrecos({ ...CONFIG_BASE, diariaBaseCentavos: 0 }).erros)).toContain(
      "DIARIA_BASE_OBRIGATORIA",
    );
  });

  it("rejeita dia da semana desconhecido", () => {
    const config = { ...CONFIG_BASE, diasFimDeSemana: ["SEX", "SEXTA"] } as unknown as ConfigPrecos;
    expect(codigos(validarConfigPrecos(config).erros)).toContain("DIA_SEMANA_INVALIDO");
  });

  it("rejeita período invertido e período com data malformada", () => {
    expect(
      codigos(
        validarConfigPrecos({
          ...CONFIG_BASE,
          feriados: [periodo({ inicio: "2026-12-10", fim: "2026-12-05" })],
        }).erros,
      ),
    ).toContain("PERIODO_INVERTIDO");

    expect(
      codigos(
        validarConfigPrecos({
          ...CONFIG_BASE,
          feriados: [periodo({ inicio: "10/12/2026", fim: "2026-12-15" })],
        }).erros,
      ),
    ).toContain("PERIODO_INVERTIDO");
  });

  it("rejeita mínimo de noites do período abaixo de 1", () => {
    expect(
      codigos(validarConfigPrecos({ ...CONFIG_BASE, temporadas: [periodo({ minNoites: 0 })] }).erros),
    ).toContain("PERIODO_MIN_NOITES_INVALIDO");
  });

  it("rejeita identificador de período repetido, inclusive entre listas", () => {
    const { erros } = validarConfigPrecos({
      ...CONFIG_BASE,
      feriados: [periodo({ id: "mesmo" })],
      temporadas: [periodo({ id: "mesmo" })],
    });
    expect(codigos(erros)).toContain("PERIODO_ID_DUPLICADO");
  });

  it("exige hóspedes inclusos dentro da capacidade", () => {
    expect(
      codigos(validarConfigPrecos({ ...CONFIG_BASE, hospedesInclusos: 20 }).erros),
    ).toContain("HOSPEDES_INCLUSOS_INVALIDO");
    expect(
      codigos(validarConfigPrecos({ ...CONFIG_BASE, hospedesInclusos: 0 }).erros),
    ).toContain("HOSPEDES_INCLUSOS_INVALIDO");
  });

  it("exige minNoitesPadrao entre 1 e maxNoites, e maxNoites no limite técnico", () => {
    expect(
      codigos(validarConfigPrecos({ ...CONFIG_BASE, minNoitesPadrao: 0 }).erros),
    ).toContain("MIN_NOITES_PADRAO_INVALIDO");
    expect(
      codigos(validarConfigPrecos({ ...CONFIG_BASE, minNoitesPadrao: 61 }).erros),
    ).toContain("MIN_NOITES_PADRAO_INVALIDO");
    expect(codigos(validarConfigPrecos({ ...CONFIG_BASE, maxNoites: 90 }).erros)).toContain(
      "MAX_NOITES_INVALIDO",
    );
  });

  it("avisa, sem impedir, quando dois períodos da mesma lista se sobrepõem", () => {
    const { erros, avisos } = validarConfigPrecos({
      ...CONFIG_BASE,
      feriados: [
        periodo({ id: "a", nome: "A", inicio: "2026-12-24", fim: "2026-12-26" }),
        periodo({ id: "b", nome: "B", inicio: "2026-12-26", fim: "2026-12-28" }),
      ],
    });

    expect(erros).toEqual([]);
    expect(codigos(avisos)).toContain("PERIODOS_SOBREPOSTOS");
  });

  it("não avisa sobreposição entre um feriado e uma temporada: é o caso esperado", () => {
    const { avisos } = validarConfigPrecos({
      ...CONFIG_BASE,
      feriados: [periodo({ id: "f", inicio: "2026-12-24", fim: "2026-12-26" })],
      temporadas: [periodo({ id: "t", inicio: "2026-12-01", fim: "2026-12-31" })],
    });

    expect(codigos(avisos)).not.toContain("PERIODOS_SOBREPOSTOS");
  });

  it("avisa diária acima de 10x a base: provável valor digitado em reais", () => {
    const { avisos } = validarConfigPrecos({
      ...CONFIG_BASE,
      feriados: [periodo({ nome: "Réveillon", diariaCentavos: 50_000 * 10 + 1 })],
    });
    expect(codigos(avisos)).toContain("DIARIA_MUITO_ALTA");
  });

  it("avisa período inteiramente no passado, só quando recebe hoje", () => {
    const antigo = { ...CONFIG_BASE, temporadas: [periodo({ inicio: "2025-01-01", fim: "2025-01-31" })] };

    expect(codigos(validarConfigPrecos(antigo, HOJE).avisos)).toContain("PERIODO_NO_PASSADO");
    expect(codigos(validarConfigPrecos(antigo).avisos)).not.toContain("PERIODO_NO_PASSADO");
  });

  it("rejeita diária de período zerada ou fracionária", () => {
    for (const diariaCentavos of [0, -1, 700.5]) {
      expect(
        codigos(
          validarConfigPrecos({ ...CONFIG_BASE, feriados: [periodo({ diariaCentavos })] }).erros,
        ),
      ).toContain("VALOR_INVALIDO");
    }
  });

  it("não tenta comparar sobreposição quando a data do período é inválida", () => {
    // Entrada do admin não é confiável: a data malformada vira erro, e a checagem de
    // sobreposição ignora o par em vez de quebrar.
    const { erros, avisos } = validarConfigPrecos({
      ...CONFIG_BASE,
      feriados: [
        periodo({ id: "a", nome: "A", inicio: "24/12/2026", fim: "2026-12-26" }),
        periodo({ id: "b", nome: "B", inicio: "2026-12-24", fim: "2026-12-28" }),
        periodo({ id: "c", nome: "C", inicio: "2026-12-26", fim: "99/99/9999" }),
      ],
    });

    // A e C têm data malformada; B é válido e se sobrepõe a ambos no calendário —
    // nenhum par com data inválida pode gerar aviso de sobreposição.
    expect(codigos(erros).filter((c) => c === "PERIODO_INVERTIDO")).toHaveLength(2);
    expect(codigos(avisos)).not.toContain("PERIODOS_SOBREPOSTOS");
  });

  it("acumula todos os problemas em vez de parar no primeiro", () => {
    const { erros } = validarConfigPrecos({
      ...CONFIG_BASE,
      diariaBaseCentavos: 0,
      minNoitesPadrao: 0,
      maxNoites: 90,
    });
    expect(erros.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Propriedades de docs/03-tecnico/14-estrategia-de-testes.md.
 * A primeira é a invariante de ouro — o caso 15 das regras de preço.
 */
describe("propriedades", () => {
  const arbDataNaJanela = fc
    .integer({ min: 1, max: 700 })
    .map((dias) => somarDias(HOJE, dias));

  const arbPeriodos = (prefixo: string) =>
    fc
      .array(
        fc.tuple(
          arbDataNaJanela,
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 1, max: 400_000 }),
          fc.integer({ min: 1, max: 3 }),
        ),
        { maxLength: 3 },
      )
      .map((lista) =>
        lista.map(([inicio, duracao, diariaCentavos, minNoites], i) => ({
          id: `${prefixo}-${i}`,
          nome: `${prefixo} ${i}`,
          inicio,
          fim: somarDias(inicio, duracao),
          diariaCentavos,
          minNoites,
        })),
      );

  const arbConfig: fc.Arbitrary<ConfigPrecos> = fc.record({
    diariaBaseCentavos: fc.integer({ min: 1, max: 300_000 }),
    diariaFimDeSemanaCentavos: fc.integer({ min: 0, max: 400_000 }),
    diasFimDeSemana: fc.subarray([...DIAS_DA_SEMANA]),
    temporadas: arbPeriodos("temporada"),
    feriados: arbPeriodos("feriado"),
    minNoitesPadrao: fc.integer({ min: 1, max: 3 }),
    maxNoites: fc.constant(MAX_NOITES_PERMITIDO),
    // >= 1 de propósito: a taxa zerada tem teste próprio, e aqui ela sustenta a
    // propriedade de que o detalhamento tem ao menos duas linhas.
    taxaLimpezaCentavos: fc.integer({ min: 1, max: 100_000 }),
    hospedesInclusos: fc.integer({ min: 1, max: 5 }),
    capacidadeMaxima: fc.integer({ min: 5, max: 12 }),
    valorHospedeExtraPorNoiteCentavos: fc.integer({ min: 0, max: 20_000 }),
  });

  const arbEntrada = fc.record({
    checkin: arbDataNaJanela,
    noites: fc.integer({ min: 1, max: 12 }),
    hospedes: fc.integer({ min: 1, max: 12 }),
    descontoCentavos: fc.integer({ min: 0, max: 500_000 }),
  });

  function montar(
    config: ConfigPrecos,
    entrada: { checkin: string; noites: number; hospedes: number; descontoCentavos: number },
  ): EntradaCotacao {
    return {
      checkin: entrada.checkin,
      checkout: somarDias(entrada.checkin, entrada.noites),
      // Clampado para que a propriedade exercite a cotação, e não a validação.
      hospedes: Math.min(entrada.hospedes, config.capacidadeMaxima),
      hoje: HOJE,
      configGeral: CONFIG_GERAL,
      descontoCentavos: entrada.descontoCentavos,
    };
  }

  it("15. a soma do detalhamento é sempre igual ao total (invariante de ouro)", () => {
    fc.assert(
      fc.property(arbConfig, arbEntrada, (config, entrada) => {
        const c = calcularCotacao(config, montar(config, entrada));
        if (ehErroCotacao(c)) return;
        expect(somaDetalhamento(c)).toBe(c.totalCentavos);
      }),
      { numRuns: 500 },
    );
  });

  it("o total nunca é menor que a taxa de limpeza: o desconto não come a limpeza", () => {
    fc.assert(
      fc.property(arbConfig, arbEntrada, (config, entrada) => {
        const c = calcularCotacao(config, montar(config, entrada));
        if (ehErroCotacao(c)) return;
        expect(c.totalCentavos).toBeGreaterThanOrEqual(config.taxaLimpezaCentavos);
      }),
      { numRuns: 500 },
    );
  });

  it("o total é sempre inteiro e não negativo", () => {
    fc.assert(
      fc.property(arbConfig, arbEntrada, (config, entrada) => {
        const c = calcularCotacao(config, montar(config, entrada));
        if (ehErroCotacao(c)) return;
        expect(Number.isInteger(c.totalCentavos)).toBe(true);
        expect(c.totalCentavos).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });

  it("toda cotação válida tem ao menos duas linhas: uma noite e a limpeza", () => {
    fc.assert(
      fc.property(arbConfig, arbEntrada, (config, entrada) => {
        const c = calcularCotacao(config, montar(config, entrada));
        if (ehErroCotacao(c)) return;
        expect(c.detalhamento.length).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 500 },
    );
  });

  it("aumentar o número de hóspedes nunca diminui o total", () => {
    fc.assert(
      fc.property(arbConfig, arbEntrada, (config, entrada) => {
        const base = montar(config, entrada);
        if (base.hospedes >= config.capacidadeMaxima) return;

        const menos = calcularCotacao(config, base);
        const mais = calcularCotacao(config, { ...base, hospedes: base.hospedes + 1 });
        if (ehErroCotacao(menos) || ehErroCotacao(mais)) return;

        expect(mais.totalCentavos).toBeGreaterThanOrEqual(menos.totalCentavos);
      }),
      { numRuns: 500 },
    );
  });

  it("aumentar o número de noites nunca diminui o total", () => {
    fc.assert(
      fc.property(arbConfig, arbEntrada, (config, entrada) => {
        const base = montar(config, entrada);

        const curta = calcularCotacao(config, base);
        const longa = calcularCotacao(config, {
          ...base,
          checkout: somarDias(base.checkout, 1),
        });
        if (ehErroCotacao(curta) || ehErroCotacao(longa)) return;

        expect(longa.totalCentavos).toBeGreaterThanOrEqual(curta.totalCentavos);
      }),
      { numRuns: 500 },
    );
  });
});
