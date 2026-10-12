/**
 * Teste de integração de `GET /api/casas/{casaId}/disponibilidade` (UC-P02),
 * contra o DynamoDB Local (docs/03-tecnico/14-estrategia-de-testes.md).
 *
 * Diferente do teste de unidade (que mocka `lib/db`), este grava itens reais e
 * valida o `Query`/`KeyConditionExpression` de verdade — é o que pegaria, por
 * exemplo, um `BETWEEN` com a chave errada ou uma `ProjectionExpression` que não
 * compila contra o schema real da tabela.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { handler } from "../../src/handlers/api-publica";
import { chaveCasa, chaveOcupacao, clienteDynamoDB, documentoDb, nomeTabela } from "../../src/lib/db";
import { apagarTabela, criarTabela } from "../esquema";
import { criarEvento } from "../evento-teste";

const TABELA = nomeTabela();

async function gravarCasa(casaId: string, status: string): Promise<void> {
  await documentoDb.send(
    new PutCommand({ TableName: TABELA, Item: { ...chaveCasa(casaId), casaId, status } }),
  );
}

async function gravarOcupacao(
  casaId: string,
  data: string,
  extras: { pendente?: boolean; expiraEm?: string } = {},
): Promise<void> {
  await documentoDb.send(
    new PutCommand({
      TableName: TABELA,
      Item: { ...chaveOcupacao(casaId, data), casaId, data, tipo: "RESERVA", ...extras },
    }),
  );
}

function consultar(casaId: string, de: string, ate: string) {
  return handler(
    criarEvento("GET", `/api/casas/${casaId}/disponibilidade`, {
      queryStringParameters: { de, ate },
    }),
  );
}

describe("GET /api/casas/{casaId}/disponibilidade (integração)", () => {
  beforeAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
    await criarTabela(clienteDynamoDB, TABELA);
  });

  afterAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
  });

  describe("casa ativa com ocupações reais", () => {
    const CASA_ID = "casa-ativa-integracao";

    beforeEach(async () => {
      await gravarCasa(CASA_ID, "ATIVA");
      // Reserva confirmada: 20, 21, 22 ocupadas (23 é check-out, livre - RN6/UC-P02).
      await gravarOcupacao(CASA_ID, "2026-11-20");
      await gravarOcupacao(CASA_ID, "2026-11-21");
      await gravarOcupacao(CASA_ID, "2026-11-22");
      // Pendência vencida: noite livre (R4).
      await gravarOcupacao(CASA_ID, "2026-12-01", {
        pendente: true,
        expiraEm: "2000-01-01T00:00:00Z",
      });
      // Pendência válida: noite ocupada.
      await gravarOcupacao(CASA_ID, "2026-12-05", {
        pendente: true,
        expiraEm: "2099-01-01T00:00:00Z",
      });
    });

    it("devolve só as noites efetivamente ocupadas, ordenadas", async () => {
      const resposta = await consultar(CASA_ID, "2026-11-01", "2026-12-31");

      expect(resposta.statusCode).toBe(200);
      expect(JSON.parse(resposta.body as string)).toMatchObject({
        casaId: CASA_ID,
        noitesOcupadas: ["2026-11-20", "2026-11-21", "2026-11-22", "2026-12-05"],
      });
    });

    it("pagina corretamente quando o intervalo tem muitas noites", async () => {
      // Memória: o `Query` do DynamoDB Local pagina em ~1 MB; isso não cobre a
      // paginação de verdade, mas cobre a mecânica de `ExclusiveStartKey` no loop.
      const resposta = await consultar(CASA_ID, "2026-01-01", "2026-12-31");
      expect(resposta.statusCode).toBe(200);
      const corpo = JSON.parse(resposta.body as string) as { noitesOcupadas: string[] };
      expect(corpo.noitesOcupadas).toContain("2026-11-20");
    });
  });

  it("responde 404 para casa inativa, mesmo com ocupação gravada", async () => {
    const CASA_ID = "casa-inativa-integracao";
    await gravarCasa(CASA_ID, "INATIVA");
    await gravarOcupacao(CASA_ID, "2026-11-20");

    const resposta = await consultar(CASA_ID, "2026-11-01", "2026-11-30");

    expect(resposta.statusCode).toBe(404);
  });

  it("responde 404 para casaId que não existe na tabela", async () => {
    const resposta = await consultar("casa-que-nao-existe", "2026-11-01", "2026-11-30");
    expect(resposta.statusCode).toBe(404);
  });

  it("responde 200 com lista vazia quando a casa está ativa e livre", async () => {
    const CASA_ID = "casa-livre-integracao";
    await gravarCasa(CASA_ID, "ATIVA");

    const resposta = await consultar(CASA_ID, "2026-11-01", "2026-11-30");

    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ noitesOcupadas: [] });
  });
});
