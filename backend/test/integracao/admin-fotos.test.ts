/**
 * Teste de integração de `POST /api/admin/casas/{casaId}/fotos/upload` (UC-A03),
 * contra o DynamoDB Local (docs/03-tecnico/14-estrategia-de-testes.md).
 *
 * Cobre o que o teste de unidade mocka: a leitura real da casa (`obterCasa`) e
 * o presigned POST real (`lib/s3.ts#criarPresignedPostFoto`) — que não faz
 * nenhuma chamada de rede: `createPresignedPost` só assina a policy
 * localmente, por isso roda aqui sem depender de S3 de verdade (nenhum
 * LocalStack neste projeto — ver a mesma observação em `lib/s3.ts`). As
 * credenciais de `vitest.integracao.config.ts` (`AWS_ACCESS_KEY_ID=local`)
 * bastam para a assinatura; só importariam de verdade se o teste tentasse de
 * fato enviar um arquivo ao S3, o que este UC não faz nesta camada.
 *
 * `exigirAdmin` continua mockado, como em `admin-casas.test.ts` — a mesma
 * razão: a verificação do JWT já tem cobertura própria em `test/unit/lib/auth.test.ts`.
 */
import type { Identidade } from "../../src/lib/auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Nome próprio: ver o mesmo comentário em test/integracao/disponibilidade.test.ts.
process.env.TABELA = "recanto-paraiso-test-admin-fotos";
process.env.BUCKET = "recanto-paraiso-test-bucket";

const { exigirAdmin, criarVerificadorAdmin } = vi.hoisted(() => ({
  exigirAdmin: vi.fn<(evento: unknown, verificador: unknown) => Promise<Identidade>>(),
  criarVerificadorAdmin: vi.fn(() => ({})),
}));
vi.mock("../../src/lib/auth", () => ({ exigirAdmin, criarVerificadorAdmin }));

import { handler } from "../../src/handlers/api-admin";
import { clienteDynamoDB, nomeTabela } from "../../src/lib/db";
import { apagarTabela, criarTabela } from "../esquema";
import { criarEvento } from "../evento-teste";

const TABELA = nomeTabela();
const ADMIN: Identidade = { sub: "01HQADMINTESTE" };

const CASA_VALIDA = {
  nome: "Casa do Lago",
  slug: "casa-do-lago-fotos",
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

const UPLOAD_VALIDO = { contentType: "image/webp", nomeOriginal: "fachada.jpg", bytes: 184_320 };

function criarCasaViaHandler(corpo: unknown) {
  return handler(
    criarEvento("POST", "/api/admin/casas", {
      headers: { authorization: "Bearer token-de-teste" },
      body: JSON.stringify(corpo),
    }),
  );
}

function uploadFotoViaHandler(casaId: string, corpo: unknown) {
  return handler(
    criarEvento("POST", `/api/admin/casas/${casaId}/fotos/upload`, {
      headers: { authorization: "Bearer token-de-teste" },
      body: JSON.stringify(corpo),
    }),
  );
}

async function criarCasaDeTeste(slug: string): Promise<string> {
  const resposta = await criarCasaViaHandler({ ...CASA_VALIDA, slug });
  return (JSON.parse(resposta.body as string) as { casaId: string }).casaId;
}

describe("POST /api/admin/casas/{casaId}/fotos/upload (integração)", () => {
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
  });

  it("devolve um presigned POST real, com a chave sob midia/casas/<casaId>/", async () => {
    const casaId = await criarCasaDeTeste("casa-fotos-sucesso");

    const resposta = await uploadFotoViaHandler(casaId, UPLOAD_VALIDO);
    expect(resposta.statusCode).toBe(200);

    const corpo = JSON.parse(resposta.body as string) as {
      chave: string;
      url: string;
      campos: Record<string, string>;
      expiraEm: string;
    };
    expect(corpo.chave).toMatch(new RegExp(`^midia/casas/${casaId}/[0-9A-HJKMNP-TV-Z]{26}-[0-9a-f]{6}\\.webp$`));
    expect(corpo.url.length).toBeGreaterThan(0);
    expect(corpo.campos.key).toBe(corpo.chave);
    // Nomes reais devolvidos pelo SDK (Policy, X-Amz-*) — diferem da grafia
    // minúscula ilustrativa do exemplo em docs/02-casos-de-uso/admin/UC-A03-
    // gerenciar-fotos.md; funcionalmente equivalentes, é o que o navegador
    // precisa enviar de volta ao S3 tal como veio.
    expect(corpo.campos.Policy).toBeDefined();
    expect(corpo.campos["X-Amz-Signature"]).toBeDefined();
    expect(new Date(corpo.expiraEm).getTime()).toBeGreaterThan(Date.now());
  });

  it("responde 404 quando a casa não existe", async () => {
    const resposta = await uploadFotoViaHandler("01HQNAOEXISTE00000000000", UPLOAD_VALIDO);
    expect(resposta.statusCode).toBe(404);
  });

  it("RN1: responde 422 LIMITE_FOTOS quando a casa já tem 40 fotos", async () => {
    const casaId = await criarCasaDeTeste("casa-fotos-limite");

    // 40 chamadas de upload não registram foto nenhuma (este UC só cobre o
    // presigned POST; o registro é outra rota, ainda não implementada) — o
    // limite é verificado contra `casa.fotos`, então simula direto no banco.
    const { documentoDb } = await import("../../src/lib/db");
    const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    const quarentaFotos = Array.from({ length: 40 }, (_v, indice) => ({
      fotoId: `01HQ${String(indice).padStart(22, "0")}`,
      chave: `midia/casas/${casaId}/foto-${indice}.webp`,
      largura: 1600,
      altura: 1067,
      bytes: 100_000,
      legenda: "",
      textoAlternativo: "Foto de teste",
      ordem: indice,
      principal: indice === 0,
      enviadaEm: "2026-10-17T12:00:00-03:00",
    }));
    await documentoDb.send(
      new UpdateCommand({
        TableName: TABELA,
        Key: { PK: `CASA#${casaId}`, SK: "META" },
        UpdateExpression: "SET fotos = :fotos",
        ExpressionAttributeValues: { ":fotos": quarentaFotos },
      }),
    );

    const resposta = await uploadFotoViaHandler(casaId, UPLOAD_VALIDO);

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "LIMITE_FOTOS" });
  });

  it("RN2: responde 422 TIPO_NAO_SUPORTADO para um Content-Type fora da allowlist (SVG)", async () => {
    const casaId = await criarCasaDeTeste("casa-fotos-svg");

    const resposta = await uploadFotoViaHandler(casaId, {
      ...UPLOAD_VALIDO,
      contentType: "image/svg+xml",
    });

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "TIPO_NAO_SUPORTADO" });
  });
});
