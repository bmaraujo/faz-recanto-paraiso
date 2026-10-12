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

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { configPrecosSchema, type ConfigPrecos } from "@recanto/shared";

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

const ANTECEDENCIA_MINIMA_DIAS_PADRAO = 1;
const JANELA_RESERVA_MESES_PADRAO = 12;

/**
 * `GetItem CONFIG/GERAL`, projetado às duas únicas chaves que `calcularCotacao`
 * precisa (UC-P03). Os padrões são os documentados em UC-A13 — `CONFIG/GERAL`
 * ainda não tem escrita alguma (Fase 2), então na prática todo ambiente novo cai
 * nestes valores até o admin configurar o contrário.
 */
export async function obterConfigGeralCotacao(): Promise<{
  antecedenciaMinimaDias: number;
  janelaReservaMeses: number;
}> {
  const resultado = await documentoDb.send(
    new GetCommand({
      TableName: nomeTabela(),
      Key: { PK: "CONFIG", SK: "GERAL" },
      ProjectionExpression: "antecedenciaMinimaDias, janelaReservaMeses",
    }),
  );

  const item = resultado.Item as
    | { antecedenciaMinimaDias?: number; janelaReservaMeses?: number }
    | undefined;

  return {
    antecedenciaMinimaDias: item?.antecedenciaMinimaDias ?? ANTECEDENCIA_MINIMA_DIAS_PADRAO,
    janelaReservaMeses: item?.janelaReservaMeses ?? JANELA_RESERVA_MESES_PADRAO,
  };
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
