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

const NOME_TABELA_PADRAO = "recanto-paraiso-dev";

/**
 * `DYNAMODB_ENDPOINT` só é definida em teste de integração (DynamoDB Local via
 * Docker — docs/03-tecnico/14-estrategia-de-testes.md). Em produção, o SDK resolve
 * o endpoint real a partir da região do ambiente Lambda.
 */
/** Exportado para o teste de integração criar/apagar a tabela (`test/esquema.ts`). */
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
