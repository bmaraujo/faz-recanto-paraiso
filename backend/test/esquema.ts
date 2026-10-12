/**
 * Schema da tabela única, replicado aqui a partir de
 * docs/03-tecnico/02-modelo-de-dados.md e docs/03-tecnico/12-infraestrutura-cdk.md.
 *
 * Usado só pelos testes de integração, contra o DynamoDB Local
 * (docs/03-tecnico/14-estrategia-de-testes.md). Quando `infra/` nascer com o CDK
 * real, o ideal é que o construct da tabela importe estas mesmas constantes de
 * nome de atributo, para as duas definições nunca divergirem.
 */

import {
  CreateTableCommand,
  DeleteTableCommand,
  type DynamoDBClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";

export async function criarTabela(cliente: DynamoDBClient, nomeTabela: string): Promise<void> {
  await cliente.send(
    new CreateTableCommand({
      TableName: nomeTabela,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );
}

export async function apagarTabela(cliente: DynamoDBClient, nomeTabela: string): Promise<void> {
  try {
    await cliente.send(new DeleteTableCommand({ TableName: nomeTabela }));
  } catch (erro) {
    if (!(erro instanceof ResourceNotFoundException)) throw erro;
  }
}
