import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";

import { exigirAdmin, type VerificadorAdmin } from "../../../src/lib/auth";
import { ErroHttp } from "../../../src/lib/erros";
import { assinarTokenDeTeste, criarVerificadorDeTeste } from "./jwt-de-teste";

function eventoComToken(token?: string): APIGatewayProxyEventV2 {
  return { headers: token === undefined ? {} : { authorization: `Bearer ${token}` } } as never;
}

const verificador: VerificadorAdmin = criarVerificadorDeTeste();

describe("exigirAdmin", () => {
  it("retorna a identidade (sub) para um token válido do grupo admin", async () => {
    const token = assinarTokenDeTeste({ sub: "01HQADMIN0000000000000001", grupos: ["admin"] });

    const identidade = await exigirAdmin(eventoComToken(token), verificador);

    expect(identidade).toEqual({ sub: "01HQADMIN0000000000000001" });
  });

  it("401 quando não há cabeçalho Authorization", async () => {
    await expect(exigirAdmin(eventoComToken(undefined), verificador)).rejects.toMatchObject({
      statusCode: 401,
      codigo: "NAO_AUTENTICADO",
    });
  });

  it("401 quando o cabeçalho não está no formato Bearer", async () => {
    const evento = { headers: { authorization: "Basic dXNlcjpwYXNz" } } as unknown as APIGatewayProxyEventV2;
    await expect(exigirAdmin(evento, verificador)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("401 quando o token está expirado", async () => {
    const token = assinarTokenDeTeste({ expiraEmSegundos: -10 });
    await expect(exigirAdmin(eventoComToken(token), verificador)).rejects.toMatchObject({
      statusCode: 401,
      codigo: "NAO_AUTENTICADO",
    });
  });

  it("401 quando o client_id não é o esperado", async () => {
    const token = assinarTokenDeTeste({ clientId: "outro-client-id" });
    await expect(exigirAdmin(eventoComToken(token), verificador)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("401 quando o token_use é 'id', não 'access'", async () => {
    const token = assinarTokenDeTeste({ tokenUse: "id" });
    await expect(exigirAdmin(eventoComToken(token), verificador)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("401 quando o issuer não confere (token de outro User Pool)", async () => {
    const token = assinarTokenDeTeste({ issuer: "https://cognito-idp.sa-east-1.amazonaws.com/sa-east-1_outroPool" });
    await expect(exigirAdmin(eventoComToken(token), verificador)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("401 quando a assinatura foi adulterada", async () => {
    const token = assinarTokenDeTeste({});
    const partes = token.split(".");
    const forjado = `${partes[0]}.${partes[1]}.assinaturaAdulterada`;

    await expect(exigirAdmin(eventoComToken(forjado), verificador)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("403 (não 401) quando o token é válido mas sem o grupo admin", async () => {
    const token = assinarTokenDeTeste({ grupos: ["hospede"] });

    await expect(exigirAdmin(eventoComToken(token), verificador)).rejects.toMatchObject({
      statusCode: 403,
      codigo: "NAO_AUTORIZADO",
    });
  });

  it("403 quando o token não tem cognito:groups nenhum", async () => {
    const token = assinarTokenDeTeste({ grupos: [] });
    await expect(exigirAdmin(eventoComToken(token), verificador)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("a mensagem do erro nunca contém o token", async () => {
    const token = assinarTokenDeTeste({ expiraEmSegundos: -10 });
    const erro = await exigirAdmin(eventoComToken(token), verificador).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroHttp);
    expect((erro as ErroHttp).message).not.toContain(token);
  });
});
