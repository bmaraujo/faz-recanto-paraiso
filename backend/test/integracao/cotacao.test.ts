/**
 * Teste de integração de `POST /api/cotacao` (UC-P03), contra o DynamoDB Local
 * (docs/03-tecnico/14-estrategia-de-testes.md).
 *
 * Cobre o caminho que o teste de unidade mocka: ler `CASA#<id>/PRECOS` de verdade
 * (incluindo a validação de forma via `configPrecosSchema` em `lib/db.ts`) e cruzar
 * com a ocupação real da mesma tabela.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { ConfigPrecos } from "@recanto/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Nome próprio: ver o mesmo comentário em test/integracao/disponibilidade.test.ts.
process.env.TABELA = "recanto-paraiso-test-cotacao";

import { handler } from "../../src/handlers/api-publica";
import {
  chaveCasa,
  chaveOcupacao,
  chavePrecos,
  clienteDynamoDB,
  documentoDb,
  nomeTabela,
} from "../../src/lib/db";
import { apagarTabela, criarTabela } from "../esquema";
import { criarEvento } from "../evento-teste";

const TABELA = nomeTabela();

// Mesmo exemplo de docs/02-casos-de-uso/publico/UC-P03-simular-preco.md.
const CONFIG_PRECOS: ConfigPrecos = {
  diariaBaseCentavos: 50_000,
  diariaFimDeSemanaCentavos: 65_000,
  diasFimDeSemana: ["SEX", "SAB"],
  temporadas: [],
  feriados: [],
  minNoitesPadrao: 2,
  maxNoites: 60,
  taxaLimpezaCentavos: 25_000,
  hospedesInclusos: 6,
  capacidadeMaxima: 10,
  valorHospedeExtraPorNoiteCentavos: 5_000,
};

async function gravarCasa(casaId: string, status: string): Promise<void> {
  await documentoDb.send(
    new PutCommand({ TableName: TABELA, Item: { ...chaveCasa(casaId), casaId, status } }),
  );
}

async function gravarPrecos(casaId: string, config: ConfigPrecos): Promise<void> {
  await documentoDb.send(
    new PutCommand({ TableName: TABELA, Item: { ...chavePrecos(casaId), casaId, ...config } }),
  );
}

async function gravarOcupacao(casaId: string, data: string): Promise<void> {
  await documentoDb.send(
    new PutCommand({
      TableName: TABELA,
      Item: { ...chaveOcupacao(casaId, data), casaId, data, tipo: "RESERVA" },
    }),
  );
}

function cotar(corpo: unknown) {
  return handler(criarEvento("POST", "/api/cotacao", { body: JSON.stringify(corpo) }));
}

describe("POST /api/cotacao (integração)", () => {
  beforeAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
    await criarTabela(clienteDynamoDB, TABELA);
  });

  afterAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
  });

  beforeEach(() => {
    // Só `Date`: o SDK da AWS usa `setTimeout` internamente (retry/keep-alive), e
    // fakear timers globalmente trava a chamada real ao DynamoDB Local.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calcula a cotação de verdade a partir dos itens da tabela", async () => {
    const CASA_ID = "01HQCASA000000000000000001";
    await gravarCasa(CASA_ID, "ATIVA");
    await gravarPrecos(CASA_ID, CONFIG_PRECOS);

    const resposta = await cotar({
      casaId: CASA_ID,
      checkin: "2026-11-20",
      checkout: "2026-11-23",
      hospedes: 7,
    });

    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body as string)).toMatchObject({
      totalCentavos: 220_000,
      disponivel: true,
      noitesIndisponiveis: [],
    });
  });

  it("cruza com a ocupação real: noite ocupada vira disponivel:false sem perder o preço", async () => {
    const CASA_ID = "01HQCASA000000000000000002";
    await gravarCasa(CASA_ID, "ATIVA");
    await gravarPrecos(CASA_ID, CONFIG_PRECOS);
    await gravarOcupacao(CASA_ID, "2026-11-21");

    const resposta = await cotar({
      casaId: CASA_ID,
      checkin: "2026-11-20",
      checkout: "2026-11-23",
      hospedes: 7,
    });
    const corpo = JSON.parse(resposta.body as string) as {
      disponivel: boolean;
      noitesIndisponiveis: string[];
      totalCentavos: number;
    };

    expect(resposta.statusCode).toBe(200);
    expect(corpo.disponivel).toBe(false);
    expect(corpo.noitesIndisponiveis).toEqual(["2026-11-21"]);
    expect(corpo.totalCentavos).toBe(220_000);
  });

  it("responde 404 quando a casa existe mas não tem o item de preços", async () => {
    const CASA_ID = "01HQCASA000000000000000003";
    await gravarCasa(CASA_ID, "ATIVA");

    const resposta = await cotar({
      casaId: CASA_ID,
      checkin: "2026-11-20",
      checkout: "2026-11-23",
      hospedes: 2,
    });

    expect(resposta.statusCode).toBe(404);
  });

  it("responde 422 quando a estadia fica abaixo do mínimo de noites da casa", async () => {
    const CASA_ID = "01HQCASA000000000000000004";
    await gravarCasa(CASA_ID, "ATIVA");
    await gravarPrecos(CASA_ID, CONFIG_PRECOS);

    const resposta = await cotar({
      casaId: CASA_ID,
      checkin: "2026-11-20",
      checkout: "2026-11-21",
      hospedes: 2,
    });

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "MINIMO_NOITES" });
  });
});
