/**
 * Verificação do JWT do Cognito — UC-A01, docs/03-tecnico/08-autenticacao-e-autorizacao.md.
 *
 * RN8: o JWT é validado em **toda** requisição a `/api/admin/*`, antes de
 * qualquer leitura. RN9: valida `iss`, `client_id`, `token_use: access` e
 * `exp` — tudo isso é o que `aws-jwt-verify` já faz; `cognito:groups` é
 * verificado **depois**, à mão (ver abaixo o motivo de não passar `groups`
 * direto no verificador).
 *
 * `criarVerificadorAdmin` é uma função, não um valor de módulo: `CognitoJwtVerifier.create`
 * lança **de forma síncrona** se `userPoolId` estiver vazio ou mal formado, o que
 * quebraria a importação deste arquivo inteiro sempre que `USER_POOL_ID` não
 * estivesse no ambiente (todo teste, por exemplo). Quem for expor isto numa Lambda
 * de verdade cria o verificador **uma vez, em escopo de módulo** do handler — é o
 * que reaproveita o cache do JWKS entre invocações do mesmo container.
 */
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { ErroHttp } from "./erros.js";

export interface Identidade {
  /** `sub` do token — o único identificador estável. Access tokens do Cognito não
   *  carregam `email` (RN9/contrato só exige validar `sub`; logar por `sub` já
   *  é o que UC-A02 pede: "nenhum conteúdo, só casaId, ação e sub do admin"). */
  sub: string;
}

export function criarVerificadorAdmin(env: NodeJS.ProcessEnv = process.env) {
  return CognitoJwtVerifier.create({
    userPoolId: env.USER_POOL_ID ?? "",
    clientId: env.USER_POOL_CLIENT_ID ?? "",
    tokenUse: "access",
  });
}

export type VerificadorAdmin = ReturnType<typeof criarVerificadorAdmin>;

/**
 * RN1: só usuários do grupo `admin` acessam `/api/admin/*`.
 *
 * 1. extrai `Bearer <token>` do cabeçalho — ausente é `401`;
 * 2. verifica assinatura/`iss`/`client_id`/`token_use`/`exp` — inválido é `401`;
 * 3. confere `cognito:groups` **depois** de validar o token, não dentro do
 *    `verify()`: passar `groups` direto no verificador faria um JWT válido sem o
 *    grupo falhar pelo mesmo caminho que um JWT forjado, perdendo a distinção
 *    `401` (não autenticado) vs. `403` (autenticado, sem permissão) que o
 *    contrato técnico do UC-A01 exige (E2: "Usuário sem grupo admin" → `403`,
 *    não `401`).
 *
 * Nunca repassa a mensagem interna da biblioteca de verificação na resposta —
 * nem no erro, nem em log (RN12: nenhum token aparece em log).
 */
export async function exigirAdmin(
  evento: APIGatewayProxyEventV2,
  verificador: VerificadorAdmin,
): Promise<Identidade> {
  const token = extrairToken(evento);
  if (token === undefined) {
    throw new ErroHttp(401, "NAO_AUTENTICADO", "Autenticação necessária.");
  }

  let payload;
  try {
    payload = await verificador.verify(token);
  } catch {
    throw new ErroHttp(401, "NAO_AUTENTICADO", "Autenticação necessária.");
  }

  if (!(payload["cognito:groups"] ?? []).includes("admin")) {
    throw new ErroHttp(
      403,
      "NAO_AUTORIZADO",
      "Sua conta não tem permissão para acessar o backoffice.",
    );
  }

  return { sub: payload.sub };
}

const PADRAO_BEARER = /^Bearer\s+(\S+)$/i;

function extrairToken(evento: APIGatewayProxyEventV2): string | undefined {
  const cabecalho = evento.headers?.authorization ?? evento.headers?.Authorization;
  if (cabecalho === undefined) return undefined;
  return PADRAO_BEARER.exec(cabecalho)?.[1];
}
