/**
 * Cliente DynamoDB e builders de chave — docs/03-tecnico/02-modelo-de-dados.md.
 *
 * Único lugar do backend que conhece `PK`/`SK`/`GSI1`. `domain/` nunca importa
 * este módulo (docs/03-tecnico/01-arquitetura.md) — ele só recebe os dados já
 * lidos, na forma de registros simples.
 *
 * O cliente é criado uma vez, em escopo de módulo: é o padrão recomendado para
 * Lambda (reaproveita a conexão entre invocações do mesmo container), e o motivo
 * de a Function URL não pagar o custo de abrir uma conexão nova a cada requisição.
 */

import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  casaArmazenadaSchema,
  configPrecosSchema,
  type Casa,
  type ConfigGeral,
  type ConfigPrecos,
  type StatusCasa,
} from "@recanto/shared";

import { ErroHttp } from "./erros";

const NOME_TABELA_PADRAO = "recanto-paraiso-dev";

/**
 * `DYNAMODB_ENDPOINT` só é definida em teste de integração (DynamoDB Local via
 * Docker — docs/03-tecnico/14-estrategia-de-testes.md). Em produção, o SDK resolve
 * o endpoint real a partir da região do ambiente Lambda.
 *
 * Exportado para o teste de integração criar/apagar a tabela (`test/esquema.ts`).
 */
export const clienteDynamoDB = new DynamoDBClient(
  process.env.DYNAMODB_ENDPOINT !== undefined
    ? { endpoint: process.env.DYNAMODB_ENDPOINT }
    : {},
);

export const documentoDb = DynamoDBDocumentClient.from(clienteDynamoDB, {
  marshallOptions: { removeUndefinedValues: true },
});

export function nomeTabela(env: NodeJS.ProcessEnv = process.env): string {
  return env.TABELA ?? NOME_TABELA_PADRAO;
}

export function chaveCasa(casaId: string): { PK: string; SK: string } {
  return { PK: `CASA#${casaId}`, SK: "META" };
}

export function chaveSlug(slug: string): { PK: string; SK: string } {
  return { PK: `SLUG#${slug}`, SK: "META" };
}

/** GSI1 do item `CASA#<id>/META`: lista a vitrine ordenada sem `Scan` (`ordem` com
 * zero à esquerda, para ordenar como string). */
function indiceOrdemCasas(casaId: string, ordem: number): { GSI1PK: string; GSI1SK: string } {
  return { GSI1PK: "CASAS", GSI1SK: `${String(ordem).padStart(4, "0")}#${casaId}` };
}

export function chaveOcupacao(casaId: string, data: string): { PK: string; SK: string } {
  return { PK: `OCUPACAO#${casaId}`, SK: `NOITE#${data}` };
}

/** Registro de ocupação de noite como vem do banco — ver `OcupacaoNoite` em `domain/disponibilidade.ts`. */
export interface ItemOcupacao {
  SK: string;
  pendente?: boolean;
  expiraEm?: string;
}

/**
 * `GetItem CASA#<casaId>/META`, projetando só `status`.
 *
 * Suficiente para as rotas que precisam apenas confirmar que a casa existe e está
 * `ATIVA` (UC-P02, UC-P03) — o restante do item (fotos, descrição, preços) é
 * assunto de `GET /api/casas/{slug}`, não construído ainda.
 */
export async function obterStatusCasa(casaId: string): Promise<string | undefined> {
  const resultado = await documentoDb.send(
    new GetCommand({
      TableName: nomeTabela(),
      Key: chaveCasa(casaId),
      ProjectionExpression: "#status",
      ExpressionAttributeNames: { "#status": "status" },
    }),
  );

  return (resultado.Item as { status?: string } | undefined)?.status;
}

/**
 * `GetItem CASA#<casaId>/META` completo (UC-A02: `GET`/`PUT /api/admin/casas/{casaId}`).
 * `undefined` se a casa não existe — `404` no handler.
 *
 * Valida a forma com `casaArmazenadaSchema` antes de devolver, mesmo princípio de
 * `obterConfigPrecos`: este item é uma árvore (camas, localização, fotos), não um
 * campo simples como o `status` que `obterStatusCasa` projeta.
 */
export async function obterCasa(casaId: string): Promise<Casa | undefined> {
  const resultado = await documentoDb.send(
    new GetCommand({ TableName: nomeTabela(), Key: chaveCasa(casaId) }),
  );
  if (resultado.Item === undefined) return undefined;

  const validado = casaArmazenadaSchema.safeParse(resultado.Item);
  if (!validado.success) {
    throw new Error(`Item da casa ${casaId} com formato inválido: ${validado.error.message}`);
  }
  return validado.data;
}

/**
 * `Query GSI1PK = CASAS` (UC-A02: `GET /api/admin/casas`), paginando até
 * esgotar — sem `Scan`. O `GSI1` já projeta `ALL`, então cada página traz a
 * casa inteira, sem um `GetItem` por item.
 *
 * O resultado já vem ordenado por `GSI1SK` (`<ordem padded>#<casaId>`), que é
 * a própria ordem de exibição — não precisa reordenar na aplicação.
 */
export async function listarCasas(): Promise<Casa[]> {
  const itens: Casa[] = [];
  let chaveExclusiva: Record<string, unknown> | undefined;

  do {
    const pagina = await documentoDb.send(
      new QueryCommand({
        TableName: nomeTabela(),
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "CASAS" },
        ExclusiveStartKey: chaveExclusiva,
      }),
    );

    for (const item of pagina.Items ?? []) {
      const validado = casaArmazenadaSchema.safeParse(item);
      if (!validado.success) {
        throw new Error(`Item de casa na listagem com formato inválido: ${validado.error.message}`);
      }
      itens.push(validado.data);
    }
    chaveExclusiva = pagina.LastEvaluatedKey;
  } while (chaveExclusiva !== undefined);

  return itens;
}

export function chavePrecos(casaId: string): { PK: string; SK: string } {
  return { PK: `CASA#${casaId}`, SK: "PRECOS" };
}

/**
 * `GetItem CASA#<casaId>/PRECOS` (UC-P03). `undefined` se a casa não tem preços
 * configurados ainda — E4 do UC-P03, tratado pelo handler como `NAO_ENCONTRADO`.
 *
 * Valida a forma do item com `configPrecosSchema` antes de devolver: diferente de
 * `obterStatusCasa` (um único campo string), este item é uma árvore com temporadas e
 * feriados, e `calcularCotacao` não tem guarda própria contra formato inesperado —
 * um item corrompido deve virar `ERRO_INTERNO` limpo no handler, não um erro de
 * runtime vazando daquela função.
 */
export async function obterConfigPrecos(casaId: string): Promise<ConfigPrecos | undefined> {
  const resultado = await documentoDb.send(
    new GetCommand({ TableName: nomeTabela(), Key: chavePrecos(casaId) }),
  );
  if (resultado.Item === undefined) return undefined;

  const validado = configPrecosSchema.safeParse(resultado.Item);
  if (!validado.success) {
    throw new Error(`Item de preços de ${casaId} com formato inválido: ${validado.error.message}`);
  }
  return validado.data;
}

/**
 * Preços padrão de uma casa recém-criada (UC-A02, "Implementação" → "Criação"):
 * tudo zerado. Não existe uma flag `validado` separada no item — `diariaBaseCentavos: 0`
 * já falha `validarConfigPrecos` por conta própria ("a diária base precisa ser maior
 * que zero"), o que basta para `avaliarCompletudeParaAtivar` (RN7) saber que a casa
 * não está pronta para ativar até o admin configurar os preços de verdade.
 */
function precosPadrao(casa: Pick<Casa, "capacidadeMaxima" | "hospedesInclusos">): ConfigPrecos {
  return {
    diariaBaseCentavos: 0,
    diariaFimDeSemanaCentavos: 0,
    diasFimDeSemana: [],
    temporadas: [],
    feriados: [],
    minNoitesPadrao: 1,
    maxNoites: 1,
    taxaLimpezaCentavos: 0,
    valorHospedeExtraPorNoiteCentavos: 0,
    capacidadeMaxima: casa.capacidadeMaxima,
    hospedesInclusos: casa.hospedesInclusos,
  };
}

/**
 * Cria a casa, o índice de slug e os preços padrão numa única transação
 * (UC-A02, RN3). A condição no item de slug é **o que garante a unicidade** —
 * nunca verificar com `GetItem` antes: duas criações simultâneas com o mesmo
 * slug passariam (armadilha nº 1 do UC). `SLUG_EM_USO` nunca é um `GetItem`
 * prévio, só o `409` desta condição falhando.
 */
export async function criarCasa(casa: Casa): Promise<void> {
  try {
    await documentoDb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: nomeTabela(),
              Item: { ...chaveSlug(casa.slug), casaId: casa.casaId },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: nomeTabela(),
              Item: { ...chaveCasa(casa.casaId), ...indiceOrdemCasas(casa.casaId, casa.ordem), ...casa },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: nomeTabela(),
              Item: { ...chavePrecos(casa.casaId), ...precosPadrao(casa) },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      }),
    );
  } catch (erro) {
    // Índice 0 é sempre o item de slug (ver TransactItems acima) — colisão de
    // casaId (índice 1) é praticamente impossível com ULID, mas cairia no `throw erro`
    // genérico abaixo em vez de ser confundida com SLUG_EM_USO.
    if (
      erro instanceof TransactionCanceledException &&
      erro.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed"
    ) {
      throw new ErroHttp(409, "SLUG_EM_USO", "Este endereço já está em uso por outra casa.");
    }
    throw erro;
  }
}

function erroConflitoVersao(): ErroHttp {
  return new ErroHttp(
    409,
    "CONFLITO_VERSAO",
    "Esta casa foi alterada em outra aba. Recarregue para ver a versão atual.",
  );
}

/**
 * `PUT /api/admin/casas/{casaId}` (UC-A02, E9): grava `casaAtualizada` inteira,
 * condicionando à `versaoAnterior` lida pelo handler — a mesma que o UC descreve
 * ("a escrita usa `ConditionExpression: versao = :versaoLida`").
 *
 * Quando o slug não mudou, é um único `PutItem` condicional. Quando mudou — e só
 * é permitido mudar em `RASCUNHO`, verificado pelo handler via
 * `ehEdicaoDeSlugPermitida` antes de chamar esta função — é a mesma ideia da
 * transação de `criarCasa`, trocando o slug antigo pelo novo e levando a mesma
 * condição de versão para dentro da transação.
 */
export async function atualizarCasa(
  casaAtualizada: Casa,
  versaoAnterior: number,
  slugAnterior: string,
): Promise<void> {
  const itemCasa = {
    ...chaveCasa(casaAtualizada.casaId),
    ...indiceOrdemCasas(casaAtualizada.casaId, casaAtualizada.ordem),
    ...casaAtualizada,
  };

  if (casaAtualizada.slug === slugAnterior) {
    try {
      await documentoDb.send(
        new PutCommand({
          TableName: nomeTabela(),
          Item: itemCasa,
          ConditionExpression: "versao = :versaoAnterior",
          ExpressionAttributeValues: { ":versaoAnterior": versaoAnterior },
        }),
      );
    } catch (erro) {
      if (erro instanceof ConditionalCheckFailedException) throw erroConflitoVersao();
      throw erro;
    }
    return;
  }

  try {
    await documentoDb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: nomeTabela(), Key: chaveSlug(slugAnterior) } },
          {
            Put: {
              TableName: nomeTabela(),
              Item: { ...chaveSlug(casaAtualizada.slug), casaId: casaAtualizada.casaId },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: nomeTabela(),
              Item: itemCasa,
              ConditionExpression: "versao = :versaoAnterior",
              ExpressionAttributeValues: { ":versaoAnterior": versaoAnterior },
            },
          },
        ],
      }),
    );
  } catch (erro) {
    if (erro instanceof TransactionCanceledException) {
      // Índices 1 e 2 — ver TransactItems acima (0 é o Delete do slug antigo,
      // sem condição, então nunca falha por conta própria).
      if (erro.CancellationReasons?.[1]?.Code === "ConditionalCheckFailed") {
        throw new ErroHttp(409, "SLUG_EM_USO", "Este endereço já está em uso por outra casa.");
      }
      if (erro.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed") {
        throw erroConflitoVersao();
      }
    }
    throw erro;
  }
}

/**
 * `POST /api/admin/casas/{casaId}/status` (UC-A02, RN7 validado pelo handler,
 * não aqui): grava o novo `status` e incrementa `versao` **atomicamente**
 * (`versao = versao + :um`), sem receber uma `versaoAnterior` do chamador —
 * esta rota não tem o conceito de "versão lida" que `PUT` tem.
 *
 * Incrementar `versao` aqui é o que faz um `PUT` concorrente, que leu a casa
 * antes desta troca de status, falhar com `CONFLITO_VERSAO` em vez de
 * sobrescrever o status silenciosamente de volta ao valor antigo.
 */
export async function alterarStatusCasa(
  casaId: string,
  novoStatus: StatusCasa,
  atualizadoPor: string,
  agora: string,
): Promise<void> {
  await documentoDb.send(
    new UpdateCommand({
      TableName: nomeTabela(),
      Key: chaveCasa(casaId),
      ConditionExpression: "attribute_exists(PK)",
      UpdateExpression:
        "SET #status = :status, versao = versao + :um, publicacaoPendente = :pendente, " +
        "atualizadoEm = :agora, atualizadoPor = :por",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": novoStatus,
        ":um": 1,
        ":pendente": true,
        ":agora": agora,
        ":por": atualizadoPor,
      },
    }),
  );
}

/**
 * Padrões de `CONFIG/GERAL` por campo, aplicados quando o item (ou o campo) ainda
 * não existe no banco — `CONFIG/GERAL` não tem escrita alguma até UC-A13 (Fase 2),
 * então hoje **todo** ambiente cai nestes valores.
 *
 * Só os quatro primeiros têm "padrão" de fato documentado (UC-A13). Os demais —
 * identidade, contato, política de cancelamento, textos legais — não têm valor
 * de sistema sensato (são conteúdo do proprietário, `[DEFINIR]` em
 * docs/06-planejamento/02-pendencias-definir.md), e caem no vazio do próprio
 * tipo (string vazia, array vazio, `false`) em vez de um valor inventado.
 */
const CONFIG_GERAL_PADRAO: ConfigGeral = {
  prazoSolicitacaoHoras: 48,
  antecedenciaMinimaDias: 1,
  janelaReservaMeses: 12,
  horarioCheckin: "14:00",
  horarioCheckout: "12:00",
  maxSolicitacoesPendentesPorEmail: 3,
  nomeFazenda: "",
  whatsapp: "",
  emailAdmin: "",
  emailRemetente: "",
  emailResponder: "",
  faixasCancelamento: [],
  devolveTaxaLimpeza: false,
  textoCancelamento: "",
  textoPrivacidade: "",
  textoTermos: "",
  textoRegrasGerais: "",
  faq: [],
};

/**
 * `GetItem CONFIG/GERAL`, sempre com todos os campos presentes — nunca `undefined`,
 * mesmo que o item não exista ainda no banco. Fonte única dos padrões: tanto
 * `GET /api/config-publica` (UC-A13, RN14) quanto `POST /api/cotacao` (UC-P03)
 * leem daqui, cada um usando só os campos que precisa.
 */
export async function obterConfigGeral(): Promise<ConfigGeral> {
  const resultado = await documentoDb.send(
    new GetCommand({ TableName: nomeTabela(), Key: { PK: "CONFIG", SK: "GERAL" } }),
  );

  return { ...CONFIG_GERAL_PADRAO, ...(resultado.Item as Partial<ConfigGeral> | undefined) };
}

/**
 * `Query PK = OCUPACAO#<casaId>, SK BETWEEN NOITE#<de> AND NOITE#<ate>`, paginando
 * até esgotar o intervalo (até 13 meses ≈ 400 itens — algumas páginas, no máximo).
 *
 * `ProjectionExpression` pede só o necessário para decidir livre/ocupado: trazer o
 * item inteiro arriscaria vazar `refId` numa refatoração futura (UC-P02).
 */
export async function consultarOcupacoes(
  casaId: string,
  de: string,
  ate: string,
): Promise<ItemOcupacao[]> {
  const itens: ItemOcupacao[] = [];
  let chaveExclusiva: Record<string, unknown> | undefined;

  do {
    const pagina = await documentoDb.send(
      new QueryCommand({
        TableName: nomeTabela(),
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :de AND :ate",
        ProjectionExpression: "SK, pendente, expiraEm",
        ExpressionAttributeValues: {
          ":pk": `OCUPACAO#${casaId}`,
          ":de": `NOITE#${de}`,
          ":ate": `NOITE#${ate}`,
        },
        ExclusiveStartKey: chaveExclusiva,
      }),
    );

    itens.push(...((pagina.Items ?? []) as ItemOcupacao[]));
    chaveExclusiva = pagina.LastEvaluatedKey;
  } while (chaveExclusiva !== undefined);

  return itens;
}
