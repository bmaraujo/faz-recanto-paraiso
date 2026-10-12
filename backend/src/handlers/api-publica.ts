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
 * - `GET /api/saude`                      — Fase 0
 * - `GET /api/casas/{id}/disponibilidade` — Fase 1 (esta entrega)
 * - `GET /api/casas`                      — Fase 1, a seguir
 * - `GET /api/casas/{slug}`               — Fase 1
 * - `GET /api/config-publica`             — Fase 1
 * - `POST /api/cotacao`                   — Fase 1
 * - (demais rotas: Fase 2+)
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { formatarInstanteIso } from "../domain/datas";
import {
  ehErroConsultaDisponibilidade,
  listarNoitesOcupadas,
  validarIntervaloConsulta,
} from "../domain/disponibilidade";
import { lerConfiguracaoAmbiente } from "../lib/config";
import { consultarOcupacoes, obterStatusCasa } from "../lib/db";
import { respostaErro, respostaJson } from "../lib/http";

const ROTA_DISPONIBILIDADE = /^\/api\/casas\/([^/]+)\/disponibilidade$/;

export async function handler(
  evento: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const metodo = evento.requestContext.http.method;
  const caminho = evento.rawPath;

  if (metodo === "GET" && caminho === "/api/saude") {
    return respostaSaude();
  }

  const casaMatch = metodo === "GET" ? ROTA_DISPONIBILIDADE.exec(caminho) : null;
  if (casaMatch !== null) {
    const casaId = casaMatch[1] as string;
    return respostaDisponibilidade(casaId, evento.queryStringParameters ?? {});
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
    em: formatarInstanteIso(new Date()),
  });
}

/**
 * `GET /api/casas/{casaId}/disponibilidade` (UC-P02): noites ocupadas de uma casa
 * num intervalo. Implementação em três passos, na ordem do contrato técnico:
 *
 * 1. valida `de`/`ate` (formato, ordem, limite de 13 meses);
 * 2. resolve a casa — só `ATIVA` responde, o resto é `404` (não revela rascunho);
 * 3. consulta as ocupações e aplica a regra de pendência vencida (R4).
 */
async function respostaDisponibilidade(
  casaId: string,
  querystring: Record<string, string | undefined>,
): Promise<APIGatewayProxyStructuredResultV2> {
  const intervalo = validarIntervaloConsulta(querystring.de, querystring.ate);
  if (ehErroConsultaDisponibilidade(intervalo)) {
    const status = intervalo.erro === "INTERVALO_MUITO_LONGO" ? 422 : 400;
    return respostaErro(status, intervalo.erro, intervalo.mensagem, intervalo.detalhes);
  }

  const status = await obterStatusCasa(casaId);
  if (status !== "ATIVA") {
    return respostaErro(404, "NAO_ENCONTRADO", "Casa não encontrada.");
  }

  const { de, ate } = intervalo;
  const agora = new Date();
  const ocupacoes = await consultarOcupacoes(casaId, de, ate);
  const noitesOcupadas = listarNoitesOcupadas(
    ocupacoes.map((item) => ({
      data: item.SK.slice("NOITE#".length),
      pendente: item.pendente,
      expiraEm: item.expiraEm,
    })),
    agora,
  );

  return respostaJson(
    200,
    { casaId, de, ate, noitesOcupadas, geradoEm: formatarInstanteIso(agora) },
    { "cache-control": "public, max-age=60" },
  );
}
