import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { ConfigGeral, ConfigPrecos } from "@recanto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ItemOcupacao } from "../../../src/lib/db";
import { criarEvento } from "../../evento-teste";

const { obterStatusCasa, consultarOcupacoes, obterConfigPrecos, obterConfigGeral } = vi.hoisted(
  () => ({
    obterStatusCasa: vi.fn<(casaId: string) => Promise<string | undefined>>(),
    consultarOcupacoes:
      vi.fn<(casaId: string, de: string, ate: string) => Promise<ItemOcupacao[]>>(),
    obterConfigPrecos: vi.fn<(casaId: string) => Promise<ConfigPrecos | undefined>>(),
    obterConfigGeral: vi.fn<() => Promise<ConfigGeral>>(),
  }),
);

vi.mock("../../../src/lib/db", () => ({
  obterStatusCasa,
  consultarOcupacoes,
  obterConfigPrecos,
  obterConfigGeral,
}));

import { handler } from "../../../src/handlers/api-publica";

const CONFIG_GERAL_PADRAO: ConfigGeral = {
  nomeFazenda: "Recanto Paraíso",
  whatsapp: "+5511999999999",
  emailAdmin: "proprietario@exemplo.com.br",
  emailRemetente: "reservas@exemplo.com.br",
  emailResponder: "proprietario@exemplo.com.br",
  prazoSolicitacaoHoras: 48,
  antecedenciaMinimaDias: 1,
  janelaReservaMeses: 12,
  horarioCheckin: "14:00",
  horarioCheckout: "12:00",
  maxSolicitacoesPendentesPorEmail: 3,
  faixasCancelamento: [{ diasMinimos: 30, percentualDevolucao: 100 }],
  devolveTaxaLimpeza: true,
  textoCancelamento: "...",
  textoPrivacidade: "...",
  textoTermos: "...",
  textoRegrasGerais: "...",
  faq: [],
};

describe("GET /api/saude", () => {
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.STAGE;
    delete process.env.VERSAO;
  });

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
  });

  it("responde 200 com ok, stage e versao", async () => {
    process.env.STAGE = "prod";
    process.env.VERSAO = "2026.10.12-a1b2c3d";

    const resposta = await handler(criarEvento("GET", "/api/saude"));

    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body as string)).toMatchObject({
      ok: true,
      stage: "prod",
      versao: "2026.10.12-a1b2c3d",
    });
  });

  it("inclui 'em' como um instante ISO 8601 válido", async () => {
    const resposta = await handler(criarEvento("GET", "/api/saude"));
    const corpo = JSON.parse(resposta.body as string) as { em: string };

    expect(Number.isNaN(new Date(corpo.em).getTime())).toBe(false);
  });

  it("usa valores padrão quando STAGE/VERSAO não estão definidas", async () => {
    const resposta = await handler(criarEvento("GET", "/api/saude"));

    expect(JSON.parse(resposta.body as string)).toMatchObject({
      stage: "dev",
      versao: "dev-local",
    });
  });

  it("responde em application/json; charset=utf-8", async () => {
    const resposta = await handler(criarEvento("GET", "/api/saude"));
    expect(resposta.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
    });
  });
});

describe("rota não encontrada", () => {
  it("responde 404 com o envelope de erro do contrato para caminho inexistente", async () => {
    const resposta = await handler(criarEvento("GET", "/api/rota-que-nao-existe"));

    expect(resposta.statusCode).toBe(404);
    expect(JSON.parse(resposta.body as string)).toEqual({
      erro: "NAO_ENCONTRADO",
      mensagem: "Rota não encontrada.",
      detalhes: {},
    });
  });

  it("responde 404 para o método errado na mesma rota", async () => {
    const resposta = await handler(criarEvento("POST", "/api/saude"));
    expect(resposta.statusCode).toBe(404);
  });
});

describe("GET /api/casas/{casaId}/disponibilidade", () => {
  const CASA_ID = "01HQZZZZZZZZZZZZZZZZZZZZZZ";

  beforeEach(() => {
    obterStatusCasa.mockReset();
    consultarOcupacoes.mockReset();
  });

  function evento(
    casaId: string,
    query: Record<string, string | undefined>,
  ): APIGatewayProxyEventV2 {
    return criarEvento("GET", `/api/casas/${casaId}/disponibilidade`, {
      queryStringParameters: query,
    });
  }

  it("valida de/ate antes de consultar o banco (sem DB em entrada inválida)", async () => {
    const resposta = await handler(evento(CASA_ID, { de: "2026-11-23", ate: "2026-11-20" }));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "ENTRADA_INVALIDA" });
    expect(obterStatusCasa).not.toHaveBeenCalled();
    expect(consultarOcupacoes).not.toHaveBeenCalled();
  });

  it("responde 400 quando de/ate estão ausentes", async () => {
    const resposta = await handler(evento(CASA_ID, {}));
    expect(resposta.statusCode).toBe(400);
  });

  it("responde 422 quando o intervalo passa de 13 meses", async () => {
    const resposta = await handler(evento(CASA_ID, { de: "2026-11-01", ate: "2028-01-01" }));

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "INTERVALO_MUITO_LONGO" });
    expect(obterStatusCasa).not.toHaveBeenCalled();
  });

  it("responde 404 quando a casa não existe", async () => {
    obterStatusCasa.mockResolvedValue(undefined);

    const resposta = await handler(evento(CASA_ID, { de: "2026-11-01", ate: "2026-11-30" }));

    expect(resposta.statusCode).toBe(404);
    expect(consultarOcupacoes).not.toHaveBeenCalled();
  });

  it("responde 404 quando a casa está RASCUNHO ou INATIVA (não revela o status)", async () => {
    obterStatusCasa.mockResolvedValue("INATIVA");

    const resposta = await handler(evento(CASA_ID, { de: "2026-11-01", ate: "2026-11-30" }));

    expect(resposta.statusCode).toBe(404);
    expect(JSON.parse(resposta.body as string)).toEqual({
      erro: "NAO_ENCONTRADO",
      mensagem: "Casa não encontrada.",
      detalhes: {},
    });
  });

  it("devolve as noites ocupadas, excluindo pendência vencida (R4)", async () => {
    obterStatusCasa.mockResolvedValue("ATIVA");
    consultarOcupacoes.mockResolvedValue([
      { SK: "NOITE#2026-11-20" },
      { SK: "NOITE#2026-11-21", pendente: true, expiraEm: "2099-01-01T00:00:00Z" },
      { SK: "NOITE#2026-11-22", pendente: true, expiraEm: "2000-01-01T00:00:00Z" },
    ]);

    const resposta = await handler(evento(CASA_ID, { de: "2026-11-01", ate: "2026-11-30" }));

    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body as string)).toEqual({
      casaId: CASA_ID,
      de: "2026-11-01",
      ate: "2026-11-30",
      noitesOcupadas: ["2026-11-20", "2026-11-21"],
      geradoEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/) as unknown as string,
    });
    expect(consultarOcupacoes).toHaveBeenCalledWith(CASA_ID, "2026-11-01", "2026-11-30");
  });

  it("não devolve nenhum campo além dos cinco do contrato (R11/RN4)", async () => {
    obterStatusCasa.mockResolvedValue("ATIVA");
    consultarOcupacoes.mockResolvedValue([]);

    const resposta = await handler(evento(CASA_ID, { de: "2026-11-01", ate: "2026-11-30" }));
    const corpo = JSON.parse(resposta.body as string) as Record<string, unknown>;

    expect(Object.keys(corpo).sort()).toEqual(["ate", "casaId", "de", "geradoEm", "noitesOcupadas"]);
  });

  it("responde com Cache-Control: public, max-age=60 (contrato técnico do UC-P02)", async () => {
    obterStatusCasa.mockResolvedValue("ATIVA");
    consultarOcupacoes.mockResolvedValue([]);

    const resposta = await handler(evento(CASA_ID, { de: "2026-11-01", ate: "2026-11-30" }));

    expect(resposta.headers).toMatchObject({ "cache-control": "public, max-age=60" });
  });
});

describe("POST /api/cotacao", () => {
  const CASA_ID = "01HQZZZZZZZZZZZZZZZZZZZZZZ";

  // Mesma configuração e mesma estadia do exemplo de
  // docs/02-casos-de-uso/publico/UC-P03-simular-preco.md#contrato-técnico —
  // os números do teste batem com os da documentação de propósito.
  const CONFIG_PRECOS: ConfigPrecos = {
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

  const CORPO_VALIDO = {
    casaId: CASA_ID,
    checkin: "2026-11-20",
    checkout: "2026-11-23",
    hospedes: 7,
  };

  function evento(corpo: unknown, extras: Partial<APIGatewayProxyEventV2> = {}) {
    return criarEvento("POST", "/api/cotacao", {
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
      ...extras,
    });
  }

  beforeEach(() => {
    obterStatusCasa.mockReset();
    obterConfigPrecos.mockReset();
    obterConfigGeral.mockReset();
    consultarOcupacoes.mockReset();

    // "hoje" fixo: calcularCotacao valida antecedência/janela contra a data real.
    // Só `Date` (ver test/integracao/cotacao.test.ts) — aqui não há I/O real, mas
    // mantém o mesmo hábito em vez de fakear timers que ninguém pediu.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));

    obterStatusCasa.mockResolvedValue("ATIVA");
    obterConfigPrecos.mockResolvedValue(CONFIG_PRECOS);
    obterConfigGeral.mockResolvedValue(CONFIG_GERAL_PADRAO);
    consultarOcupacoes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recalcula a cotação e bate com o exemplo do contrato técnico (UC-P03)", async () => {
    const resposta = await handler(evento(CORPO_VALIDO));

    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body as string)).toMatchObject({
      noites: 3,
      subtotalDiariasCentavos: 180_000,
      acrescimoHospedesCentavos: 15_000,
      descontoCentavos: 0,
      taxaLimpezaCentavos: 25_000,
      totalCentavos: 220_000,
      minNoitesExigido: 2,
      disponivel: true,
      noitesIndisponiveis: [],
      estimativa: true,
      avisoEstimativa: "Valor estimado. O valor final é confirmado pelo proprietário.",
    });
  });

  it("consulta a ocupação com exatamente checkin/checkout do pedido", async () => {
    await handler(evento(CORPO_VALIDO));
    expect(consultarOcupacoes).toHaveBeenCalledWith(CASA_ID, "2026-11-20", "2026-11-23");
  });

  it("responde 200 com disponivel:false quando há noite ocupada (A6 — nunca bloqueia pelo preço)", async () => {
    consultarOcupacoes.mockResolvedValue([{ SK: "NOITE#2026-11-21" }]);

    const resposta = await handler(evento(CORPO_VALIDO));
    const corpo = JSON.parse(resposta.body as string) as {
      disponivel: boolean;
      noitesIndisponiveis: string[];
      totalCentavos: number;
    };

    expect(resposta.statusCode).toBe(200);
    expect(corpo.disponivel).toBe(false);
    expect(corpo.noitesIndisponiveis).toEqual(["2026-11-21"]);
    expect(corpo.totalCentavos).toBe(220_000);
  });

  it("responde 404 quando a casa não existe (sem ler preço nem ocupação)", async () => {
    obterStatusCasa.mockResolvedValue(undefined);

    const resposta = await handler(evento(CORPO_VALIDO));

    expect(resposta.statusCode).toBe(404);
    expect(obterConfigPrecos).not.toHaveBeenCalled();
    expect(consultarOcupacoes).not.toHaveBeenCalled();
  });

  it("responde 404 quando a casa está INATIVA/RASCUNHO", async () => {
    obterStatusCasa.mockResolvedValue("RASCUNHO");
    const resposta = await handler(evento(CORPO_VALIDO));
    expect(resposta.statusCode).toBe(404);
  });

  it("responde 404 quando a casa está ativa mas sem preços configurados (E4)", async () => {
    obterConfigPrecos.mockResolvedValue(undefined);

    const resposta = await handler(evento(CORPO_VALIDO));

    expect(resposta.statusCode).toBe(404);
    expect(consultarOcupacoes).not.toHaveBeenCalled();
  });

  it("responde 422 com o código de domínio quando a capacidade é excedida", async () => {
    const resposta = await handler(evento({ ...CORPO_VALIDO, hospedes: 99 }));

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({
      erro: "CAPACIDADE_EXCEDIDA",
      detalhes: { capacidadeMaxima: 10 },
    });
    expect(consultarOcupacoes).not.toHaveBeenCalled();
  });

  it("responde 400 quando o corpo está ausente", async () => {
    const resposta = await handler(criarEvento("POST", "/api/cotacao"));
    expect(resposta.statusCode).toBe(400);
  });

  it("responde 400 quando o corpo não é JSON válido", async () => {
    const resposta = await handler(evento("{isto nao e json"));
    expect(resposta.statusCode).toBe(400);
  });

  it("responde 400 com os campos inválidos quando o schema rejeita a entrada", async () => {
    const resposta = await handler(evento({ ...CORPO_VALIDO, casaId: "nao-e-um-ulid" }));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({
      erro: "ENTRADA_INVALIDA",
      detalhes: { campos: ["casaId"] },
    });
  });

  it("responde 413 quando o corpo excede 1 KB, antes de validar o schema", async () => {
    const corpoGrande = { ...CORPO_VALIDO, lixo: "x".repeat(2000) };

    const resposta = await handler(evento(corpoGrande));

    expect(resposta.statusCode).toBe(413);
    expect(obterStatusCasa).not.toHaveBeenCalled();
  });
});

describe("GET /api/config-publica", () => {
  beforeEach(() => {
    obterConfigGeral.mockReset();
  });

  it("responde 200 só com os campos públicos de RN14 (UC-A13)", async () => {
    obterConfigGeral.mockResolvedValue(CONFIG_GERAL_PADRAO);

    const resposta = await handler(criarEvento("GET", "/api/config-publica"));
    const corpo = JSON.parse(resposta.body as string) as Record<string, unknown>;

    expect(resposta.statusCode).toBe(200);
    expect(Object.keys(corpo).sort()).toEqual(
      [
        "antecedenciaMinimaDias",
        "devolveTaxaLimpeza",
        "faixasCancelamento",
        "faq",
        "horarioCheckin",
        "horarioCheckout",
        "janelaReservaMeses",
        "nomeFazenda",
        "textoCancelamento",
        "textoPrivacidade",
        "textoRegrasGerais",
        "textoTermos",
        "whatsapp",
      ].sort(),
    );
  });

  it("nunca inclui emailAdmin, emailRemetente, emailResponder, prazoSolicitacaoHoras ou maxSolicitacoesPendentesPorEmail", async () => {
    obterConfigGeral.mockResolvedValue(CONFIG_GERAL_PADRAO);

    const resposta = await handler(criarEvento("GET", "/api/config-publica"));
    const corpo = JSON.parse(resposta.body as string) as Record<string, unknown>;

    expect(corpo.emailAdmin).toBeUndefined();
    expect(corpo.emailRemetente).toBeUndefined();
    expect(corpo.emailResponder).toBeUndefined();
    expect(corpo.prazoSolicitacaoHoras).toBeUndefined();
    expect(corpo.maxSolicitacoesPendentesPorEmail).toBeUndefined();
  });

  it("responde com Cache-Control: public, max-age=300 (contrato técnico)", async () => {
    obterConfigGeral.mockResolvedValue(CONFIG_GERAL_PADRAO);

    const resposta = await handler(criarEvento("GET", "/api/config-publica"));

    expect(resposta.headers).toMatchObject({ "cache-control": "public, max-age=300" });
  });

  it("responde 404 para o método errado na mesma rota", async () => {
    const resposta = await handler(criarEvento("POST", "/api/config-publica"));
    expect(resposta.statusCode).toBe(404);
  });
});
