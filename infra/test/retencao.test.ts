/**
 * docs/03-tecnico/12-infraestrutura-cdk.md#testes-de-infraestrutura: "Tabela de
 * `prod` com `RETAIN` e PITR; log groups com retenção definida."
 */
import { Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";

import { sintetizar } from "./apoio.js";

describe("tabela em dev", () => {
  const template = Template.fromStack(sintetizar("dev").dados);

  it("não tem PITR nem DeletionPolicy Retain", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
      DeletionProtectionEnabled: false,
    });
    template.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Delete" });
  });
});

describe("tabela em prod", () => {
  const template = Template.fromStack(sintetizar("prod").dados);

  it("tem PITR, deletion protection e DeletionPolicy Retain", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      DeletionProtectionEnabled: true,
    });
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });
});

describe("User Pool", () => {
  it("tem DeletionPolicy Retain em todo stage (perder o admin não é um risco de só prod)", () => {
    for (const stage of ["dev", "prod"] as const) {
      const template = Template.fromStack(sintetizar(stage).auth);
      template.hasResource("AWS::Cognito::UserPool", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    }
  });
});
