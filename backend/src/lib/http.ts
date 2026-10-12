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

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const CABECALHOS_JSON = { "content-type": "application/json; charset=utf-8" };

/** Resposta de sucesso: serializa `corpo` como JSON. */
export function respostaJson(
  statusCode: number,
  corpo: unknown,
): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: CABECALHOS_JSON, body: JSON.stringify(corpo) };
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
