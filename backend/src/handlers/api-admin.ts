/**
 * Lambda `api-admin`: rotas do backoffice, `/api/admin/*`, atrás da Function URL.
 *
 * RN8 (UC-A01): **toda** requisição a `/api/admin/*` passa por `exigirAdmin` antes
 * de qualquer leitura ou escrita — por isso a verificação acontece antes do
 * roteamento, não dentro de cada rota.
 *
 * Uma rota por entrega:
 *
 * - `POST /api/admin/casas` — UC-A02 (esta entrega)
 * - (demais rotas de UC-A02 e dos outros UCs de backoffice: a seguir)
 */

import { randomBytes } from "node:crypto";

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";

import { casaEntradaSchema, type Casa } from "@recanto/shared";

import { formatarInstanteIso } from "../domain/datas";
import { criarVerificadorAdmin, exigirAdmin, type Identidade, type VerificadorAdmin } from "../lib/auth";
import { criarCasa } from "../lib/db";
import { ErroHttp } from "../lib/erros";
import { decodificarCorpo, respostaErro, respostaJson } from "../lib/http";

/** Mesma ordem de grandeza dos campos de texto de `casaEntradaSchema`
 * (`descricao`, `regras`, `comoChegar`, 10.000 chars cada) mais a margem dos
 * campos estruturados (camas, distâncias). */
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

    return respostaErro(404, "NAO_ENCONTRADO", "Rota não encontrada.");
  } catch (erro) {
    if (erro instanceof ErroHttp) {
      return respostaErro(erro.statusCode, erro.codigo, erro.message, erro.detalhes);
    }
    throw erro;
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
  const corpoBruto = decodificarCorpo(evento);
  if (corpoBruto === undefined) {
    return respostaErro(400, "ENTRADA_INVALIDA", "Corpo da requisição ausente ou inválido.");
  }
  if (Buffer.byteLength(corpoBruto, "utf8") > TAMANHO_MAX_CORPO_CASA_BYTES) {
    return respostaErro(413, "PAYLOAD_MUITO_GRANDE", "Corpo da requisição excede o limite.");
  }

  let json: unknown;
  try {
    json = JSON.parse(corpoBruto);
  } catch {
    return respostaErro(400, "ENTRADA_INVALIDA", "Corpo da requisição não é um JSON válido.");
  }

  const entrada = casaEntradaSchema.safeParse(json);
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
