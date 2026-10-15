/**
 * Infraestrutura de teste para `lib/auth.ts`: um par de chaves RSA e um JWKS
 * próprios, carregados no verificador via `cacheJwks` — sem nenhuma chamada de
 * rede ao Cognito de verdade. `aws-jwt-verify` oferece exatamente esse gancho
 * para teste offline (ver `CognitoJwtVerifier.cacheJwks` em `cognito-verifier.d.ts`).
 */
import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { Jwk } from "aws-jwt-verify/jwk";
import jwt from "jsonwebtoken";

export const USER_POOL_ID_TESTE = "sa-east-1_testeAdmin01";
export const CLIENT_ID_TESTE = "cliente-de-teste";
const KID_TESTE = "kid-de-teste-01";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function paraJwk(chave: KeyObject): Jwk {
  const jwk = chave.export({ format: "jwk" }) as Jwk;
  return { ...jwk, kid: KID_TESTE, alg: "RS256", use: "sig" };
}

/** Verificador real, com o JWKS de teste pré-carregado — nenhum acesso de rede. */
export function criarVerificadorDeTeste() {
  const verificador = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID_TESTE,
    clientId: CLIENT_ID_TESTE,
    tokenUse: "access",
  });
  verificador.cacheJwks({ keys: [paraJwk(publicKey)] });
  return verificador;
}

const { issuer } = CognitoJwtVerifier.parseUserPoolId(USER_POOL_ID_TESTE);

/** Assina um token no formato de um access token do Cognito, para teste. */
export function assinarTokenDeTeste(opcoes: {
  sub?: string;
  grupos?: string[];
  clientId?: string;
  tokenUse?: "access" | "id";
  expiraEmSegundos?: number;
  issuer?: string;
}): string {
  const agora = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      token_use: opcoes.tokenUse ?? "access",
      "cognito:groups": opcoes.grupos ?? ["admin"],
      client_id: opcoes.clientId ?? CLIENT_ID_TESTE,
      username: opcoes.sub ?? "01HQADMINTESTE",
      scope: "aws.cognito.signin.user.admin",
      auth_time: agora,
      iat: agora,
      jti: "jti-de-teste",
      origin_jti: "origin-jti-de-teste",
      exp: agora + (opcoes.expiraEmSegundos ?? 3600),
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: KID_TESTE,
      subject: opcoes.sub ?? "01HQADMINTESTE",
      issuer: opcoes.issuer ?? issuer,
    },
  );
}
