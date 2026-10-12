import type { APIGatewayProxyEventV2 } from "aws-lambda";

/**
 * Monta um evento de Function URL (payload v2.0, o mesmo formato de
 * API Gateway HTTP API) com o mínimo necessário, sobrescrevendo só o que o teste
 * precisa variar. Compartilhado entre teste de unidade e de integração — é
 * literalmente o mesmo formato de evento nos dois.
 */
export function criarEvento(
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
