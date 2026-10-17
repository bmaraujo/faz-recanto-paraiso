/**
 * docs/03-tecnico/12-infraestrutura-cdk.md#testes-de-infraestrutura: "Nenhum NAT
 * Gateway, ALB, RDS, EC2, WAF ou Secrets Manager no template." A forma mais
 * eficaz de defender a meta de custo: falha o build, não a fatura.
 */
import { Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";

import { sintetizar } from "./apoio.js";

const TIPOS_PROIBIDOS = [
  "AWS::EC2::NatGateway",
  "AWS::EC2::Instance",
  "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::RDS::DBInstance",
  "AWS::RDS::DBCluster",
  "AWS::WAFv2::WebACL",
  "AWS::SecretsManager::Secret",
];

describe.each(["dev", "prod"] as const)("stage %s", (stage) => {
  const { dados, auth, frontend } = sintetizar(stage);

  it.each(TIPOS_PROIBIDOS)("não contém %s em nenhuma stack construída", (tipo) => {
    Template.fromStack(dados).resourceCountIs(tipo, 0);
    Template.fromStack(auth).resourceCountIs(tipo, 0);
    Template.fromStack(frontend).resourceCountIs(tipo, 0);
  });

  it("DynamoDB é PAY_PER_REQUEST (nunca provisionado)", () => {
    Template.fromStack(dados).hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });
});
