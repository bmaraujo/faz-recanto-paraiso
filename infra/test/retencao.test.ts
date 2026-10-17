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

describe("bucket em dev", () => {
  it("tem DeletionPolicy Delete (destrutível, sem conteúdo real ainda)", () => {
    const template = Template.fromStack(sintetizar("dev").frontend);
    template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
  });
});

describe("bucket em prod", () => {
  it("tem DeletionPolicy Retain (um `cdk destroy` não pode apagar as fotos de verdade)", () => {
    const template = Template.fromStack(sintetizar("prod").frontend);
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });
});
