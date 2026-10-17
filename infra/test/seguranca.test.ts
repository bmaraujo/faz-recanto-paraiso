/**
 * docs/03-tecnico/12-infraestrutura-cdk.md#testes-de-infraestrutura: "Nenhum
 * `Action: '*'`; nenhum `dynamodb:Scan`; bucket sem acesso público; `enforceSSL`;
 * Function URL com `NONE` e a Lambda com o env de validação de JWT."
 *
 * `backend` (Lambda) ainda não existe - os itens que dependem dela (Function URL,
 * env de validação de JWT) ficam para quando essa stack nascer. O bucket de
 * `frontend` já existe (só ele, sem CloudFront) e é verificado aqui junto com
 * `dados`/`auth`.
 */
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { sintetizar } from "./apoio.js";

describe.each(["dev", "prod"] as const)("stage %s", (stage) => {
  const { dados, auth, frontend } = sintetizar(stage);

  it("nenhuma policy IAM com Action '*' ou Resource '*' em dynamodb/s3, nem dynamodb:Scan", () => {
    for (const template of [Template.fromStack(dados), Template.fromStack(auth), Template.fromStack(frontend)]) {
      const policies = template.findResources("AWS::IAM::Policy");
      const roles = template.findResources("AWS::IAM::Role");
      const json = JSON.stringify({ policies, roles });

      expect(json.includes('"dynamodb:Scan"')).toBe(false);
      expect(json.includes('"Action":"*"')).toBe(false);
    }
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
