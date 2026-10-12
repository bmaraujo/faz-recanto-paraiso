import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { compararDatas, noitesDe, somarDias, somarMeses } from "../src/dominio/datas";
import {
  type OcupacaoNoite,
  MAX_MESES_CONSULTA_DISPONIBILIDADE,
  agruparNoitesContiguas,
  ehErroConsultaDisponibilidade,
  listarNoitesOcupadas,
  noitesOcupadasEm,
  ocupacaoEstaAtiva,
  validarIntervaloConsulta,
  verificarDisponibilidade,
} from "../src/dominio/disponibilidade";

const AGORA = new Date("2026-11-15T12:00:00-03:00");

function ocupacao(dados: Partial<OcupacaoNoite> & { data: string }): OcupacaoNoite {
  return dados;
}

/**
 * Os 14 casos obrigatórios de docs/01-negocio/01-regras-de-disponibilidade.md.
 *
 * Nem todos pertencem a este módulo puro:
 *
 * - **Casos 6-11** (mínimo/máximo de noites, antecedência, janela, capacidade) são
 *   validados por `calcularCotacao`, reaproveitado também na criação da solicitação
 *   (UC-P04, RN5) — já cobertos em `precos.test.ts`. Repeti-los aqui divergiria com
 *   o tempo, que é exatamente o problema que a função compartilhada evita.
 * - **Caso 5** (duas solicitações simultâneas) exige a transação real do DynamoDB —
 *   é teste de integração da Fase 2 (`test/integracao/concorrencia.test.ts` na
 *   documentação), não algo que uma função pura possa exercitar.
 * - **Casos 12-13** (conflito de importação iCal, exportação sem eventos `EXTERNO`)
 *   pertencem a `lib/ical.ts`, Fase 4.
 *
 * Os casos 1-4 e 14 são deste módulo e estão todos abaixo.
 */
describe("casos obrigatórios", () => {
  it("1. check-out no dia do check-in de outra reserva: ambas válidas", () => {
    // Reserva existente: check-in 17, check-out 20 → ocupa 17, 18, 19.
    const ocupadas = noitesOcupadasEm(
      [ocupacao({ data: "2026-11-17" }), ocupacao({ data: "2026-11-18" }), ocupacao({ data: "2026-11-19" })],
      AGORA,
    );

    // Uma segunda reserva com check-in no dia 20 (o próprio check-out) não colide.
    expect(verificarDisponibilidade(ocupadas, "2026-11-20", "2026-11-23")).toEqual({
      disponivel: true,
    });
    // Mas check-in no dia 19 colide, porque 19 é noite ocupada.
    expect(verificarDisponibilidade(ocupadas, "2026-11-19", "2026-11-21")).toMatchObject({
      disponivel: false,
      noitesIndisponiveis: ["2026-11-19"],
    });
  });

  it("2. noite ocupada na Casa A não afeta a Casa B (por construção)", () => {
    // R2 é garantida pela própria assinatura das funções: cada chamada recebe a lista
    // de ocupações de **uma** casa. Não há parâmetro de casa a confundir.
    const ocupadasCasaA = noitesOcupadasEm([ocupacao({ data: "2026-11-20" })], AGORA);
    const ocupadasCasaB = noitesOcupadasEm([], AGORA);

    expect(verificarDisponibilidade(ocupadasCasaA, "2026-11-20", "2026-11-21")).toMatchObject({
      disponivel: false,
    });
    expect(verificarDisponibilidade(ocupadasCasaB, "2026-11-20", "2026-11-21")).toEqual({
      disponivel: true,
    });
  });

  it("3. solicitação sobre noite pendente não vencida: indisponível", () => {
    const ocupacoes = [
      ocupacao({ data: "2026-11-20", pendente: true, expiraEm: "2026-11-17T12:00:00-03:00" }),
    ];
    // expiraEm é no futuro em relação a AGORA (2026-11-15 12:00).
    expect(ocupacaoEstaAtiva(ocupacoes[0] as OcupacaoNoite, AGORA)).toBe(true);
    expect(
      verificarDisponibilidade(noitesOcupadasEm(ocupacoes, AGORA), "2026-11-20", "2026-11-21"),
    ).toMatchObject({ disponivel: false, noitesIndisponiveis: ["2026-11-20"] });
  });

  it("4. solicitação sobre noite pendente vencida: aceita", () => {
    const ocupacoes = [
      ocupacao({ data: "2026-11-20", pendente: true, expiraEm: "2026-11-10T12:00:00-03:00" }),
    ];
    // expiraEm já passou em relação a AGORA.
    expect(ocupacaoEstaAtiva(ocupacoes[0] as OcupacaoNoite, AGORA)).toBe(false);
    expect(
      verificarDisponibilidade(noitesOcupadasEm(ocupacoes, AGORA), "2026-11-20", "2026-11-21"),
    ).toEqual({ disponivel: true });
    // E nem aparece na lista pública de noites ocupadas.
    expect(listarNoitesOcupadas(ocupacoes, AGORA)).toEqual([]);
  });

  it("14. a resposta de disponibilidade pública não contém nenhum dado além de datas", () => {
    const ocupacoes: OcupacaoNoite[] = [
      { data: "2026-11-20" },
      { data: "2026-11-21", pendente: true, expiraEm: "2026-12-01T00:00:00-03:00" },
    ];

    const resultado = listarNoitesOcupadas(ocupacoes, AGORA);

    expect(resultado).toEqual(["2026-11-20", "2026-11-21"]);
    // O tipo de retorno (DataISO[]) já garante isto por construção: não há como um
    // tipo, refId ou nome de hóspede vazar por aqui, mesmo com refatoração futura.
    for (const item of resultado) {
      expect(typeof item).toBe("string");
    }
  });
});

describe("ocupacaoEstaAtiva", () => {
  it("ocupação sem pendência é sempre ativa, independentemente de expiraEm", () => {
    expect(ocupacaoEstaAtiva({ pendente: false }, AGORA)).toBe(true);
    expect(ocupacaoEstaAtiva({}, AGORA)).toBe(true);
  });

  it("pendência sem expiraEm (dado inconsistente) é tratada como ativa", () => {
    // Defensivo: na prática pendente=true sempre vem com expiraEm (modelo de dados),
    // mas se um registro corrompido chegar aqui, o lado seguro é tratar como ocupado.
    expect(ocupacaoEstaAtiva({ pendente: true }, AGORA)).toBe(true);
  });

  it("compara o instante, não o dia — expira no meio do dia, não à meia-noite", () => {
    const expiraEm = "2026-11-15T12:00:00-03:00"; // == AGORA
    expect(ocupacaoEstaAtiva({ pendente: true, expiraEm }, new Date("2026-11-15T11:59:59-03:00"))).toBe(
      true,
    );
    expect(ocupacaoEstaAtiva({ pendente: true, expiraEm }, new Date("2026-11-15T12:00:01-03:00"))).toBe(
      false,
    );
  });
});

describe("noitesOcupadasEm e listarNoitesOcupadas", () => {
  it("deduplica datas repetidas entre registros diferentes", () => {
    const ocupacoes = [ocupacao({ data: "2026-11-20" }), ocupacao({ data: "2026-11-20" })];
    expect(noitesOcupadasEm(ocupacoes, AGORA).size).toBe(1);
  });

  it("ordena a saída cronologicamente, mesmo que a entrada venha fora de ordem", () => {
    const ocupacoes = [
      ocupacao({ data: "2027-01-02" }),
      ocupacao({ data: "2026-12-31" }),
      ocupacao({ data: "2026-12-30" }),
    ];
    expect(listarNoitesOcupadas(ocupacoes, AGORA)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-02",
    ]);
  });

  it("lista vazia para uma casa sem nenhuma ocupação", () => {
    expect(listarNoitesOcupadas([], AGORA)).toEqual([]);
  });
});

describe("verificarDisponibilidade", () => {
  it("aceita tanto Set quanto array de datas ocupadas", () => {
    expect(verificarDisponibilidade(new Set(["2026-11-20"]), "2026-11-20", "2026-11-21")).toMatchObject({
      disponivel: false,
    });
    expect(verificarDisponibilidade(["2026-11-20"], "2026-11-20", "2026-11-21")).toMatchObject({
      disponivel: false,
    });
  });

  it("lista todas as noites em conflito, não só a primeira", () => {
    const resultado = verificarDisponibilidade(
      ["2026-11-20", "2026-11-22"],
      "2026-11-19",
      "2026-11-23",
    );
    expect(resultado).toMatchObject({
      disponivel: false,
      noitesIndisponiveis: ["2026-11-20", "2026-11-22"],
    });
  });

  it("conjunto vazio de ocupadas: qualquer estadia está disponível", () => {
    expect(verificarDisponibilidade(new Set(), "2026-11-20", "2026-11-23")).toEqual({
      disponivel: true,
    });
  });
});

describe("validarIntervaloConsulta", () => {
  it("aceita um intervalo dentro do limite", () => {
    const resultado = validarIntervaloConsulta("2026-11-01", "2027-01-31");
    expect(ehErroConsultaDisponibilidade(resultado)).toBe(false);
    expect(resultado).toEqual({ de: "2026-11-01", ate: "2027-01-31" });
  });

  it("7. consulta de 14 meses é rejeitada; 13 meses exatos é aceita", () => {
    const longoDemais = validarIntervaloConsulta("2026-11-01", somarMeses("2026-11-01", 14));
    expect(longoDemais).toMatchObject({ erro: "INTERVALO_MUITO_LONGO" });

    const noLimite = validarIntervaloConsulta(
      "2026-11-01",
      somarMeses("2026-11-01", MAX_MESES_CONSULTA_DISPONIBILIDADE),
    );
    expect(ehErroConsultaDisponibilidade(noLimite)).toBe(false);
  });

  it("8. de > ate é rejeitado", () => {
    expect(validarIntervaloConsulta("2026-11-23", "2026-11-20")).toMatchObject({
      erro: "ENTRADA_INVALIDA",
    });
  });

  it("de === ate é aceito (consulta de um único dia)", () => {
    expect(ehErroConsultaDisponibilidade(validarIntervaloConsulta("2026-11-20", "2026-11-20"))).toBe(
      false,
    );
  });

  it("rejeita data malformada, nomeando o campo", () => {
    expect(validarIntervaloConsulta("20/11/2026", "2026-11-23")).toMatchObject({
      erro: "ENTRADA_INVALIDA",
      detalhes: { campo: "de" },
    });
    expect(validarIntervaloConsulta("2026-11-20", "2026-02-30")).toMatchObject({
      erro: "ENTRADA_INVALIDA",
      detalhes: { campo: "ate" },
    });
  });
});

describe("agruparNoitesContiguas", () => {
  it("agrupa um único bloco de noites consecutivas", () => {
    expect(agruparNoitesContiguas(noitesDe("2026-11-10", "2026-11-13"))).toEqual([
      { inicio: "2026-11-10", fim: "2026-11-12" },
    ]);
  });

  it("separa blocos quando há um buraco", () => {
    expect(agruparNoitesContiguas(["2026-11-10", "2026-11-11", "2026-11-20"])).toEqual([
      { inicio: "2026-11-10", fim: "2026-11-11" },
      { inicio: "2026-11-20", fim: "2026-11-20" },
    ]);
  });

  it("ordena e deduplica antes de agrupar, mesmo com entrada fora de ordem ou repetida", () => {
    expect(agruparNoitesContiguas(["2026-11-11", "2026-11-10", "2026-11-10", "2026-11-12"])).toEqual([
      { inicio: "2026-11-10", fim: "2026-11-12" },
    ]);
  });

  it("lista vazia produz nenhum período", () => {
    expect(agruparNoitesContiguas([])).toEqual([]);
  });

  it("vira o ano sem quebrar o bloco (2026-12-31 → 2027-01-01)", () => {
    expect(agruparNoitesContiguas(["2026-12-30", "2026-12-31", "2027-01-01"])).toEqual([
      { inicio: "2026-12-30", fim: "2027-01-01" },
    ]);
  });
});

/** Propriedades que protegem este módulo de refatoração futura. */
describe("propriedades", () => {
  const arbData = fc
    .date({
      min: new Date("2020-01-01T00:00:00Z"),
      max: new Date("2060-12-31T00:00:00Z"),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10));

  it("toda noite listada por agruparNoitesContiguas pertence a exatamente um período", () => {
    fc.assert(
      fc.property(fc.array(arbData, { minLength: 0, maxLength: 60 }), (noites) => {
        const periodos = agruparNoitesContiguas(noites);
        const entradaUnica = [...new Set(noites)];

        const totalNosPeríodos = periodos.reduce(
          (soma, p) => soma + noitesDe(p.inicio, somarDias(p.fim, 1)).length,
          0,
        );
        expect(totalNosPeríodos).toBe(entradaUnica.length);

        // Os períodos vêm ordenados e sem sobreposição.
        for (let i = 1; i < periodos.length; i += 1) {
          expect(compararDatas(periodos[i - 1]!.fim, periodos[i]!.inicio)).toBeLessThan(0);
        }
      }),
    );
  });

  it("verificarDisponibilidade concorda com uma checagem noite a noite", () => {
    fc.assert(
      fc.property(
        fc.array(arbData, { maxLength: 30 }),
        arbData,
        fc.integer({ min: 1, max: 20 }),
        (ocupadas, checkin, duracao) => {
          const ocupadasSet = new Set(ocupadas);
          const checkout = somarDias(checkin, duracao);
          const noites = noitesDe(checkin, checkout);

          const esperado = noites.filter((n) => ocupadasSet.has(n));
          const resultado = verificarDisponibilidade(ocupadasSet, checkin, checkout);

          if (esperado.length === 0) {
            expect(resultado).toEqual({ disponivel: true });
          } else {
            expect(resultado).toEqual({ disponivel: false, noitesIndisponiveis: esperado });
          }
        },
      ),
    );
  });

  it("uma pendência vencida nunca aparece em listarNoitesOcupadas", () => {
    fc.assert(
      fc.property(arbData, fc.integer({ min: -1000, max: 1000 }), (data, deltaHoras) => {
        const expiraEm = new Date(AGORA.getTime() + deltaHoras * 3_600_000).toISOString();
        const ocupacoes: OcupacaoNoite[] = [{ data, pendente: true, expiraEm }];

        const vencida = new Date(expiraEm).getTime() <= AGORA.getTime();
        expect(listarNoitesOcupadas(ocupacoes, AGORA).includes(data)).toBe(!vencida);
      }),
    );
  });
});
