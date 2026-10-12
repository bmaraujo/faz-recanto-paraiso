/**
 * Lambda `api-publica`: rotas publicas e anonimas de `/api/*`, atras do CloudFront
 * via Function URL (`AuthType: NONE`) - ver docs/03-tecnico/01-arquitetura.md.
 *
 * A Function URL fica exposta na internet; esta Lambda nunca confia em "veio do
 * CloudFront" para nenhuma decisao de seguranca.
 *
 * Uma rota por entrega, na ordem do plano de fases
 * (docs/06-planejamento/01-fases-e-criterios-de-aceite.md):
 *
 * - `GET /api/saude`           — Fase 0 (esta entrega)
 * - `GET /api/casas`           — Fase 1, a seguir
 * - `GET /api/casas/{slug}`    — Fase 1
 * - `GET /api/config-publica`  — Fase 1
 * - `GET /api/casas/{id}/disponibilidade` — Fase 1
 * - `POST /api/cotacao`        — Fase 1
 * - (demais rotas: Fase 2+)
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { lerConfiguracaoAmbiente } from "../lib/config";
import { respostaErro, respostaJson } from "../lib/http";

export async function handler(
  evento: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const metodo = evento.requestContext.http.method;
  const caminho = evento.rawPath;

  if (metodo === "GET" && caminho === "/api/saude") {
    return respostaSaude();
  }

  return respostaErro(404, "NAO_ENCONTRADO", "Rota não encontrada.");
}

/**
 * Health check: NUNCA consulta o banco (docs/03-tecnico/13-observabilidade.md) -
 * um health check que le o DynamoDB gasta leitura a cada verificacao e pode falhar
 * por throttle, criando alarme falso quando o resto do sistema esta saudavel.
 */
function respostaSaude(): APIGatewayProxyStructuredResultV2 {
  const { stage, versao } = lerConfiguracaoAmbiente();
  return respostaJson(200, {
    ok: true,
    stage,
    versao,
    em: new Date().toISOString(),
  });
}
