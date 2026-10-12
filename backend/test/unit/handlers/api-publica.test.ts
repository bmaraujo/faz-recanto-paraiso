import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ItemOcupacao } from "../../../src/lib/db";
import { criarEvento } from "../../evento-teste";

const { obterStatusCasa, consultarOcupacoes } = vi.hoisted(() => ({
  obterStatusCasa: vi.fn<(casaId: string) => Promise<string | undefined>>(),
  consultarOcupacoes:
    vi.fn<(casaId: string, de: string, ate: string) => Promise<ItemOcupacao[]>>(),
}));

vi.mock("../../../src/lib/db", () => ({ obterStatusCasa, consultarOcupacoes }));

import { handler } from "../../../src/handlers/api-publica";

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
