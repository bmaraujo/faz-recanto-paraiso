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

import { DynamoDBClient, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

import { configPrecosSchema, type Casa, type ConfigGeral, type ConfigPrecos } from "@recanto/shared";

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
