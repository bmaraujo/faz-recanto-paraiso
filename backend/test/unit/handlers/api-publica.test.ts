import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handler } from "../../../src/handlers/api-publica";

/**
 * Monta um evento de Function URL (payload v2.0, o mesmo formato de
 * API Gateway HTTP API) com o minimo necessario, sobrescrevendo so o que o teste
 * precisa variar.
 */
function criarEvento(
  metodo: string,
  caminho: string,
  extras: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: caminho,
    rawQueryString: "",
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      accountId: "anonymous",
      apiId: "teste",
      domainName: "teste.lambda-url.sa-east-1.on.aws",
      domainPrefix: "teste",
      http: {
        method: metodo,
        path: caminho,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "requisicao-de-teste",
      routeKey: "$default",
      stage: "$default",
      time: "12/Oct/2026:12:00:00 +0000",
      timeEpoch: 1_760_000_000_000,
    },
    ...extras,
  };
}

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
