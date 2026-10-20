import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { Casa, ConfigPrecos, Foto, StatusCasa } from "@recanto/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Identidade } from "../../../src/lib/auth";
import { ErroHttp } from "../../../src/lib/erros";
import type { MetadadosObjeto } from "../../../src/lib/s3";
import { criarEvento } from "../../evento-teste";
import { construirJpeg, construirPng, construirWebp } from "../../fixtures-imagem";

const {
  exigirAdmin,
  criarVerificadorAdmin,
  criarCasa,
  obterCasa,
  atualizarCasa,
  obterConfigPrecos,
  alterarStatusCasa,
  listarCasas,
  excluirCasa,
  existeOcupacaoFutura,
  registrarFoto,
  criarPresignedPostFoto,
  obterMetadadosObjeto,
  lerInicioObjeto,
  apagarObjeto,
} = vi.hoisted(() => ({
  exigirAdmin: vi.fn<(evento: APIGatewayProxyEventV2, verificador: unknown) => Promise<Identidade>>(),
  criarVerificadorAdmin: vi.fn(() => ({})),
  criarCasa: vi.fn<(casa: Casa) => Promise<void>>(),
  obterCasa: vi.fn<(casaId: string) => Promise<Casa | undefined>>(),
  atualizarCasa: vi.fn<(casa: Casa, versaoAnterior: number, slugAnterior: string) => Promise<void>>(),
  obterConfigPrecos: vi.fn<(casaId: string) => Promise<ConfigPrecos | undefined>>(),
  alterarStatusCasa:
    vi.fn<(casaId: string, status: StatusCasa, atualizadoPor: string, agora: string) => Promise<void>>(),
  listarCasas: vi.fn<() => Promise<Casa[]>>(),
  excluirCasa: vi.fn<(casa: Pick<Casa, "casaId" | "slug">) => Promise<void>>(),
  existeOcupacaoFutura: vi.fn<(casaId: string, deInclusive: string) => Promise<boolean>>(),
  registrarFoto:
    vi.fn<
      (
        casaId: string,
        novasFotos: Foto[],
        versaoAnterior: number,
        agora: string,
        atualizadoPor: string,
      ) => Promise<void>
    >(),
  criarPresignedPostFoto: vi.fn<(chave: string, contentType: string, agora: Date) => Promise<unknown>>(),
  obterMetadadosObjeto: vi.fn<(chave: string) => Promise<MetadadosObjeto | undefined>>(),
  lerInicioObjeto: vi.fn<(chave: string) => Promise<Buffer>>(),
  apagarObjeto: vi.fn<(chave: string) => Promise<void>>(),
}));

vi.mock("../../../src/lib/auth", () => ({ exigirAdmin, criarVerificadorAdmin }));
vi.mock("../../../src/lib/db", () => ({
  criarCasa,
  listarCasas,
  obterCasa,
  atualizarCasa,
  obterConfigPrecos,
  alterarStatusCasa,
  excluirCasa,
  existeOcupacaoFutura,
  registrarFoto,
}));
vi.mock("../../../src/lib/s3", () => ({
  criarPresignedPostFoto,
  obterMetadadosObjeto,
  lerInicioObjeto,
  apagarObjeto,
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

function eventoGet(caminho: string): APIGatewayProxyEventV2 {
  return criarEvento("GET", caminho, { headers: { authorization: "Bearer token-de-teste" } });
}

function eventoDelete(casaId: string): APIGatewayProxyEventV2 {
  return criarEvento("DELETE", `/api/admin/casas/${casaId}`, {
    headers: { authorization: "Bearer token-de-teste" },
  });
}

function eventoUploadFoto(casaId: string, corpo: unknown): APIGatewayProxyEventV2 {
  return criarEvento("POST", `/api/admin/casas/${casaId}/fotos/upload`, {
    headers: { authorization: "Bearer token-de-teste" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

function eventoRegistrarFoto(casaId: string, corpo: unknown): APIGatewayProxyEventV2 {
  return criarEvento("POST", `/api/admin/casas/${casaId}/fotos`, {
    headers: { authorization: "Bearer token-de-teste" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

const UPLOAD_VALIDO = { contentType: "image/webp", nomeOriginal: "fachada.jpg", bytes: 184_320 };

const CHAVE_VALIDA = `midia/casas/${CASA_ID}/01HRFOTO0000000000000001-a3f9c1.webp`;

const REGISTRO_VALIDO = {
  chave: CHAVE_VALIDA,
  textoAlternativo: "Casa de madeira com varanda, vista do lago ao fundo",
  legenda: "Fachada vista do lago",
};

const PRESIGNED_RESULTADO = {
  chave: "midia/casas/01HQCASAEXISTENTE00000001/01HRFOTO-a3f9c1.webp",
  url: "https://bucket-de-teste.s3.amazonaws.com/",
  campos: { key: "midia/casas/.../x.webp", "Content-Type": "image/webp" },
  expiraEm: "2026-10-11T18:09:00-03:00",
};

const METADADOS_WEBP_VALIDOS: MetadadosObjeto = { bytes: 184_320, contentType: "image/webp" };

beforeEach(() => {
  exigirAdmin.mockReset();
  criarCasa.mockReset();
  obterCasa.mockReset();
  atualizarCasa.mockReset();
  obterConfigPrecos.mockReset();
  alterarStatusCasa.mockReset();
  listarCasas.mockReset();
  excluirCasa.mockReset();
  existeOcupacaoFutura.mockReset();
  registrarFoto.mockReset();
  criarPresignedPostFoto.mockReset();
  obterMetadadosObjeto.mockReset();
  lerInicioObjeto.mockReset();
  apagarObjeto.mockReset();
  exigirAdmin.mockResolvedValue(ADMIN);
  criarCasa.mockResolvedValue(undefined);
  obterCasa.mockResolvedValue(CASA_EXISTENTE);
  atualizarCasa.mockResolvedValue(undefined);
  obterConfigPrecos.mockResolvedValue(PRECOS_VALIDOS);
  alterarStatusCasa.mockResolvedValue(undefined);
  listarCasas.mockResolvedValue([]);
  excluirCasa.mockResolvedValue(undefined);
  existeOcupacaoFutura.mockResolvedValue(false);
  registrarFoto.mockResolvedValue(undefined);
  criarPresignedPostFoto.mockResolvedValue(PRESIGNED_RESULTADO);
  obterMetadadosObjeto.mockResolvedValue(METADADOS_WEBP_VALIDOS);
  lerInicioObjeto.mockResolvedValue(construirWebp(1600, 1067));
  apagarObjeto.mockResolvedValue(undefined);
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

describe("GET /api/admin/casas (UC-A02, lista)", () => {
  it("lista vazia quando não há casas cadastradas", async () => {
    const resposta = await handler(eventoGet("/api/admin/casas"));

    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body as string)).toEqual({ casas: [] });
  });

  it("projeta os campos da lista para uma casa completa (fotos e preços válidos)", async () => {
    listarCasas.mockResolvedValue([CASA_COMPLETA_PARA_ATIVAR]);
    obterConfigPrecos.mockResolvedValue(PRECOS_VALIDOS);

    const resposta = await handler(eventoGet("/api/admin/casas"));
    const { casas } = JSON.parse(resposta.body as string) as { casas: Record<string, unknown>[] };

    expect(casas).toHaveLength(1);
    expect(casas[0]).toMatchObject({
      casaId: CASA_COMPLETA_PARA_ATIVAR.casaId,
      slug: CASA_COMPLETA_PARA_ATIVAR.slug,
      totalFotos: 1,
      temPrecos: true,
      completa: true,
      fotoPrincipalUrl: `/${CASA_COMPLETA_PARA_ATIVAR.fotos[0]?.chave}`,
      reservasAtivas: 0,
    });
  });

  it("completa e temPrecos ficam false quando faltam fotos e preços válidos", async () => {
    listarCasas.mockResolvedValue([CASA_EXISTENTE]); // CASA_EXISTENTE não tem fotos
    obterConfigPrecos.mockResolvedValue(undefined);

    const resposta = await handler(eventoGet("/api/admin/casas"));
    const { casas } = JSON.parse(resposta.body as string) as { casas: Record<string, unknown>[] };

    expect(casas[0]).toMatchObject({ completa: false, temPrecos: false });
    expect(casas[0]?.fotoPrincipalUrl).toBeUndefined();
  });
});

describe("GET /api/admin/casas/{casaId} (UC-A02, detalhe)", () => {
  it("responde 200 com a casa completa", async () => {
    const resposta = await handler(eventoGet(`/api/admin/casas/${CASA_ID}`));

    expect(resposta.statusCode).toBe(200);
    expect(obterCasa).toHaveBeenCalledWith(CASA_ID);
    expect(JSON.parse(resposta.body as string)).toEqual(CASA_EXISTENTE);
  });

  it("responde 404 quando a casa não existe", async () => {
    obterCasa.mockResolvedValue(undefined);

    const resposta = await handler(eventoGet(`/api/admin/casas/${CASA_ID}`));

    expect(resposta.statusCode).toBe(404);
  });
});

describe("DELETE /api/admin/casas/{casaId} (UC-A02, RN14)", () => {
  it("16. exclui casa sem ocupação futura e responde 200", async () => {
    const resposta = await handler(eventoDelete(CASA_ID));

    expect(resposta.statusCode).toBe(200);
    expect(existeOcupacaoFutura).toHaveBeenCalledWith(CASA_ID, expect.any(String));
    expect(excluirCasa).toHaveBeenCalledWith(CASA_EXISTENTE);
    expect(JSON.parse(resposta.body as string)).toEqual({ casaId: CASA_ID });
  });

  it("15. exclui casa com reserva confirmada → 409 CASA_COM_RESERVAS, sem apagar", async () => {
    existeOcupacaoFutura.mockResolvedValue(true);

    const resposta = await handler(eventoDelete(CASA_ID));

    expect(resposta.statusCode).toBe(409);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "CASA_COM_RESERVAS" });
    expect(excluirCasa).not.toHaveBeenCalled();
  });

  it("responde 404 quando a casa não existe", async () => {
    obterCasa.mockResolvedValue(undefined);

    const resposta = await handler(eventoDelete(CASA_ID));

    expect(resposta.statusCode).toBe(404);
    expect(existeOcupacaoFutura).not.toHaveBeenCalled();
    expect(excluirCasa).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/casas/{casaId}/fotos/upload (UC-A03)", () => {
  it("responde 200 com o presigned POST", async () => {
    const resposta = await handler(eventoUploadFoto(CASA_ID, UPLOAD_VALIDO));

    expect(resposta.statusCode).toBe(200);
    expect(obterCasa).toHaveBeenCalledWith(CASA_ID);
    expect(JSON.parse(resposta.body as string)).toEqual(PRESIGNED_RESULTADO);
  });

  it("chama criarPresignedPostFoto com uma chave sob midia/casas/<casaId>/ e o Content-Type pedido", async () => {
    await handler(eventoUploadFoto(CASA_ID, UPLOAD_VALIDO));

    expect(criarPresignedPostFoto).toHaveBeenCalledOnce();
    const [chave, contentType] = criarPresignedPostFoto.mock.calls[0] as [string, string, Date];
    expect(chave).toMatch(new RegExp(`^midia/casas/${CASA_ID}/[0-9A-HJKMNP-TV-Z]{26}-[0-9a-f]{6}\\.webp$`));
    expect(contentType).toBe("image/webp");
  });

  it("responde 404 quando a casa não existe", async () => {
    obterCasa.mockResolvedValue(undefined);

    const resposta = await handler(eventoUploadFoto(CASA_ID, UPLOAD_VALIDO));

    expect(resposta.statusCode).toBe(404);
    expect(criarPresignedPostFoto).not.toHaveBeenCalled();
  });

  it("RN1: responde 422 LIMITE_FOTOS na 41ª foto", async () => {
    const fotoBase = CASA_COMPLETA_PARA_ATIVAR.fotos[0] as (typeof CASA_COMPLETA_PARA_ATIVAR.fotos)[number];
    const fotosNoLimite = Array.from({ length: 40 }, (_v, indice) => ({
      ...fotoBase,
      fotoId: `01HQ${String(indice).padStart(22, "0")}`,
      ordem: indice,
    }));
    obterCasa.mockResolvedValue({ ...CASA_EXISTENTE, fotos: fotosNoLimite });

    const resposta = await handler(eventoUploadFoto(CASA_ID, UPLOAD_VALIDO));

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "LIMITE_FOTOS" });
    expect(criarPresignedPostFoto).not.toHaveBeenCalled();
  });

  it("RN2: responde 422 TIPO_NAO_SUPORTADO quando o contentType não está na allowlist (ex.: SVG)", async () => {
    const resposta = await handler(
      eventoUploadFoto(CASA_ID, { ...UPLOAD_VALIDO, contentType: "image/svg+xml" }),
    );

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "TIPO_NAO_SUPORTADO" });
    expect(obterCasa).not.toHaveBeenCalled();
  });

  it("responde 400 quando o corpo está ausente", async () => {
    const resposta = await handler(
      criarEvento("POST", `/api/admin/casas/${CASA_ID}/fotos/upload`, {
        headers: { authorization: "Bearer token-de-teste" },
      }),
    );

    expect(resposta.statusCode).toBe(400);
  });
});

describe("POST /api/admin/casas/{casaId}/fotos (UC-A03, registro)", () => {
  it("registra a foto e responde 201 com largura/altura extraídas de verdade (RN14)", async () => {
    obterMetadadosObjeto.mockResolvedValue({ bytes: 200_000, contentType: "image/webp" });
    lerInicioObjeto.mockResolvedValue(construirWebp(800, 600));

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(201);
    const foto = JSON.parse(resposta.body as string) as Foto;
    expect(foto).toMatchObject({
      chave: CHAVE_VALIDA,
      largura: 800,
      altura: 600,
      bytes: 200_000,
      legenda: REGISTRO_VALIDO.legenda,
      textoAlternativo: REGISTRO_VALIDO.textoAlternativo,
      principal: false,
      ordem: 10,
    });
    expect(registrarFoto).toHaveBeenCalledWith(
      CASA_ID,
      [foto],
      CASA_EXISTENTE.versao,
      expect.any(String),
      ADMIN.sub,
    );
  });

  it("também registra JPEG e PNG, não só WebP (a validação não é hardcoded para um formato)", async () => {
    obterMetadadosObjeto.mockResolvedValue({ bytes: 150_000, contentType: "image/jpeg" });
    lerInicioObjeto.mockResolvedValue(construirJpeg(4000, 3000));

    const respostaJpeg = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));
    expect(respostaJpeg.statusCode).toBe(201);
    expect(JSON.parse(respostaJpeg.body as string)).toMatchObject({ largura: 4000, altura: 3000 });

    obterMetadadosObjeto.mockResolvedValue({ bytes: 90_000, contentType: "image/png" });
    lerInicioObjeto.mockResolvedValue(construirPng(640, 480));

    const respostaPng = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));
    expect(respostaPng.statusCode).toBe(201);
    expect(JSON.parse(respostaPng.body as string)).toMatchObject({ largura: 640, altura: 480 });
  });

  const FOTO_EXISTENTE = CASA_COMPLETA_PARA_ATIVAR.fotos[0] as Foto;

  it("primeira foto da casa recebe ordem 10; a próxima soma 10 à maior ordem existente", async () => {
    obterCasa.mockResolvedValue({
      ...CASA_EXISTENTE,
      fotos: [{ ...FOTO_EXISTENTE, ordem: 30 }],
    });

    await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    const [, novasFotos] = registrarFoto.mock.calls[0] as [string, Foto[], number, string, string];
    expect(novasFotos[novasFotos.length - 1]?.ordem).toBe(40);
  });

  it("RN7: marcar a nova foto como principal desmarca as demais na mesma escrita", async () => {
    obterCasa.mockResolvedValue({
      ...CASA_EXISTENTE,
      fotos: [{ ...FOTO_EXISTENTE, principal: true }],
    });

    await handler(eventoRegistrarFoto(CASA_ID, { ...REGISTRO_VALIDO, principal: true }));

    const [, novasFotos] = registrarFoto.mock.calls[0] as [string, Foto[], number, string, string];
    expect(novasFotos[0]?.principal).toBe(false); // a que já existia
    expect(novasFotos[1]?.principal).toBe(true); // a nova
  });

  it("responde 404 quando a casa não existe", async () => {
    obterCasa.mockResolvedValue(undefined);

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(404);
    expect(obterMetadadosObjeto).not.toHaveBeenCalled();
  });

  it("RN1: responde 422 LIMITE_FOTOS antes de qualquer chamada ao S3 (UX)", async () => {
    const fotoBase = CASA_COMPLETA_PARA_ATIVAR.fotos[0] as (typeof CASA_COMPLETA_PARA_ATIVAR.fotos)[number];
    const fotosNoLimite = Array.from({ length: 40 }, (_v, indice) => ({
      ...fotoBase,
      fotoId: `01HQ${String(indice).padStart(22, "0")}`,
    }));
    obterCasa.mockResolvedValue({ ...CASA_EXISTENTE, fotos: fotosNoLimite });

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "LIMITE_FOTOS" });
    expect(obterMetadadosObjeto).not.toHaveBeenCalled();
  });

  it("RN11: responde 400 quando a chave não pertence ao prefixo desta casa", async () => {
    const resposta = await handler(
      eventoRegistrarFoto(CASA_ID, { ...REGISTRO_VALIDO, chave: "midia/casas/OUTRA-CASA/x.webp" }),
    );

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "ENTRADA_INVALIDA" });
    expect(obterMetadadosObjeto).not.toHaveBeenCalled();
  });

  it("5. responde 400 quando a chave não corresponde a nenhum arquivo enviado", async () => {
    obterMetadadosObjeto.mockResolvedValue(undefined);

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "ENTRADA_INVALIDA" });
    expect(lerInicioObjeto).not.toHaveBeenCalled();
  });

  it("responde 400 quando o objeto excede o teto de tamanho (RN3, defensivo)", async () => {
    obterMetadadosObjeto.mockResolvedValue({ bytes: 10_000_000, contentType: "image/webp" });

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(400);
    expect(lerInicioObjeto).not.toHaveBeenCalled();
  });

  it("RN2: responde 422 TIPO_NAO_SUPORTADO quando o Content-Type armazenado não está na allowlist", async () => {
    obterMetadadosObjeto.mockResolvedValue({ bytes: 100_000, contentType: "image/svg+xml" });

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(422);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "TIPO_NAO_SUPORTADO" });
    expect(lerInicioObjeto).not.toHaveBeenCalled();
  });

  it("6/E5: HTML com Content-Type: image/webp (magic number não casa) → 400 ARQUIVO_INVALIDO e apaga o objeto", async () => {
    lerInicioObjeto.mockResolvedValue(Buffer.from("<!DOCTYPE html>", "utf8"));

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "ARQUIVO_INVALIDO" });
    expect(apagarObjeto).toHaveBeenCalledWith(CHAVE_VALIDA);
    expect(registrarFoto).not.toHaveBeenCalled();
  });

  it("400 ARQUIVO_INVALIDO quando a magic number bate mas as dimensões não podem ser extraídas", async () => {
    // Primeiros 3 bytes de JPEG válido, mas truncado antes do SOF.
    lerInicioObjeto.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    obterMetadadosObjeto.mockResolvedValue({ bytes: 100_000, contentType: "image/jpeg" });

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "ARQUIVO_INVALIDO" });
    expect(apagarObjeto).toHaveBeenCalledWith(CHAVE_VALIDA);
  });

  it("não falha a resposta quando apagarObjeto rejeita (best-effort, E5/E10)", async () => {
    lerInicioObjeto.mockResolvedValue(Buffer.from("não é imagem", "utf8"));
    apagarObjeto.mockRejectedValue(new Error("S3 indisponível"));

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "ARQUIVO_INVALIDO" });
  });

  it("RN5: responde 400 quando falta textoAlternativo", async () => {
    const { textoAlternativo: _t, ...semTexto } = REGISTRO_VALIDO;
    const resposta = await handler(eventoRegistrarFoto(CASA_ID, semTexto));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "ENTRADA_INVALIDA" });
    expect(obterCasa).not.toHaveBeenCalled();
  });

  it("responde 400 quando o corpo está ausente", async () => {
    const resposta = await handler(
      criarEvento("POST", `/api/admin/casas/${CASA_ID}/fotos`, {
        headers: { authorization: "Bearer token-de-teste" },
      }),
    );

    expect(resposta.statusCode).toBe(400);
  });

  it("responde 409 CONFLITO_VERSAO quando registrarFoto rejeita por concorrência", async () => {
    registrarFoto.mockRejectedValue(
      new ErroHttp(409, "CONFLITO_VERSAO", "Esta casa foi alterada em outra aba."),
    );

    const resposta = await handler(eventoRegistrarFoto(CASA_ID, REGISTRO_VALIDO));

    expect(resposta.statusCode).toBe(409);
    expect(JSON.parse(resposta.body as string)).toMatchObject({ erro: "CONFLITO_VERSAO" });
  });
});
