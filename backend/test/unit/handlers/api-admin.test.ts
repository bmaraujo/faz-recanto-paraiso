import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { Casa } from "@recanto/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Identidade } from "../../../src/lib/auth";
import { ErroHttp } from "../../../src/lib/erros";
import { criarEvento } from "../../evento-teste";

const { exigirAdmin, criarVerificadorAdmin, criarCasa } = vi.hoisted(() => ({
  exigirAdmin: vi.fn<(evento: APIGatewayProxyEventV2, verificador: unknown) => Promise<Identidade>>(),
  criarVerificadorAdmin: vi.fn(() => ({})),
  criarCasa: vi.fn<(casa: Casa) => Promise<void>>(),
}));

vi.mock("../../../src/lib/auth", () => ({ exigirAdmin, criarVerificadorAdmin }));
vi.mock("../../../src/lib/db", () => ({ criarCasa }));

import { handler } from "../../../src/handlers/api-admin";

const ADMIN = { sub: "01HQADMINTESTE" };

const CASA_VALIDA = {
  nome: "Casa do Lago",
  slug: "casa-do-lago",
  resumo: "Casa de madeira à beira do lago, para até 8 pessoas.",
  descricao:
    "## Sobre a casa\n\nUma casa de madeira espaçosa, com varanda de frente para o lago, ideal para famílias.",
  status: "ATIVA", // RN1: ignorado na criação — a casa nasce RASCUNHO de qualquer forma.
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

function eventoPost(corpo: unknown, cabecalhos: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return criarEvento("POST", "/api/admin/casas", {
    headers: { authorization: "Bearer token-de-teste", ...cabecalhos },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

beforeEach(() => {
  exigirAdmin.mockReset();
  criarCasa.mockReset();
  exigirAdmin.mockResolvedValue(ADMIN);
  criarCasa.mockResolvedValue(undefined);
});

describe("autenticação (RN8)", () => {
  it("responde 401 quando exigirAdmin rejeita por falta de token", async () => {
    exigirAdmin.mockRejectedValue(new ErroHttp(401, "NAO_AUTENTICADO", "Autenticação necessária."));

    const resposta = await handler(eventoPost(CASA_VALIDA));

    expect(resposta.statusCode).toBe(401);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "NAO_AUTENTICADO" });
    expect(criarCasa).not.toHaveBeenCalled();
  });

  it("responde 403 quando o token é válido mas sem o grupo admin", async () => {
    exigirAdmin.mockRejectedValue(
      new ErroHttp(403, "NAO_AUTORIZADO", "Sua conta não tem permissão para acessar o backoffice."),
    );

    const resposta = await handler(eventoPost(CASA_VALIDA));

    expect(resposta.statusCode).toBe(403);
    expect(criarCasa).not.toHaveBeenCalled();
  });

  it("verifica a autenticação antes de rotear — rota inexistente ainda exige admin", async () => {
    exigirAdmin.mockRejectedValue(new ErroHttp(401, "NAO_AUTENTICADO", "Autenticação necessária."));

    const resposta = await handler(criarEvento("GET", "/api/admin/rota-que-nao-existe"));

    expect(resposta.statusCode).toBe(401);
  });
});

describe("rota não encontrada", () => {
  it("responde 404 quando autenticado mas a rota não existe", async () => {
    const resposta = await handler(criarEvento("GET", "/api/admin/rota-que-nao-existe", {
      headers: { authorization: "Bearer token-de-teste" },
    }));

    expect(resposta.statusCode).toBe(404);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "NAO_ENCONTRADO" });
  });
});

describe("POST /api/admin/casas (UC-A02)", () => {
  it("cria a casa e responde 201 com o item completo", async () => {
    const resposta = await handler(eventoPost(CASA_VALIDA));

    expect(resposta.statusCode).toBe(201);
    expect(criarCasa).toHaveBeenCalledOnce();

    const casaCriada = criarCasa.mock.calls[0]?.[0] as Casa;
    expect(casaCriada).toMatchObject({
      nome: CASA_VALIDA.nome,
      slug: CASA_VALIDA.slug,
      status: "RASCUNHO",
      fotos: [],
      publicacaoPendente: false,
      versao: 0,
      atualizadoPor: ADMIN.sub,
    });
    expect(casaCriada.casaId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(casaCriada.tokenIcal.length).toBeGreaterThan(0);
    expect(casaCriada.criadoEm).toBe(casaCriada.atualizadoEm);

    expect(JSON.parse(resposta.body as string)).toEqual(casaCriada);
  });

  it("RN1: ignora o status enviado no corpo — a casa sempre nasce RASCUNHO", async () => {
    await handler(eventoPost({ ...CASA_VALIDA, status: "INATIVA" }));

    const casaCriada = criarCasa.mock.calls[0]?.[0] as Casa;
    expect(casaCriada.status).toBe("RASCUNHO");
  });

  it("responde 400 quando o corpo está ausente", async () => {
    const resposta = await handler(criarEvento("POST", "/api/admin/casas", {
      headers: { authorization: "Bearer token-de-teste" },
    }));

    expect(resposta.statusCode).toBe(400);
    expect(criarCasa).not.toHaveBeenCalled();
  });

  it("responde 400 quando o corpo não é JSON válido", async () => {
    const resposta = await handler(eventoPost("{ isto não é json"));
    expect(resposta.statusCode).toBe(400);
  });

  it("responde 400 com os campos inválidos quando a entrada falha o schema", async () => {
    const resposta = await handler(eventoPost({ ...CASA_VALIDA, hospedesInclusos: 99 }));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({
      erro: "ENTRADA_INVALIDA",
      detalhes: { campos: ["hospedesInclusos"] },
    });
    expect(criarCasa).not.toHaveBeenCalled();
  });

  it("responde 413 quando o corpo excede o limite de tamanho", async () => {
    const corpoGigante = { ...CASA_VALIDA, descricao: "a".repeat(80_000) };
    const resposta = await handler(eventoPost(corpoGigante));

    expect(resposta.statusCode).toBe(413);
    expect(criarCasa).not.toHaveBeenCalled();
  });

  it("responde 409 SLUG_EM_USO quando criarCasa rejeita por slug duplicado (E1)", async () => {
    criarCasa.mockRejectedValue(
      new ErroHttp(409, "SLUG_EM_USO", "Este endereço já está em uso por outra casa."),
    );

    const resposta = await handler(eventoPost(CASA_VALIDA));

    expect(resposta.statusCode).toBe(409);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "SLUG_EM_USO" });
  });
});
