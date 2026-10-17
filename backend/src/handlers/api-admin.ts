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
 * - `PUT /api/admin/casas/{casaId}` — UC-A02
 * - `POST /api/admin/casas/{casaId}/status` — UC-A02
 * - `GET /api/admin/casas`, `GET /api/admin/casas/{casaId}` — UC-A02
 * - `DELETE /api/admin/casas/{casaId}` — UC-A02 (esta entrega, fecha o CRUD)
 * - (demais rotas de outros UCs de backoffice: a seguir)
 */

import { randomBytes } from "node:crypto";

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";

import {
  alterarStatusCasaSchema,
  casaEdicaoSchema,
  casaEntradaSchema,
  type Casa,
} from "@recanto/shared";

import { avaliarCompletudeParaAtivar, ehEdicaoDeSlugPermitida } from "../domain/casas";
import { formatarInstanteIso, hojeEmSaoPaulo } from "../domain/datas";
import { validarConfigPrecos } from "../domain/precos";
import { criarVerificadorAdmin, exigirAdmin, type Identidade, type VerificadorAdmin } from "../lib/auth";
import {
  alterarStatusCasa,
  atualizarCasa,
  criarCasa,
  excluirCasa,
  existeOcupacaoFutura,
  listarCasas,
  obterCasa,
  obterConfigPrecos,
} from "../lib/db";
import { ErroHttp } from "../lib/erros";
import { decodificarCorpo, respostaErro, respostaJson } from "../lib/http";

const ROTA_CASA_POR_ID = /^\/api\/admin\/casas\/([^/]+)$/;
const ROTA_STATUS_CASA = /^\/api\/admin\/casas\/([^/]+)\/status$/;

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

    if (metodo === "GET" && caminho === "/api/admin/casas") {
      return await listarCasasHandler();
    }

    const statusMatch = metodo === "POST" ? ROTA_STATUS_CASA.exec(caminho) : null;
    if (statusMatch !== null) {
      const casaId = statusMatch[1] as string;
      return await alterarStatusCasaHandler(evento, casaId, identidade);
    }

    const casaMatch =
      metodo === "PUT" || metodo === "GET" || metodo === "DELETE"
        ? ROTA_CASA_POR_ID.exec(caminho)
        : null;
    if (casaMatch !== null) {
      const casaId = casaMatch[1] as string;
      if (metodo === "PUT") return await atualizarCasaHandler(evento, casaId, identidade);
      if (metodo === "GET") return await obterCasaHandler(casaId);
      return await excluirCasaHandler(casaId);
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

/**
 * `POST /api/admin/casas/{casaId}/status` (UC-A02): fecha o ciclo
 * `RASCUNHO` → `ATIVA` ↔ `INATIVA`.
 *
 * `RASCUNHO` nunca é um destino válido aqui — é só o estado de nascimento
 * (RN1). Sem essa restrição, voltar uma casa publicada a `RASCUNHO` e editá-la
 * de novo seria uma forma de contornar `ehEdicaoDeSlugPermitida` (RN4): o
 * modelo não tem um campo "já foi publicada" dedicado, só o proxy `status !==
 * RASCUNHO` (ver `dominio/casas.ts`), e esse proxy só funciona se nada nunca
 * levar o status de volta para lá.
 *
 * RN7: ativar exige ao menos 1 foto, foto principal, texto alternativo em
 * todas e preços válidos — `avaliarCompletudeParaAtivar` decide, não esta
 * função; o que falta vai em `detalhes.faltando` do `422`.
 */
async function alterarStatusCasaHandler(
  evento: APIGatewayProxyEventV2,
  casaId: string,
  identidade: Identidade,
): Promise<APIGatewayProxyStructuredResultV2> {
  const corpo = lerCorpoJson(evento);
  if ("resposta" in corpo) return corpo.resposta;

  const entrada = alterarStatusCasaSchema.safeParse(corpo.dados);
  if (!entrada.success) {
    return respostaErro(400, "ENTRADA_INVALIDA", "Dados inválidos.", {
      campos: entrada.error.issues.map((problema) => problema.path.join(".")),
    });
  }

  if (entrada.data.status === "RASCUNHO") {
    return respostaErro(400, "ENTRADA_INVALIDA", "Uma casa não pode voltar a rascunho.", {
      campos: ["status"],
    });
  }

  const casaExistente = await obterCasa(casaId);
  if (casaExistente === undefined) {
    return respostaErro(404, "NAO_ENCONTRADO", "Casa não encontrada.");
  }

  if (entrada.data.status === "ATIVA") {
    const precos = await obterConfigPrecos(casaId);
    const precosValidos = precos !== undefined && validarConfigPrecos(precos).erros.length === 0;
    const completude = avaliarCompletudeParaAtivar({
      resumo: casaExistente.resumo,
      descricao: casaExistente.descricao,
      fotos: casaExistente.fotos,
      precosValidos,
    });
    if (!completude.completa) {
      return respostaErro(422, "CASA_INCOMPLETA", "A casa não está pronta para ativar.", {
        faltando: completude.faltando,
      });
    }
  }

  const agora = formatarInstanteIso(new Date());
  await alterarStatusCasa(casaId, entrada.data.status, identidade.sub, agora);

  return respostaJson(200, {
    ...casaExistente,
    status: entrada.data.status,
    versao: casaExistente.versao + 1,
    publicacaoPendente: true,
    atualizadoEm: agora,
    atualizadoPor: identidade.sub,
  });
}

/**
 * `GET /api/admin/casas` (UC-A02): a lista da vitrine do backoffice, na ordem
 * de exibição (`GSI1SK`, já ordenada por `ordem` — `lib/db.ts#listarCasas`
 * não precisa reordenar nada).
 *
 * `completa`/`temPrecos` são calculados aqui, não guardados no item: é o que
 * permite à lista mostrar "pronta para ativar" sem uma segunda chamada por
 * casa (mesmo raciocínio de `completude` em `POST .../status`). Isso custa
 * um `GetItem` de preços por casa — aceitável com o número de casas de uma
 * única fazenda, não escalaria para um catálogo grande.
 *
 * `reservasAtivas` é sempre `0`: não é um valor inventado, é o estado real
 * de um sistema sem nenhuma reserva ainda (`POST /api/solicitacoes`, Fase 2,
 * não existe). Atualizar quando esse UC nascer.
 */
async function listarCasasHandler(): Promise<APIGatewayProxyStructuredResultV2> {
  const casas = await listarCasas();

  const linhas = await Promise.all(
    casas.map(async (casa) => {
      const precos = await obterConfigPrecos(casa.casaId);
      const precosValidos = precos !== undefined && validarConfigPrecos(precos).erros.length === 0;
      const completude = avaliarCompletudeParaAtivar({
        resumo: casa.resumo,
        descricao: casa.descricao,
        fotos: casa.fotos,
        precosValidos,
      });
      const fotoPrincipal = casa.fotos.find((foto) => foto.principal);

      return {
        casaId: casa.casaId,
        slug: casa.slug,
        nome: casa.nome,
        status: casa.status,
        ordem: casa.ordem,
        destaque: casa.destaque,
        capacidadeMaxima: casa.capacidadeMaxima,
        totalFotos: casa.fotos.length,
        publicacaoPendente: casa.publicacaoPendente,
        temPrecos: precosValidos,
        completa: completude.completa,
        fotoPrincipalUrl: fotoPrincipal === undefined ? undefined : `/${fotoPrincipal.chave}`,
        reservasAtivas: 0,
        atualizadoEm: casa.atualizadoEm,
      };
    }),
  );

  return respostaJson(200, { casas: linhas });
}

/**
 * `GET /api/admin/casas/{casaId}` (UC-A02): a casa completa, incluindo
 * `enderecoCompleto` e `tokenIcal` — ao contrário de uma futura rota pública
 * (RN11), isto é o backoffice, para o próprio admin.
 */
async function obterCasaHandler(casaId: string): Promise<APIGatewayProxyStructuredResultV2> {
  const casa = await obterCasa(casaId);
  if (casa === undefined) {
    return respostaErro(404, "NAO_ENCONTRADO", "Casa não encontrada.");
  }
  return respostaJson(200, casa);
}

/**
 * `DELETE /api/admin/casas/{casaId}` (UC-A02, RN14): fecha o CRUD.
 *
 * RN14/E5: casa com ocupação futura (reserva, bloqueio ou importação de
 * iCal — tudo que vive em `OCUPACAO#<casaId>`) não pode ser excluída,
 * `409 CASA_COM_RESERVAS`. `existeOcupacaoFutura` é uma verificação real,
 * não um placeholder: nenhum desses UCs escreve `OCUPACAO#` ainda, então
 * hoje ela sempre devolve `false` — mas quando UC-P04/bloqueios nascerem,
 * esta rota já respeita RN14 sem precisar de mudança nenhuma aqui.
 */
async function excluirCasaHandler(casaId: string): Promise<APIGatewayProxyStructuredResultV2> {
  const casaExistente = await obterCasa(casaId);
  if (casaExistente === undefined) {
    return respostaErro(404, "NAO_ENCONTRADO", "Casa não encontrada.");
  }

  const temOcupacaoFutura = await existeOcupacaoFutura(casaId, hojeEmSaoPaulo(new Date()));
  if (temOcupacaoFutura) {
    return respostaErro(
      409,
      "CASA_COM_RESERVAS",
      "Esta casa tem reservas ou bloqueios ativos. Desative-a em vez de excluir.",
    );
  }

  await excluirCasa(casaExistente);

  return respostaJson(200, { casaId });
}
