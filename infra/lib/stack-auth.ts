/**
 * Stack `auth` — Cognito User Pool, App Client, domínio e grupo `admin`.
 * docs/03-tecnico/12-infraestrutura-cdk.md#stack-auth,
 * docs/02-casos-de-uso/admin/UC-A01-autenticar.md.
 *
 * Isolada do resto: recriar o User Pool apaga o usuário admin (ele não é gerido
 * pelo CDK de propósito - RN2/senha não passa pelo IaC, ver "fora do CDK" no
 * documento de infraestrutura). `removalPolicy: RETAIN` vale em **todo** stage,
 * não só em prod.
 */
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";

import type { ConfigStage } from "../config/index.js";
import { exigirRegiaoFixa, sufixoStage } from "../config/index.js";

export interface PropsStackAuth extends cdk.StackProps {
  readonly config: ConfigStage;
}

export class StackAuth extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: PropsStackAuth) {
    super(scope, id, props);
    exigirRegiaoFixa(this.region);
    const { config } = props;

    // RN3 (UC-A01): mínimo 12 caracteres, maiúscula, minúscula, número e símbolo.
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: sufixoStage("recanto-paraiso", config.stage),
      selfSignUpEnabled: false, // RN2: autorregistro desabilitado; usuário criado por fora
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient("AppClient", {
      userPoolClientName: sufixoStage("recanto-paraiso-admin", config.stage),
      generateSecret: false, // obrigatório para SPA - com segredo, PKCE não funciona
      authFlows: {}, // RN4: nenhum fluxo direto - só Authorization Code + PKCE via Hosted UI
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`${config.siteUrl}/admin/callback`],
        logoutUrls: [`${config.siteUrl}/admin`],
      },
      accessTokenValidity: cdk.Duration.hours(1), // RN6
      refreshTokenValidity: cdk.Duration.days(30), // RN6
      idTokenValidity: cdk.Duration.hours(1),
    });

    this.userPool.addDomain("Dominio", {
      cognitoDomain: { domainPrefix: sufixoStage("recanto-paraiso", config.stage) },
    });

    new cognito.UserPoolGroup(this, "GrupoAdmin", {
      userPool: this.userPool,
      groupName: "admin",
      description: "Administradores do backoffice (RN1, UC-A01).",
    });

    new cdk.CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
  }
}
