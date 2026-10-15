/**
 * docs/03-tecnico/12-infraestrutura-cdk.md#testes-de-infraestrutura: "Nenhum
 * `Action: '*'`; nenhum `dynamodb:Scan`; bucket sem acesso público; `enforceSSL`;
 * Function URL com `NONE` e a Lambda com o env de validação de JWT."
 *
 * `backend`/`frontend` ainda não existem (sem Lambda, sem bucket) - os itens que
 * dependem deles ficam para quando essas stacks nascerem. O que já se aplica a
 * `dados`/`auth` é verificado aqui.
 */
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { sintetizar } from "./apoio.js";

describe.each(["dev", "prod"] as const)("stage %s", (stage) => {
  const { dados, auth } = sintetizar(stage);

  it("nenhuma policy IAM com Action '*' ou Resource '*' em dynamodb/s3, nem dynamodb:Scan", () => {
    for (const template of [Template.fromStack(dados), Template.fromStack(auth)]) {
      const policies = template.findResources("AWS::IAM::Policy");
      const roles = template.findResources("AWS::IAM::Role");
      const json = JSON.stringify({ policies, roles });

      expect(json.includes('"dynamodb:Scan"')).toBe(false);
      expect(json.includes('"Action":"*"')).toBe(false);
    }
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
