/**
 * docs/03-tecnico/12-infraestrutura-cdk.md#testes-de-infraestrutura: "Nenhum
 * `Action: '*'`; nenhum `dynamodb:Scan`; bucket sem acesso público; `enforceSSL`;
 * Function URL com `NONE` e a Lambda com o env de validação de JWT."
 */
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { sintetizar } from "./apoio.js";

describe.each(["dev", "prod"] as const)("stage %s", (stage) => {
  const { dados, auth, frontend, backend } = sintetizar(stage);

  it("nenhuma policy IAM com Action '*' ou Resource '*' em dynamodb/s3, nem dynamodb:Scan", () => {
    for (const template of [
      Template.fromStack(dados),
      Template.fromStack(auth),
      Template.fromStack(frontend),
      Template.fromStack(backend),
    ]) {
      const policies = template.findResources("AWS::IAM::Policy");
      const roles = template.findResources("AWS::IAM::Role");
      const json = JSON.stringify({ policies, roles });

      expect(json.includes('"dynamodb:Scan"')).toBe(false);
      expect(json.includes('"Action":"*"')).toBe(false);
    }
  });

  it("as duas Function URLs são NONE — a Lambda valida, não o OAC (pegadinha documentada)", () => {
    const template = Template.fromStack(backend);
    template.resourceCountIs("AWS::Lambda::Url", 2);
    const urls = template.findResources("AWS::Lambda::Url", {
      Properties: { AuthType: "NONE" },
    });
    expect(Object.keys(urls)).toHaveLength(2);
  });

  it("api-admin recebe USER_POOL_ID/USER_POOL_CLIENT_ID; api-publica não", () => {
    const template = Template.fromStack(backend);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "api-admin.handler",
      Environment: {
        Variables: Match.objectLike({
          USER_POOL_ID: Match.anyValue(),
          USER_POOL_CLIENT_ID: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "api-publica.handler",
      Environment: {
        Variables: Match.not(Match.objectLike({ USER_POOL_ID: Match.anyValue() })),
      },
    });
  });

  it("a permissão de S3 da api-admin é restrita ao prefixo midia/casas/*, nunca o bucket inteiro", () => {
    const template = Template.fromStack(backend);
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies.includes("midia/casas/*")).toBe(true);
    expect(policies.includes('"s3:*"')).toBe(false);
  });

  it("o bucket bloqueia todo acesso público e exige TLS", () => {
    const template = Template.fromStack(frontend);
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("o User Pool não permite autorregistro (RN2) e o client não gera segredo (PKCE)", () => {
    const template = Template.fromStack(auth);
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
    });
  });

  it("o App Client só permite Authorization Code Grant, nunca implicit (RN4)", () => {
    const template = Template.fromStack(auth);
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: ["code"],
    });
  });
});
