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
 * - `GET /api/casas/{id}/disponibilidade` — Fase 1
 * - `POST /api/cotacao`                   — Fase 1
 * - `GET /api/config-publica`             — Fase 1 (esta entrega)
 * - `GET /api/casas`                      — Fase 1, a seguir
 * - `GET /api/casas/{slug}`               — Fase 1
 * - (demais rotas: Fase 2+)
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { entradaCotacaoPublicaSchema } from "@recanto/shared";

import { formatarInstanteIso, hojeEmSaoPaulo } from "../domain/datas";
import { projetarConfigGeralPublica } from "../domain/configGeral";
import {
  ehErroConsultaDisponibilidade,
  listarNoitesOcupadas,
  noitesOcupadasEm,
  validarIntervaloConsulta,
  verificarDisponibilidade,
  type OcupacaoNoite,
} from "../domain/disponibilidade";
import { calcularCotacao, ehErroCotacao } from "../domain/precos";
import { lerConfiguracaoAmbiente } from "../lib/config";
import {
  consultarOcupacoes,
  obterConfigGeral,
  obterConfigPrecos,
  obterStatusCasa,
  type ItemOcupacao,
} from "../lib/db";
import { respostaErro, respostaJson } from "../lib/http";

const ROTA_DISPONIBILIDADE = /^\/api\/casas\/([^/]+)\/disponibilidade$/;

/** UC-P03: mais restritivo que o limite geral de 16 KB da API pública. */
const TAMANHO_MAX_CORPO_COTACAO_BYTES = 1024;

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

  if (metodo === "POST" && caminho === "/api/cotacao") {
    return respostaCotacao(evento);
  }

  if (metodo === "GET" && caminho === "/api/config-publica") {
    return respostaConfigPublica();
  }

  return respostaErro(404, "NAO_ENCONTRADO", "Rota não encontrada.");
}

/** Converte os itens crus de `OCUPACAO#` em `OcupacaoNoite` — mesma forma nas duas rotas que leem ocupação. */
function paraOcupacoesNoite(itens: ItemOcupacao[]): OcupacaoNoite[] {
  return itens.map((item) => ({
    data: item.SK.slice("NOITE#".length),
    pendente: item.pendente,
    expiraEm: item.expiraEm,
  }));
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
  const noitesOcupadas = listarNoitesOcupadas(paraOcupacoesNoite(ocupacoes), agora);

  return respostaJson(
    200,
    { casaId, de, ate, noitesOcupadas, geradoEm: formatarInstanteIso(agora) },
    { "cache-control": "public, max-age=60" },
  );
}

/**
 * `POST /api/cotacao` (UC-P03): recalcula a cotação no servidor e informa se as
 * datas estão disponíveis. Nunca falha por indisponibilidade — responde `200` com
 * `disponivel: false` (A6): a tela precisa mostrar o preço e a indisponibilidade
 * juntos, não um erro.
 */
async function respostaCotacao(
  evento: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const corpoBruto = decodificarCorpo(evento);
  if (corpoBruto === undefined) {
    return respostaErro(400, "ENTRADA_INVALIDA", "Corpo da requisição ausente ou inválido.");
  }
  if (Buffer.byteLength(corpoBruto, "utf8") > TAMANHO_MAX_CORPO_COTACAO_BYTES) {
    return respostaErro(413, "PAYLOAD_MUITO_GRANDE", "Corpo da requisição excede o limite.");
  }

  let json: unknown;
  try {
    json = JSON.parse(corpoBruto);
  } catch {
    return respostaErro(400, "ENTRADA_INVALIDA", "Corpo da requisição não é um JSON válido.");
  }

  const entrada = entradaCotacaoPublicaSchema.safeParse(json);
  if (!entrada.success) {
    return respostaErro(400, "ENTRADA_INVALIDA", "Dados da cotação inválidos.", {
      campos: entrada.error.issues.map((problema) => problema.path.join(".")),
    });
  }
  const { casaId, checkin, checkout, hospedes } = entrada.data;

  const status = await obterStatusCasa(casaId);
  if (status !== "ATIVA") {
    return respostaErro(404, "NAO_ENCONTRADO", "Casa não encontrada.");
  }

  // E4 (UC-P03): casa ativa sem preços configurados é, para o visitante, o mesmo
  // 404 de casa inexistente — não há cotação possível de qualquer forma.
  const configPrecos = await obterConfigPrecos(casaId);
  if (configPrecos === undefined) {
    return respostaErro(404, "NAO_ENCONTRADO", "Casa não encontrada.");
  }

  const agora = new Date();
  const configGeral = await obterConfigGeral();
  const resultado = calcularCotacao(configPrecos, {
    checkin,
    checkout,
    hospedes,
    hoje: hojeEmSaoPaulo(agora),
    configGeral,
    // RN5 (UC-P03): a cotação pública nunca tem desconto manual.
  });

  if (ehErroCotacao(resultado)) {
    return respostaErro(422, resultado.erro, resultado.mensagem, resultado.detalhes);
  }

  const ocupacoes = await consultarOcupacoes(casaId, checkin, checkout);
  const ocupadas = noitesOcupadasEm(paraOcupacoesNoite(ocupacoes), agora);
  const disponibilidade = verificarDisponibilidade(ocupadas, checkin, checkout);

  return respostaJson(200, {
    ...resultado,
    disponivel: disponibilidade.disponivel,
    noitesIndisponiveis: disponibilidade.disponivel ? [] : disponibilidade.noitesIndisponiveis,
    estimativa: true,
    avisoEstimativa: "Valor estimado. O valor final é confirmado pelo proprietário.",
  });
}

/**
 * `GET /api/config-publica` (UC-A13, RN14): só os campos públicos de `CONFIG/GERAL`.
 * Sem parâmetro, sem erro possível — sempre `200`, mesmo antes do admin configurar
 * nada (`obterConfigGeral` devolve os padrões documentados ou o vazio do tipo).
 */
async function respostaConfigPublica(): Promise<APIGatewayProxyStructuredResultV2> {
  const configGeral = await obterConfigGeral();
  return respostaJson(200, projetarConfigGeralPublica(configGeral), {
    "cache-control": "public, max-age=300",
  });
}

/** `undefined` para corpo ausente ou inválido em `isBase64Encoded`. */
function decodificarCorpo(evento: APIGatewayProxyEventV2): string | undefined {
  if (evento.body === undefined) return undefined;
  if (!evento.isBase64Encoded) return evento.body;

  try {
    return Buffer.from(evento.body, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}
