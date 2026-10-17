import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { Casa, ConfigPrecos, StatusCasa } from "@recanto/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Identidade } from "../../../src/lib/auth";
import { ErroHttp } from "../../../src/lib/erros";
import { criarEvento } from "../../evento-teste";

const {
  exigirAdmin,
  criarVerificadorAdmin,
  criarCasa,
  obterCasa,
  atualizarCasa,
  obterConfigPrecos,
  alterarStatusCasa,
} = vi.hoisted(() => ({
  exigirAdmin: vi.fn<(evento: APIGatewayProxyEventV2, verificador: unknown) => Promise<Identidade>>(),
  criarVerificadorAdmin: vi.fn(() => ({})),
  criarCasa: vi.fn<(casa: Casa) => Promise<void>>(),
  obterCasa: vi.fn<(casaId: string) => Promise<Casa | undefined>>(),
  atualizarCasa: vi.fn<(casa: Casa, versaoAnterior: number, slugAnterior: string) => Promise<void>>(),
  obterConfigPrecos: vi.fn<(casaId: string) => Promise<ConfigPrecos | undefined>>(),
  alterarStatusCasa:
    vi.fn<(casaId: string, status: StatusCasa, atualizadoPor: string, agora: string) => Promise<void>>(),
}));

vi.mock("../../../src/lib/auth", () => ({ exigirAdmin, criarVerificadorAdmin }));
vi.mock("../../../src/lib/db", () => ({
  criarCasa,
  obterCasa,
  atualizarCasa,
  obterConfigPrecos,
  alterarStatusCasa,
}));

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

const CASA_ID = "01HQCASAEXISTENTE00000001";

const CASA_EXISTENTE: Casa = {
  ...CASA_VALIDA,
  status: "ATIVA",
  camas: [],
  comodidades: [],
  casaId: CASA_ID,
  fotos: [],
  tokenIcal: "token-ical-existente",
  publicacaoPendente: false,
  versao: 3,
  criadoEm: "2026-10-01T10:00:00-03:00",
  atualizadoEm: "2026-10-01T10:00:00-03:00",
  atualizadoPor: "01HQOUTROADMIN",
};

function eventoPost(corpo: unknown, cabecalhos: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return criarEvento("POST", "/api/admin/casas", {
    headers: { authorization: "Bearer token-de-teste", ...cabecalhos },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

function eventoPut(casaId: string, corpo: unknown): APIGatewayProxyEventV2 {
  return criarEvento("PUT", `/api/admin/casas/${casaId}`, {
    headers: { authorization: "Bearer token-de-teste" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

function eventoStatus(casaId: string, corpo: unknown): APIGatewayProxyEventV2 {
  return criarEvento("POST", `/api/admin/casas/${casaId}/status`, {
    headers: { authorization: "Bearer token-de-teste" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

const PRECOS_VALIDOS: ConfigPrecos = {
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

const CASA_COMPLETA_PARA_ATIVAR: Casa = {
  ...CASA_EXISTENTE,
  fotos: [
    {
      fotoId: "01HQ9999999999999999999999",
      chave: "midia/casas/01HQ.../fachada.webp",
      largura: 1600,
      altura: 1067,
      bytes: 184_320,
      legenda: "Fachada",
      textoAlternativo: "Casa de madeira vista do lago",
      ordem: 10,
      principal: true,
      enviadaEm: "2026-10-11T18:04:00-03:00",
    },
  ],
};

beforeEach(() => {
  exigirAdmin.mockReset();
  criarCasa.mockReset();
  obterCasa.mockReset();
  atualizarCasa.mockReset();
  obterConfigPrecos.mockReset();
  alterarStatusCasa.mockReset();
  exigirAdmin.mockResolvedValue(ADMIN);
  criarCasa.mockResolvedValue(undefined);
  obterCasa.mockResolvedValue(CASA_EXISTENTE);
  atualizarCasa.mockResolvedValue(undefined);
  obterConfigPrecos.mockResolvedValue(PRECOS_VALIDOS);
  alterarStatusCasa.mockResolvedValue(undefined);
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

describe("PUT /api/admin/casas/{casaId} (UC-A02, E9)", () => {
  const EDICAO_VALIDA = { ...CASA_VALIDA, versao: CASA_EXISTENTE.versao };

  it("atualiza a casa e responde 200 com o item completo", async () => {
    const resposta = await handler(eventoPut(CASA_ID, EDICAO_VALIDA));

    expect(resposta.statusCode).toBe(200);
    expect(obterCasa).toHaveBeenCalledWith(CASA_ID);
    expect(atualizarCasa).toHaveBeenCalledOnce();

    const [casaAtualizada, versaoAnterior, slugAnterior] = atualizarCasa.mock.calls[0] as [
      Casa,
      number,
      string,
    ];
    expect(casaAtualizada).toMatchObject({
      casaId: CASA_ID,
      nome: CASA_VALIDA.nome,
      status: CASA_EXISTENTE.status,
      publicacaoPendente: true,
      versao: CASA_EXISTENTE.versao + 1,
      atualizadoPor: ADMIN.sub,
      tokenIcal: CASA_EXISTENTE.tokenIcal,
    });
    expect(versaoAnterior).toBe(CASA_EXISTENTE.versao);
    expect(slugAnterior).toBe(CASA_EXISTENTE.slug);
    expect(JSON.parse(resposta.body as string)).toEqual(casaAtualizada);
  });

  it("ignora o status enviado — só POST .../status muda o status (RN7 fica intacto)", async () => {
    await handler(eventoPut(CASA_ID, { ...EDICAO_VALIDA, status: "RASCUNHO" }));

    const casaAtualizada = atualizarCasa.mock.calls[0]?.[0] as Casa;
    expect(casaAtualizada.status).toBe(CASA_EXISTENTE.status);
  });

  it("responde 404 quando a casa não existe", async () => {
    obterCasa.mockResolvedValue(undefined);

    const resposta = await handler(eventoPut(CASA_ID, EDICAO_VALIDA));

    expect(resposta.statusCode).toBe(404);
    expect(atualizarCasa).not.toHaveBeenCalled();
  });

  it("responde 400 quando falta a versao no corpo", async () => {
    const { versao: _v, ...semVersao } = EDICAO_VALIDA;
    const resposta = await handler(eventoPut(CASA_ID, semVersao));

    expect(resposta.statusCode).toBe(400);
    expect(obterCasa).not.toHaveBeenCalled();
  });

  it("responde 413 quando o corpo excede o limite de tamanho", async () => {
    const resposta = await handler(
      eventoPut(CASA_ID, { ...EDICAO_VALIDA, descricao: "a".repeat(80_000) }),
    );
    expect(resposta.statusCode).toBe(413);
  });

  it("RN4/E6: 422 SLUG_IMUTAVEL ao tentar mudar o slug de casa não-RASCUNHO", async () => {
    const resposta = await handler(
      eventoPut(CASA_ID, { ...EDICAO_VALIDA, slug: "novo-slug" }),
    );

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "SLUG_IMUTAVEL" });
    expect(atualizarCasa).not.toHaveBeenCalled();
  });

  it("permite mudar o slug quando a casa ainda está em RASCUNHO", async () => {
    obterCasa.mockResolvedValue({ ...CASA_EXISTENTE, status: "RASCUNHO" });

    const resposta = await handler(eventoPut(CASA_ID, { ...EDICAO_VALIDA, slug: "novo-slug" }));

    expect(resposta.statusCode).toBe(200);
    expect(atualizarCasa).toHaveBeenCalledOnce();
  });

  it("responde 409 CONFLITO_VERSAO quando atualizarCasa rejeita (E9)", async () => {
    atualizarCasa.mockRejectedValue(
      new ErroHttp(409, "CONFLITO_VERSAO", "Esta casa foi alterada em outra aba."),
    );

    const resposta = await handler(eventoPut(CASA_ID, EDICAO_VALIDA));

    expect(resposta.statusCode).toBe(409);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "CONFLITO_VERSAO" });
  });

  it("responde 409 SLUG_EM_USO quando atualizarCasa rejeita por slug em uso", async () => {
    obterCasa.mockResolvedValue({ ...CASA_EXISTENTE, status: "RASCUNHO" });
    atualizarCasa.mockRejectedValue(
      new ErroHttp(409, "SLUG_EM_USO", "Este endereço já está em uso por outra casa."),
    );

    const resposta = await handler(eventoPut(CASA_ID, { ...EDICAO_VALIDA, slug: "slug-de-outra-casa" }));

    expect(resposta.statusCode).toBe(409);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "SLUG_EM_USO" });
  });
});

describe("POST /api/admin/casas/{casaId}/status (UC-A02, RN7)", () => {
  it("9. ativa uma casa completa e responde 200", async () => {
    obterCasa.mockResolvedValue(CASA_COMPLETA_PARA_ATIVAR);

    const resposta = await handler(eventoStatus(CASA_ID, { status: "ATIVA" }));

    expect(resposta.statusCode).toBe(200);
    expect(alterarStatusCasa).toHaveBeenCalledWith(CASA_ID, "ATIVA", ADMIN.sub, expect.any(String));
    const corpo = JSON.parse(resposta.body as string) as Casa;
    expect(corpo).toMatchObject({
      status: "ATIVA",
      versao: CASA_COMPLETA_PARA_ATIVAR.versao + 1,
      publicacaoPendente: true,
      atualizadoPor: ADMIN.sub,
    });
  });

  it("6. ativar casa sem fotos falha com 422 e faltando: ['fotos']", async () => {
    const resposta = await handler(eventoStatus(CASA_ID, { status: "ATIVA" })); // CASA_EXISTENTE não tem fotos

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({
      erro: "CASA_INCOMPLETA",
      detalhes: { faltando: ["fotos"] },
    });
    expect(alterarStatusCasa).not.toHaveBeenCalled();
  });

  it("7. ativar casa sem preços válidos falha com 422", async () => {
    obterCasa.mockResolvedValue(CASA_COMPLETA_PARA_ATIVAR);
    obterConfigPrecos.mockResolvedValue(undefined);

    const resposta = await handler(eventoStatus(CASA_ID, { status: "ATIVA" }));

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({
      erro: "CASA_INCOMPLETA",
      detalhes: { faltando: ["precos"] },
    });
  });

  it("A1: desativa (INATIVA) sem exigir completude", async () => {
    const resposta = await handler(eventoStatus(CASA_ID, { status: "INATIVA" }));

    expect(resposta.statusCode).toBe(200);
    expect(alterarStatusCasa).toHaveBeenCalledWith(CASA_ID, "INATIVA", ADMIN.sub, expect.any(String));
    expect(obterConfigPrecos).not.toHaveBeenCalled();
  });

  it("RN4 (decisão 20): RASCUNHO nunca é destino válido por aqui", async () => {
    const resposta = await handler(eventoStatus(CASA_ID, { status: "RASCUNHO" }));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "ENTRADA_INVALIDA" });
    expect(obterCasa).not.toHaveBeenCalled();
    expect(alterarStatusCasa).not.toHaveBeenCalled();
  });

  it("responde 404 quando a casa não existe", async () => {
    obterCasa.mockResolvedValue(undefined);

    const resposta = await handler(eventoStatus(CASA_ID, { status: "ATIVA" }));

    expect(resposta.statusCode).toBe(404);
    expect(alterarStatusCasa).not.toHaveBeenCalled();
  });

  it("responde 400 quando o status não é um valor do enum", async () => {
    const resposta = await handler(eventoStatus(CASA_ID, { status: "PUBLICADA" }));
    expect(resposta.statusCode).toBe(400);
  });

  it("responde 400 quando o corpo está ausente", async () => {
    const resposta = await handler(
      criarEvento("POST", `/api/admin/casas/${CASA_ID}/status`, {
        headers: { authorization: "Bearer token-de-teste" },
      }),
    );
    expect(resposta.statusCode).toBe(400);
  });
});
