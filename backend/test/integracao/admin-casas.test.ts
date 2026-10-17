/**
 * Teste de integração de `POST /api/admin/casas` (UC-A02), contra o DynamoDB
 * Local (docs/03-tecnico/14-estrategia-de-testes.md).
 *
 * Cobre o que o teste de unidade mocka: a transação de `lib/db.ts#criarCasa` —
 * unicidade de slug via `ConditionExpression` (RN3), inclusive sob concorrência
 * real, e que os três itens (slug, casa, preços padrão) nascem juntos.
 *
 * `exigirAdmin` continua mockado aqui, como no teste de unidade: a verificação
 * do JWT já tem cobertura própria e real em `test/unit/lib/auth.test.ts`
 * (via `cacheJwks`) — este arquivo testa a transação, não a autenticação.
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Identidade } from "../../src/lib/auth";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Nome próprio: ver o mesmo comentário em test/integracao/disponibilidade.test.ts.
process.env.TABELA = "recanto-paraiso-test-admin-casas";

const { exigirAdmin, criarVerificadorAdmin } = vi.hoisted(() => ({
  exigirAdmin: vi.fn<(evento: unknown, verificador: unknown) => Promise<Identidade>>(),
  criarVerificadorAdmin: vi.fn(() => ({})),
}));
vi.mock("../../src/lib/auth", () => ({ exigirAdmin, criarVerificadorAdmin }));

import { handler } from "../../src/handlers/api-admin";
import { chaveSlug, clienteDynamoDB, documentoDb, nomeTabela } from "../../src/lib/db";
import { apagarTabela, criarTabela } from "../esquema";
import { criarEvento } from "../evento-teste";

const TABELA = nomeTabela();
const ADMIN: Identidade = { sub: "01HQADMINTESTE" };

const CASA_VALIDA = {
  nome: "Casa do Lago",
  slug: "casa-do-lago",
  resumo: "Casa de madeira à beira do lago, para até 8 pessoas.",
  descricao:
    "## Sobre a casa\n\nUma casa de madeira espaçosa, com varanda de frente para o lago.",
  status: "RASCUNHO",
  ordem: 10,
  destaque: false,
  capacidadeMaxima: 8,
  hospedesInclusos: 6,
  quartos: 3,
  banheiros: 2,
  camas: [{ tipo: "CASAL", quantidade: 1, ambiente: "Suíte" }],
  comodidades: ["LAGO", "WIFI"],
  localizacao: { enderecoPublico: "Zona rural, Município X - UF" },
};

function criarCasaViaHandler(corpo: unknown) {
  return handler(
    criarEvento("POST", "/api/admin/casas", {
      headers: { authorization: "Bearer token-de-teste" },
      body: JSON.stringify(corpo),
    }),
  );
}

function atualizarCasaViaHandler(casaId: string, corpo: unknown) {
  return handler(
    criarEvento("PUT", `/api/admin/casas/${casaId}`, {
      headers: { authorization: "Bearer token-de-teste" },
      body: JSON.stringify(corpo),
    }),
  );
}

function alterarStatusViaHandler(casaId: string, status: string) {
  return handler(
    criarEvento("POST", `/api/admin/casas/${casaId}/status`, {
      headers: { authorization: "Bearer token-de-teste" },
      body: JSON.stringify({ status }),
    }),
  );
}

function listarCasasViaHandler() {
  return handler(
    criarEvento("GET", "/api/admin/casas", {
      headers: { authorization: "Bearer token-de-teste" },
    }),
  );
}

function obterCasaViaHandler(casaId: string) {
  return handler(
    criarEvento("GET", `/api/admin/casas/${casaId}`, {
      headers: { authorization: "Bearer token-de-teste" },
    }),
  );
}

const PRECOS_VALIDOS = {
  diariaBaseCentavos: 50_000,
  diariaFimDeSemanaCentavos: 65_000,
  diasFimDeSemana: ["SEX", "SAB"],
  temporadas: [],
  feriados: [],
  minNoitesPadrao: 2,
  maxNoites: 60,
  taxaLimpezaCentavos: 25_000,
  hospedesInclusos: 6,
  capacidadeMaxima: 8,
  valorHospedeExtraPorNoiteCentavos: 5_000,
};

const FOTO_PRINCIPAL = {
  fotoId: "01HQ9999999999999999999999".slice(0, 26),
  chave: "midia/casas/fachada.webp",
  largura: 1600,
  altura: 1067,
  bytes: 184_320,
  legenda: "Fachada",
  textoAlternativo: "Casa de madeira vista do lago",
  ordem: 10,
  principal: true,
  enviadaEm: "2026-10-11T18:04:00-03:00",
};

describe("POST /api/admin/casas (integração)", () => {
  beforeAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
    await criarTabela(clienteDynamoDB, TABELA);
  });

  afterAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
  });

  beforeEach(() => {
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue(ADMIN);
    // Só `Date`: ver o mesmo comentário em test/integracao/cotacao.test.ts.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cria os três itens da transação: slug, casa e preços padrão", async () => {
    const resposta = await criarCasaViaHandler(CASA_VALIDA);
    expect(resposta.statusCode).toBe(201);
    const casaId = (JSON.parse(resposta.body as string) as { casaId: string }).casaId;

    const slug = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: chaveSlug(CASA_VALIDA.slug) }),
    );
    expect(slug.Item).toMatchObject({ casaId });

    const casa = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: { PK: `CASA#${casaId}`, SK: "META" } }),
    );
    expect(casa.Item).toMatchObject({
      nome: CASA_VALIDA.nome,
      status: "RASCUNHO",
      GSI1PK: "CASAS",
      GSI1SK: `0010#${casaId}`,
    });

    const precos = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: { PK: `CASA#${casaId}`, SK: "PRECOS" } }),
    );
    expect(precos.Item).toMatchObject({
      diariaBaseCentavos: 0,
      capacidadeMaxima: CASA_VALIDA.capacidadeMaxima,
      hospedesInclusos: CASA_VALIDA.hospedesInclusos,
    });
  });

  it("E1: a segunda criação com o mesmo slug falha com 409 SLUG_EM_USO", async () => {
    const primeira = await criarCasaViaHandler({ ...CASA_VALIDA, slug: "slug-duplicado" });
    expect(primeira.statusCode).toBe(201);

    const segunda = await criarCasaViaHandler({ ...CASA_VALIDA, slug: "slug-duplicado" });
    expect(segunda.statusCode).toBe(409);
    expect(JSON.parse(segunda.body as string)).toMatchObject({ erro: "SLUG_EM_USO" });
  });

  it("caso de teste 3: duas criações simultâneas com o mesmo slug — 1 sucesso, 1 409", async () => {
    const [a, b] = await Promise.all([
      criarCasaViaHandler({ ...CASA_VALIDA, slug: "slug-concorrente" }),
      criarCasaViaHandler({ ...CASA_VALIDA, slug: "slug-concorrente" }),
    ]);

    const statusCodes = [a.statusCode, b.statusCode].sort();
    expect(statusCodes).toEqual([201, 409]);
  });
});

describe("PUT /api/admin/casas/{casaId} (integração)", () => {
  beforeAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
    await criarTabela(clienteDynamoDB, TABELA);
  });

  afterAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
  });

  beforeEach(() => {
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue(ADMIN);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function criarCasaDeTeste(slug: string): Promise<{ casaId: string; versao: number }> {
    const resposta = await criarCasaViaHandler({ ...CASA_VALIDA, slug });
    const casa = JSON.parse(resposta.body as string) as { casaId: string; versao: number };
    return casa;
  }

  it("atualiza o item de verdade e incrementa a versao", async () => {
    const { casaId, versao } = await criarCasaDeTeste("casa-para-editar");

    const resposta = await atualizarCasaViaHandler(casaId, {
      ...CASA_VALIDA,
      slug: "casa-para-editar",
      nome: "Casa do Lago — Reformada",
      versao,
    });

    expect(resposta.statusCode).toBe(200);
    const casaAtualizada = JSON.parse(resposta.body as string) as { versao: number; nome: string };
    expect(casaAtualizada.versao).toBe(versao + 1);
    expect(casaAtualizada.nome).toBe("Casa do Lago — Reformada");

    const item = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: { PK: `CASA#${casaId}`, SK: "META" } }),
    );
    expect(item.Item).toMatchObject({ nome: "Casa do Lago — Reformada", versao: versao + 1 });
  });

  it("E9: PUT com versao antiga (desatualizada) falha com 409 CONFLITO_VERSAO", async () => {
    const { casaId, versao } = await criarCasaDeTeste("casa-versao-antiga");

    const primeira = await atualizarCasaViaHandler(casaId, {
      ...CASA_VALIDA,
      slug: "casa-versao-antiga",
      versao,
    });
    expect(primeira.statusCode).toBe(200);

    // Reenvia com a mesma versao antiga (0), já consumida pela escrita acima.
    const segunda = await atualizarCasaViaHandler(casaId, {
      ...CASA_VALIDA,
      slug: "casa-versao-antiga",
      versao,
    });

    expect(segunda.statusCode).toBe(409);
    expect(JSON.parse(segunda.body as string)).toMatchObject({ erro: "CONFLITO_VERSAO" });
  });

  it("18: muda o slug de uma casa em RASCUNHO — remove o índice antigo, cria o novo", async () => {
    const { casaId, versao } = await criarCasaDeTeste("slug-antigo");

    const resposta = await atualizarCasaViaHandler(casaId, {
      ...CASA_VALIDA,
      slug: "slug-novo",
      versao,
    });
    expect(resposta.statusCode).toBe(200);

    const slugAntigo = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: chaveSlug("slug-antigo") }),
    );
    expect(slugAntigo.Item).toBeUndefined();

    const slugNovo = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: chaveSlug("slug-novo") }),
    );
    expect(slugNovo.Item).toMatchObject({ casaId });
  });

  it("E1 na edição: mudar para um slug já usado por outra casa falha com 409 SLUG_EM_USO", async () => {
    await criarCasaDeTeste("slug-ja-existente");
    const { casaId, versao } = await criarCasaDeTeste("slug-proprio");

    const resposta = await atualizarCasaViaHandler(casaId, {
      ...CASA_VALIDA,
      slug: "slug-ja-existente",
      versao,
    });

    expect(resposta.statusCode).toBe(409);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "SLUG_EM_USO" });

    // A troca falhou: a casa continua com o slug original e a versao não muda.
    const item = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: { PK: `CASA#${casaId}`, SK: "META" } }),
    );
    expect(item.Item).toMatchObject({ slug: "slug-proprio", versao });
  });

  it("17/E6: mudar o slug de uma casa ATIVA falha com 422 SLUG_IMUTAVEL, sem tocar o banco", async () => {
    const { casaId, versao } = await criarCasaDeTeste("slug-fixo");
    // Ativa fora do fluxo de status (ainda não construído) só para o teste: escreve
    // direto, já que o que importa aqui é o handler de PUT ler esse status do banco.
    await documentoDb.send(
      new UpdateCommand({
        TableName: TABELA,
        Key: { PK: `CASA#${casaId}`, SK: "META" },
        UpdateExpression: "SET #status = :ativa",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":ativa": "ATIVA" },
      }),
    );

    const resposta = await atualizarCasaViaHandler(casaId, {
      ...CASA_VALIDA,
      slug: "slug-que-nao-pode",
      versao,
    });

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "SLUG_IMUTAVEL" });

    const slugOriginal = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: chaveSlug("slug-fixo") }),
    );
    expect(slugOriginal.Item).toMatchObject({ casaId });
  });
});

describe("POST /api/admin/casas/{casaId}/status (integração)", () => {
  beforeAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
    await criarTabela(clienteDynamoDB, TABELA);
  });

  afterAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
  });

  beforeEach(() => {
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue(ADMIN);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function criarCasaDeTeste(slug: string): Promise<{ casaId: string; versao: number }> {
    const resposta = await criarCasaViaHandler({ ...CASA_VALIDA, slug });
    return JSON.parse(resposta.body as string) as { casaId: string; versao: number };
  }

  it("9: ativa uma casa com fotos e preços reais, incrementando a versao de verdade", async () => {
    const { casaId, versao } = await criarCasaDeTeste("casa-pronta-para-ativar");

    await documentoDb.send(
      new UpdateCommand({
        TableName: TABELA,
        Key: { PK: `CASA#${casaId}`, SK: "META" },
        UpdateExpression: "SET fotos = :fotos",
        ExpressionAttributeValues: { ":fotos": [FOTO_PRINCIPAL] },
      }),
    );
    await documentoDb.send(
      new UpdateCommand({
        TableName: TABELA,
        Key: { PK: `CASA#${casaId}`, SK: "PRECOS" },
        UpdateExpression:
          "SET diariaBaseCentavos = :diaria, hospedesInclusos = :hi, capacidadeMaxima = :cm, maxNoites = :mn, minNoitesPadrao = :mnp",
        ExpressionAttributeValues: {
          ":diaria": PRECOS_VALIDOS.diariaBaseCentavos,
          ":hi": PRECOS_VALIDOS.hospedesInclusos,
          ":cm": PRECOS_VALIDOS.capacidadeMaxima,
          ":mn": PRECOS_VALIDOS.maxNoites,
          ":mnp": PRECOS_VALIDOS.minNoitesPadrao,
        },
      }),
    );

    const resposta = await alterarStatusViaHandler(casaId, "ATIVA");

    expect(resposta.statusCode).toBe(200);
    const item = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: { PK: `CASA#${casaId}`, SK: "META" } }),
    );
    expect(item.Item).toMatchObject({ status: "ATIVA", versao: versao + 1 });
  });

  it("6/7: casa recém-criada (sem foto, preços zerados) não pode ativar — 422", async () => {
    const { casaId } = await criarCasaDeTeste("casa-incompleta");

    const resposta = await alterarStatusViaHandler(casaId, "ATIVA");

    expect(resposta.statusCode).toBe(422);
    const corpo = JSON.parse(resposta.body as string) as { detalhes: { faltando: string[] } };
    expect(corpo.detalhes.faltando).toContain("fotos");
    expect(corpo.detalhes.faltando).toContain("precos");
  });

  it("decisão 22: status muda a versao de verdade, então um PUT concorrente com a versao antiga falha (não sobrescreve o status)", async () => {
    const { casaId, versao } = await criarCasaDeTeste("casa-corrida-com-status");

    // Simula o PUT tendo lido a versao antes da troca de status abaixo.
    const statusAlterado = await alterarStatusViaHandler(casaId, "INATIVA");
    expect(statusAlterado.statusCode).toBe(200);

    const putComVersaoAntiga = await atualizarCasaViaHandler(casaId, {
      ...CASA_VALIDA,
      slug: "casa-corrida-com-status",
      versao, // a versao de antes da troca de status — já está obsoleta
    });

    expect(putComVersaoAntiga.statusCode).toBe(409);
    expect(JSON.parse(putComVersaoAntiga.body as string)).toMatchObject({ erro: "CONFLITO_VERSAO" });

    // O status trocado por alterarStatusViaHandler continua de pé.
    const item = await documentoDb.send(
      new GetCommand({ TableName: TABELA, Key: { PK: `CASA#${casaId}`, SK: "META" } }),
    );
    expect(item.Item).toMatchObject({ status: "INATIVA" });
  });
});

describe("GET /api/admin/casas{,/{casaId}} (integração)", () => {
  beforeAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
    await criarTabela(clienteDynamoDB, TABELA);
  });

  afterAll(async () => {
    await apagarTabela(clienteDynamoDB, TABELA);
  });

  beforeEach(() => {
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue(ADMIN);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lista as casas via GSI1, já na ordem de exibição (campo ordem)", async () => {
    await criarCasaViaHandler({ ...CASA_VALIDA, slug: "casa-c", nome: "Casa C", ordem: 30 });
    await criarCasaViaHandler({ ...CASA_VALIDA, slug: "casa-a", nome: "Casa A", ordem: 10 });
    await criarCasaViaHandler({ ...CASA_VALIDA, slug: "casa-b", nome: "Casa B", ordem: 20 });

    const resposta = await listarCasasViaHandler();
    expect(resposta.statusCode).toBe(200);

    const { casas } = JSON.parse(resposta.body as string) as { casas: { nome: string }[] };
    expect(casas.map((c) => c.nome)).toEqual(["Casa A", "Casa B", "Casa C"]);
  });

  it("uma casa recém-criada (sem foto, preços zerados) aparece incompleta na lista", async () => {
    await criarCasaViaHandler({ ...CASA_VALIDA, slug: "casa-recente", ordem: 1 });

    const resposta = await listarCasasViaHandler();
    const { casas } = JSON.parse(resposta.body as string) as {
      casas: { completa: boolean; temPrecos: boolean; totalFotos: number; reservasAtivas: number }[];
    };

    expect(casas[0]).toMatchObject({
      completa: false,
      temPrecos: false,
      totalFotos: 0,
      reservasAtivas: 0,
    });
  });

  it("GET /{casaId} devolve a casa completa de verdade, incluindo tokenIcal", async () => {
    const resposta = await criarCasaViaHandler({ ...CASA_VALIDA, slug: "casa-detalhe" });
    const { casaId, tokenIcal } = JSON.parse(resposta.body as string) as {
      casaId: string;
      tokenIcal: string;
    };

    const detalhe = await obterCasaViaHandler(casaId);
    expect(detalhe.statusCode).toBe(200);
    expect(JSON.parse(detalhe.body as string)).toMatchObject({ casaId, tokenIcal, slug: "casa-detalhe" });
  });

  it("GET /{casaId} de uma casa inexistente responde 404", async () => {
    const resposta = await obterCasaViaHandler("01HQNAOEXISTENTE000000001");
    expect(resposta.statusCode).toBe(404);
  });
});
