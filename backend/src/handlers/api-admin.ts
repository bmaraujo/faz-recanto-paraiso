/**
 * Lambda `api-admin`: rotas do backoffice, `/api/admin/*`, atrás da Function URL.
 *
 * RN8 (UC-A01): **toda** requisição a `/api/admin/*` passa por `exigirAdmin` antes
 * de qualquer leitura ou escrita — por isso a verificação acontece antes do
 * roteamento, não dentro de cada rota.
 *
 * Uma rota por entrega:
 *
 * - `POST /api/admin/casas` — UC-A02
 * - `PUT /api/admin/casas/{casaId}` — UC-A02 (esta entrega)
 * - (demais rotas de UC-A02 e dos outros UCs de backoffice: a seguir)
 */

import { randomBytes } from "node:crypto";

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";

import { casaEdicaoSchema, casaEntradaSchema, type Casa } from "@recanto/shared";

import { ehEdicaoDeSlugPermitida } from "../domain/casas";
import { formatarInstanteIso } from "../domain/datas";
import { criarVerificadorAdmin, exigirAdmin, type Identidade, type VerificadorAdmin } from "../lib/auth";
import { atualizarCasa, criarCasa, obterCasa } from "../lib/db";
import { ErroHttp } from "../lib/erros";
import { decodificarCorpo, respostaErro, respostaJson } from "../lib/http";

const ROTA_CASA_POR_ID = /^\/api\/admin\/casas\/([^/]+)$/;

/** Mesma ordem de grandeza dos campos de texto de `casaEntradaSchema`
 * (`descricao`, `regras`, `comoChegar`, 10.000 chars cada) mais a margem dos
 * campos estruturados (camas, distâncias). Compartilhado por `POST` e `PUT`:
 * os dois recebem o mesmo corpo. */
const TAMANHO_MAX_CORPO_CASA_BYTES = 64 * 1024;

let verificadorAdmin: VerificadorAdmin | undefined;

/**
 * Criado uma vez, no primeiro uso — não em escopo de módulo. `criarVerificadorAdmin`
 * lança de forma síncrona se `USER_POOL_ID`/`USER_POOL_CLIENT_ID` não estiverem no
 * ambiente (ver o cabeçalho de `lib/auth.ts`); isso quebraria a importação deste
 * arquivo em todo teste e no bundle do esbuild, onde essas variáveis não existem.
 * Em produção, só a primeira invocação de cada container paga esse custo — as
 * próximas reaproveitam o cache de JWKS do verificador.
 */
function obterVerificadorAdmin(): VerificadorAdmin {
  verificadorAdmin ??= criarVerificadorAdmin();
  return verificadorAdmin;
}

export async function handler(
  evento: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const identidade = await exigirAdmin(evento, obterVerificadorAdmin());

    const metodo = evento.requestContext.http.method;
    const caminho = evento.rawPath;

    if (metodo === "POST" && caminho === "/api/admin/casas") {
      return await criarCasaHandler(evento, identidade);
    }

    const casaMatch = metodo === "PUT" ? ROTA_CASA_POR_ID.exec(caminho) : null;
    if (casaMatch !== null) {
      const casaId = casaMatch[1] as string;
      return await atualizarCasaHandler(evento, casaId, identidade);
    }

    return respostaErro(404, "NAO_ENCONTRADO", "Rota não encontrada.");
  } catch (erro) {
    if (erro instanceof ErroHttp) {
      return respostaErro(erro.statusCode, erro.codigo, erro.message, erro.detalhes);
    }
    throw erro;
  }
}

/** `undefined` + resposta de erro já pronta quando o corpo falha; o JSON cru
 * quando passa. Compartilhado por `POST` e `PUT` — os dois recebem o mesmo
 * tipo de corpo e o mesmo limite de tamanho. */
function lerCorpoJson(
  evento: APIGatewayProxyEventV2,
): { dados: unknown } | { resposta: APIGatewayProxyStructuredResultV2 } {
  const corpoBruto = decodificarCorpo(evento);
  if (corpoBruto === undefined) {
    return {
      resposta: respostaErro(400, "ENTRADA_INVALIDA", "Corpo da requisição ausente ou inválido."),
    };
  }
  if (Buffer.byteLength(corpoBruto, "utf8") > TAMANHO_MAX_CORPO_CASA_BYTES) {
    return { resposta: respostaErro(413, "PAYLOAD_MUITO_GRANDE", "Corpo da requisição excede o limite.") };
  }

  try {
    return { dados: JSON.parse(corpoBruto) };
  } catch {
    return {
      resposta: respostaErro(400, "ENTRADA_INVALIDA", "Corpo da requisição não é um JSON válido."),
    };
  }
}

/**
 * `POST /api/admin/casas` (UC-A02): cria a casa, o índice de slug e os preços
 * padrão numa transação (`lib/db.ts#criarCasa`).
 *
 * RN1: a casa nasce em `RASCUNHO` **sempre** — `status` no corpo é só forma
 * (o mesmo schema serve à edição, onde os três valores são válidos); aqui o
 * valor enviado é ignorado, nunca rejeitado.
 */
async function criarCasaHandler(
  evento: APIGatewayProxyEventV2,
  identidade: Identidade,
): Promise<APIGatewayProxyStructuredResultV2> {
  const corpo = lerCorpoJson(evento);
  if ("resposta" in corpo) return corpo.resposta;

  const entrada = casaEntradaSchema.safeParse(corpo.dados);
  if (!entrada.success) {
    return respostaErro(400, "ENTRADA_INVALIDA", "Dados da casa inválidos.", {
      campos: entrada.error.issues.map((problema) => problema.path.join(".")),
    });
  }

  const agora = formatarInstanteIso(new Date());
  const casa: Casa = {
    ...entrada.data,
    status: "RASCUNHO",
    casaId: ulid(),
    fotos: [],
    tokenIcal: randomBytes(32).toString("base64url"),
    publicacaoPendente: false,
    versao: 0,
    criadoEm: agora,
    atualizadoEm: agora,
    atualizadoPor: identidade.sub,
  };

  await criarCasa(casa);

  return respostaJson(201, casa);
}

/**
 * `PUT /api/admin/casas/{casaId}` (UC-A02, E9): edita a casa. `status` nunca
 * muda por aqui — só por `POST .../status` (que valida RN7, "ao menos 1 foto,
 * preços válidos..."); permitir `status` neste corpo sem essa validação
 * deixaria o admin ativar uma casa incompleta passando pela rota errada.
 *
 * RN4: o slug só pode mudar enquanto a casa está em `RASCUNHO`
 * (`ehEdicaoDeSlugPermitida`) — verificado antes de qualquer escrita, não
 * depois de tentar e falhar.
 */
async function atualizarCasaHandler(
  evento: APIGatewayProxyEventV2,
  casaId: string,
  identidade: Identidade,
): Promise<APIGatewayProxyStructuredResultV2> {
  const corpo = lerCorpoJson(evento);
  if ("resposta" in corpo) return corpo.resposta;

  const entrada = casaEdicaoSchema.safeParse(corpo.dados);
  if (!entrada.success) {
    return respostaErro(400, "ENTRADA_INVALIDA", "Dados da casa inválidos.", {
      campos: entrada.error.issues.map((problema) => problema.path.join(".")),
    });
  }

  const casaExistente = await obterCasa(casaId);
  if (casaExistente === undefined) {
    return respostaErro(404, "NAO_ENCONTRADO", "Casa não encontrada.");
  }

  if (!ehEdicaoDeSlugPermitida(casaExistente.status, casaExistente.slug, entrada.data.slug)) {
    return respostaErro(
      422,
      "SLUG_IMUTAVEL",
      "O endereço desta casa não pode mais ser alterado depois de publicada.",
    );
  }

  const casaAtualizada: Casa = {
    ...entrada.data,
    status: casaExistente.status,
    casaId: casaExistente.casaId,
    fotos: casaExistente.fotos,
    tokenIcal: casaExistente.tokenIcal,
    publicacaoPendente: true, // RN12: qualquer alteração marca publicação pendente
    versao: entrada.data.versao + 1,
    criadoEm: casaExistente.criadoEm,
    atualizadoEm: formatarInstanteIso(new Date()),
    atualizadoPor: identidade.sub,
  };

  await atualizarCasa(casaAtualizada, entrada.data.versao, casaExistente.slug);

  return respostaJson(200, casaAtualizada);
}
