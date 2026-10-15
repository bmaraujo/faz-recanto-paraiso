/**
 * Teste de integração de `GET /api/config-publica` (UC-A13, RN14), contra o
 * DynamoDB Local (docs/03-tecnico/14-estrategia-de-testes.md).
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Nome próprio: ver o mesmo comentário em test/integracao/disponibilidade.test.ts.
process.env.TABELA = "recanto-paraiso-test-config-publica";

import { handler } from "../../src/handlers/api-publica";
import { clienteDynamoDB, documentoDb, nomeTabela } from "../../src/lib/db";
import { apagarTabela, criarTabela } from "../esquema";
import { criarEvento } from "../evento-teste";

const TABELA = nomeTabela();

function consultarConfigPublica() {
  return handler(criarEvento("GET", "/api/config-publica"));
}

describe("GET /api/config-publica (integração)", () => {
  beforeAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
    await criarTabela(clienteDynamoDB, TABELA);
  });

  afterAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
  });

  it("responde 200 com os padrões documentados quando CONFIG/GERAL não existe ainda", async () => {
    const resposta = await consultarConfigPublica();

    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body as string)).toEqual({
      nomeFazenda: "",
      whatsapp: "",
      horarioCheckin: "14:00",
      horarioCheckout: "12:00",
      antecedenciaMinimaDias: 1,
      janelaReservaMeses: 12,
      faixasCancelamento: [],
      devolveTaxaLimpeza: false,
      textoCancelamento: "",
      textoPrivacidade: "",
      textoTermos: "",
      textoRegrasGerais: "",
      faq: [],
    });
  });

  it("reflete o item real gravado na tabela, sem os campos privados", async () => {
    await documentoDb.send(
      new PutCommand({
        TableName: TABELA,
        Item: {
          PK: "CONFIG",
          SK: "GERAL",
          nomeFazenda: "Recanto Paraíso",
          whatsapp: "+5511999999999",
          emailAdmin: "proprietario@exemplo.com.br",
          emailRemetente: "reservas@exemplo.com.br",
          prazoSolicitacaoHoras: 72,
          maxSolicitacoesPendentesPorEmail: 5,
          horarioCheckin: "15:00",
        },
      }),
    );

    const resposta = await consultarConfigPublica();
    const corpo = JSON.parse(resposta.body as string) as Record<string, unknown>;

    expect(resposta.statusCode).toBe(200);
    expect(corpo.nomeFazenda).toBe("Recanto Paraíso");
    expect(corpo.whatsapp).toBe("+5511999999999");
    // Campo gravado explicitamente vence o padrão.
    expect(corpo.horarioCheckin).toBe("15:00");
    // Campo não gravado cai no padrão documentado (UC-A13).
    expect(corpo.horarioCheckout).toBe("12:00");
    // Nunca os campos privados, mesmo estando no item real do banco.
    expect(corpo.emailAdmin).toBeUndefined();
    expect(corpo.emailRemetente).toBeUndefined();
    expect(corpo.prazoSolicitacaoHoras).toBeUndefined();
    expect(corpo.maxSolicitacoesPendentesPorEmail).toBeUndefined();
  });
});
