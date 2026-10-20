import { describe, expect, it } from "vitest";

import {
  alterarStatusCasaSchema,
  casaArmazenadaSchema,
  casaEdicaoSchema,
  casaEntradaSchema,
  configPrecosSchema,
  consultaDisponibilidadeSchema,
  dataISOSchema,
  entradaCotacaoPublicaSchema,
  fotoUploadSchema,
  periodoPrecoSchema,
  registrarFotoSchema,
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

describe("casaEntradaSchema (UC-A02)", () => {
  const CASA_VALIDA = {
    nome: "Casa do Lago",
    slug: "casa-do-lago",
    resumo: "Casa de madeira à beira do lago, para até 8 pessoas.",
    descricao:
      "## Sobre a casa\n\nUma casa de madeira espaçosa, com varanda de frente para o lago, ideal para famílias.",
    status: "RASCUNHO",
    ordem: 10,
    destaque: false,
    capacidadeMaxima: 8,
    hospedesInclusos: 6,
    quartos: 3,
    banheiros: 2,
    camas: [
      { tipo: "CASAL", quantidade: 1, ambiente: "Suíte" },
      { tipo: "SOLTEIRO", quantidade: 4, ambiente: "Quarto 2" },
    ],
    comodidades: ["LAGO", "PISCINA", "CHURRASQUEIRA", "WIFI"],
    regras: "- Não são permitidas festas\n- Som até 22h",
    localizacao: {
      enderecoPublico: "Zona rural, Município X - UF",
      enderecoCompleto: "Estrada Y, km 12, Sítio Z",
      lat: -21.123456,
      lng: -45.123456,
      mapaEmbedUrl: "https://www.openstreetmap.org/export/embed.html?bbox=1",
      comoChegar: "Texto em Markdown...",
      distancias: [{ referencia: "Centro da cidade", km: 12 }],
    },
  };

  it("aceita o corpo de exemplo do contrato técnico", () => {
    const resultado = casaEntradaSchema.safeParse(CASA_VALIDA);
    expect(resultado.success).toBe(true);
  });

  it("aceita sem os campos opcionais de localização e sem regras", () => {
    const { regras: _r, ...semRegras } = CASA_VALIDA;
    const minima = {
      ...semRegras,
      localizacao: { enderecoPublico: "Zona rural, Município X - UF" },
    };
    expect(casaEntradaSchema.safeParse(minima).success).toBe(true);
  });

  it("4. slug 'Casa Do Lago!' é rejeitado", () => {
    const resultado = casaEntradaSchema.safeParse({ ...CASA_VALIDA, slug: "Casa Do Lago!" });
    expect(resultado.success).toBe(false);
  });

  it("10. hospedesInclusos 10 com capacidade 8 é rejeitado", () => {
    const resultado = casaEntradaSchema.safeParse({
      ...CASA_VALIDA,
      capacidadeMaxima: 8,
      hospedesInclusos: 10,
    });
    expect(resultado.success).toBe(false);
  });

  it("aceita hospedesInclusos igual à capacidadeMaxima", () => {
    const resultado = casaEntradaSchema.safeParse({
      ...CASA_VALIDA,
      capacidadeMaxima: 8,
      hospedesInclusos: 8,
    });
    expect(resultado.success).toBe(true);
  });

  it("11. comodidade 'PISCINA_AQUECIDA' (fora da lista) é rejeitada", () => {
    const resultado = casaEntradaSchema.safeParse({
      ...CASA_VALIDA,
      comodidades: ["PISCINA_AQUECIDA"],
    });
    expect(resultado.success).toBe(false);
  });

  it("12. mapaEmbedUrl em http:// é rejeitada", () => {
    const resultado = casaEntradaSchema.safeParse({
      ...CASA_VALIDA,
      localizacao: {
        ...CASA_VALIDA.localizacao,
        mapaEmbedUrl: "http://www.openstreetmap.org/embed",
      },
    });
    expect(resultado.success).toBe(false);
  });

  it("13. mapaEmbedUrl em evil.com é rejeitada", () => {
    const resultado = casaEntradaSchema.safeParse({
      ...CASA_VALIDA,
      localizacao: { ...CASA_VALIDA.localizacao, mapaEmbedUrl: "https://evil.com/mapa" },
    });
    expect(resultado.success).toBe(false);
  });

  it("rejeita nome, resumo e descrição fora da faixa de tamanho", () => {
    expect(casaEntradaSchema.safeParse({ ...CASA_VALIDA, nome: "Ab" }).success).toBe(false);
    expect(
      casaEntradaSchema.safeParse({ ...CASA_VALIDA, resumo: "Curto demais" }).success,
    ).toBe(false);
    expect(
      casaEntradaSchema.safeParse({ ...CASA_VALIDA, descricao: "Muito curta" }).success,
    ).toBe(false);
  });

  it("rejeita status fora do enum", () => {
    expect(
      casaEntradaSchema.safeParse({ ...CASA_VALIDA, status: "PUBLICADA" }).success,
    ).toBe(false);
  });

  it("rejeita tipo de cama fora do enum", () => {
    const resultado = casaEntradaSchema.safeParse({
      ...CASA_VALIDA,
      camas: [{ tipo: "SOFA_CAMA", quantidade: 1, ambiente: "Sala" }],
    });
    expect(resultado.success).toBe(false);
  });

  it("rejeita latitude ou longitude fora de faixa", () => {
    expect(
      casaEntradaSchema.safeParse({
        ...CASA_VALIDA,
        localizacao: { ...CASA_VALIDA.localizacao, lat: 200 },
      }).success,
    ).toBe(false);
    expect(
      casaEntradaSchema.safeParse({
        ...CASA_VALIDA,
        localizacao: { ...CASA_VALIDA.localizacao, lng: -200 },
      }).success,
    ).toBe(false);
  });

  it("rejeita distância com km fora de faixa", () => {
    const resultado = casaEntradaSchema.safeParse({
      ...CASA_VALIDA,
      localizacao: {
        ...CASA_VALIDA.localizacao,
        distancias: [{ referencia: "Longe", km: 10_000 }],
      },
    });
    expect(resultado.success).toBe(false);
  });

  it("rejeita ordem, quartos ou banheiros fora da faixa inteira documentada", () => {
    expect(casaEntradaSchema.safeParse({ ...CASA_VALIDA, ordem: -1 }).success).toBe(false);
    expect(casaEntradaSchema.safeParse({ ...CASA_VALIDA, ordem: 10_000 }).success).toBe(
      false,
    );
    expect(casaEntradaSchema.safeParse({ ...CASA_VALIDA, quartos: 51 }).success).toBe(
      false,
    );
  });

  it("rejeita capacidadeMaxima acima de 50 (RN do contrato)", () => {
    expect(
      casaEntradaSchema.safeParse({ ...CASA_VALIDA, capacidadeMaxima: 51 }).success,
    ).toBe(false);
  });
});

describe("casaEdicaoSchema (PUT, E9)", () => {
  const CASA_VALIDA_PARA_EDICAO = {
    nome: "Casa do Lago",
    slug: "casa-do-lago",
    resumo: "Casa de madeira à beira do lago, para até 8 pessoas.",
    descricao:
      "## Sobre a casa\n\nUma casa de madeira espaçosa, com varanda de frente para o lago.",
    status: "ATIVA",
    ordem: 10,
    destaque: false,
    capacidadeMaxima: 8,
    hospedesInclusos: 6,
    quartos: 3,
    banheiros: 2,
    camas: [],
    comodidades: [],
    localizacao: { enderecoPublico: "Zona rural, Município X - UF" },
  };

  it("exige versao, além dos mesmos campos da criação", () => {
    expect(
      casaEdicaoSchema.safeParse({ ...CASA_VALIDA_PARA_EDICAO, versao: 3 }).success,
    ).toBe(true);
    expect(casaEdicaoSchema.safeParse(CASA_VALIDA_PARA_EDICAO).success).toBe(false);
  });

  it("rejeita versao negativa ou fracionária", () => {
    expect(
      casaEdicaoSchema.safeParse({ ...CASA_VALIDA_PARA_EDICAO, versao: -1 }).success,
    ).toBe(false);
    expect(
      casaEdicaoSchema.safeParse({ ...CASA_VALIDA_PARA_EDICAO, versao: 1.5 }).success,
    ).toBe(false);
  });
});

describe("alterarStatusCasaSchema", () => {
  it("aceita os três valores de status", () => {
    for (const status of ["RASCUNHO", "ATIVA", "INATIVA"]) {
      expect(alterarStatusCasaSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejeita valor fora do enum", () => {
    expect(alterarStatusCasaSchema.safeParse({ status: "PUBLICADA" }).success).toBe(false);
  });
});

describe("casaArmazenadaSchema", () => {
  const CASA_ARMAZENADA_VALIDA = {
    nome: "Casa do Lago",
    slug: "casa-do-lago",
    resumo: "Casa de madeira à beira do lago, para até 8 pessoas.",
    descricao:
      "## Sobre a casa\n\nUma casa de madeira espaçosa, com varanda de frente para o lago.",
    status: "ATIVA",
    ordem: 10,
    destaque: false,
    capacidadeMaxima: 8,
    hospedesInclusos: 6,
    quartos: 3,
    banheiros: 2,
    camas: [],
    comodidades: [],
    localizacao: { enderecoPublico: "Zona rural, Município X - UF" },
    casaId: ULID_VALIDO,
    fotos: [],
    tokenIcal: "token-de-teste",
    publicacaoPendente: false,
    versao: 0,
    criadoEm: "2026-10-17T12:00:00-03:00",
    atualizadoEm: "2026-10-17T12:00:00-03:00",
    atualizadoPor: ULID_VALIDO,
  };

  it("aceita o item completo como persistido", () => {
    expect(casaArmazenadaSchema.safeParse(CASA_ARMAZENADA_VALIDA).success).toBe(true);
  });

  it("aceita com fotos preenchidas", () => {
    const comFoto = {
      ...CASA_ARMAZENADA_VALIDA,
      fotos: [
        {
          fotoId: ULID_VALIDO,
          chave: "midia/casas/01HQ.../fachada.webp",
          largura: 1600,
          altura: 1067,
          bytes: 184_320,
          legenda: "Fachada",
          textoAlternativo: "Casa de madeira vista do lago",
          ordem: 10,
          principal: true,
          enviadaEm: "2026-10-11T18:04:00-03:00",
        },
      ],
    };
    expect(casaArmazenadaSchema.safeParse(comFoto).success).toBe(true);
  });

  it("rejeita sem os campos que só existem depois de criada", () => {
    const { casaId: _c, tokenIcal: _t, versao: _v, ...semCamposPersistidos } = CASA_ARMAZENADA_VALIDA;
    expect(casaArmazenadaSchema.safeParse(semCamposPersistidos).success).toBe(false);
  });

  it("rejeita foto com formato inválido", () => {
    const comFotoInvalida = {
      ...CASA_ARMAZENADA_VALIDA,
      fotos: [{ fotoId: "não-é-ulid", chave: "x", principal: true }],
    };
    expect(casaArmazenadaSchema.safeParse(comFotoInvalida).success).toBe(false);
  });
});

describe("fotoUploadSchema (UC-A03)", () => {
  const UPLOAD_VALIDO = { contentType: "image/webp", nomeOriginal: "fachada.jpg", bytes: 184_320 };

  it("aceita o corpo do contrato técnico", () => {
    expect(fotoUploadSchema.safeParse(UPLOAD_VALIDO).success).toBe(true);
  });

  it("aceita os três formatos de RN2", () => {
    for (const contentType of ["image/webp", "image/jpeg", "image/png"]) {
      expect(fotoUploadSchema.safeParse({ ...UPLOAD_VALIDO, contentType }).success).toBe(true);
    }
  });

  it("RN2 (allowlist de formato) não é responsabilidade deste schema — aceita SVG como forma válida", () => {
    // A rejeição de verdade (422 TIPO_NAO_SUPORTADO) é regra de negócio do
    // handler, contra TIPOS_FOTO_ACEITOS — ver o comentário do próprio schema.
    expect(
      fotoUploadSchema.safeParse({ ...UPLOAD_VALIDO, contentType: "image/svg+xml" }).success,
    ).toBe(true);
  });

  it("rejeita contentType vazio — isso sim é forma", () => {
    expect(fotoUploadSchema.safeParse({ ...UPLOAD_VALIDO, contentType: "" }).success).toBe(false);
  });

  it("rejeita bytes zero ou negativo", () => {
    expect(fotoUploadSchema.safeParse({ ...UPLOAD_VALIDO, bytes: 0 }).success).toBe(false);
    expect(fotoUploadSchema.safeParse({ ...UPLOAD_VALIDO, bytes: -1 }).success).toBe(false);
  });

  it("não impõe o teto de 3 MB de RN3 — é informativo; a policy do S3 é que aplica", () => {
    // Ver o comentário do próprio schema: bytes aqui não é a aplicação da regra.
    expect(fotoUploadSchema.safeParse({ ...UPLOAD_VALIDO, bytes: 20_000_000 }).success).toBe(true);
  });

  it("rejeita nomeOriginal vazio", () => {
    expect(fotoUploadSchema.safeParse({ ...UPLOAD_VALIDO, nomeOriginal: "" }).success).toBe(false);
  });
});

describe("registrarFotoSchema (UC-A03)", () => {
  const REGISTRO_VALIDO = {
    chave: "midia/casas/01HQ.../01HR9A-a3f9c1.webp",
    textoAlternativo: "Casa de madeira com varanda, vista do lago ao fundo",
    legenda: "Fachada vista do lago",
    principal: false,
  };

  it("aceita o corpo do contrato técnico", () => {
    expect(registrarFotoSchema.safeParse(REGISTRO_VALIDO).success).toBe(true);
  });

  it("aceita sem legenda nem principal — RN6, os dois são opcionais", () => {
    const { legenda: _l, principal: _p, ...semOpcionais } = REGISTRO_VALIDO;
    expect(registrarFotoSchema.safeParse(semOpcionais).success).toBe(true);
  });

  it("RN5: rejeita sem textoAlternativo ou com ele vazio", () => {
    const { textoAlternativo: _t, ...semTexto } = REGISTRO_VALIDO;
    expect(registrarFotoSchema.safeParse(semTexto).success).toBe(false);
    expect(
      registrarFotoSchema.safeParse({ ...REGISTRO_VALIDO, textoAlternativo: "" }).success,
    ).toBe(false);
  });

  it("rejeita sem chave ou com ela vazia", () => {
    const { chave: _c, ...semChave } = REGISTRO_VALIDO;
    expect(registrarFotoSchema.safeParse(semChave).success).toBe(false);
    expect(registrarFotoSchema.safeParse({ ...REGISTRO_VALIDO, chave: "" }).success).toBe(false);
  });
});
