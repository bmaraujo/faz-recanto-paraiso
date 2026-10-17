/**
 * Helpers de resposta HTTP para as Lambdas atras da Function URL.
 *
 * Formato de erro fixado em docs/03-tecnico/03-api-publica.md#convenções:
 * `{ erro, mensagem, detalhes }`. `mensagem` e sempre texto pronto para o usuario,
 * em pt-BR; `detalhes` carrega dados estruturados (`minimoExigido`, `campos`...).
 *
 * Cabecalhos de seguranca (HSTS, CSP, nosniff...) sao aplicados pela Response
 * Headers Policy do CloudFront, nao aqui (docs/03-tecnico/01-arquitetura.md) -
 * duplicar na Lambda so criaria dois lugares para a politica divergir.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const CABECALHOS_JSON = { "content-type": "application/json; charset=utf-8" };

/**
 * Resposta de sucesso: serializa `corpo` como JSON.
 *
 * `cabecalhosExtras` existe para o `Cache-Control` que o contrato técnico de
 * algumas rotas pede explicitamente (ex.: UC-P02 pede `public, max-age=60`) — a
 * política de `CachePolicy` do CloudFront fica em `infra/`, mas emitir o cabeçalho
 * aqui já deixa a resposta correta hoje, independente de qual política o CDK
 * configurar depois.
 */
export function respostaJson(
  statusCode: number,
  corpo: unknown,
  cabecalhosExtras: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { ...CABECALHOS_JSON, ...cabecalhosExtras },
    body: JSON.stringify(corpo),
  };
}

/** Resposta de erro no formato do contrato: `{ erro, mensagem, detalhes }`. */
export function respostaErro(
  statusCode: number,
  erro: string,
  mensagem: string,
  detalhes: Record<string, unknown> = {},
): APIGatewayProxyStructuredResultV2 {
  return respostaJson(statusCode, { erro, mensagem, detalhes });
}

/**
 * Decodifica `evento.body`, cuidando do `isBase64Encoded` da Function URL.
 * `undefined` para corpo ausente ou base64 inválido — compartilhado por toda
 * rota que recebe JSON (`POST /api/cotacao`, `POST /api/admin/casas`...), para
 * as duas nunca divergirem em como tratam esse detalhe do payload v2.0.
 */
export function decodificarCorpo(evento: APIGatewayProxyEventV2): string | undefined {
  if (evento.body === undefined) return undefined;
  if (!evento.isBase64Encoded) return evento.body;

  try {
    return Buffer.from(evento.body, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}
