/**
 * Stack `dados` — a tabela única e os parâmetros SSM não-secretos.
 * docs/03-tecnico/12-infraestrutura-cdk.md#stack-dados.
 *
 * Isolada do resto: é a única stack que **nunca** deve ser destruída junto com as
 * outras — `RETAIN` + deletion protection em `prod` (ver config/prod.ts).
 */
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import type { ConfigStage } from "../config/index.js";
import { exigirRegiaoFixa, sufixoStage } from "../config/index.js";

export interface PropsStackDados extends cdk.StackProps {
  readonly config: ConfigStage;
}

export class StackDados extends cdk.Stack {
  public readonly tabela: dynamodb.Table;

  constructor(scope: Construct, id: string, props: PropsStackDados) {
    super(scope, id, props);
    exigirRegiaoFixa(this.region);
    const { config } = props;

    this.tabela = new dynamodb.Table(this, "Tabela", {
      tableName: sufixoStage("recanto-paraiso", config.stage),
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.pontoRecuperacaoContinua,
      },
      deletionProtection: config.protecaoContraExclusaoTabela,
      removalPolicy: config.retemTabelaAoDestruirStack
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    this.tabela.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // String simples, só para documentar o contrato - as *SecureString* (segredo
    // do CDN, token do GitHub, URLs de iCal) são criadas fora do CDK de propósito
    // (ele exporia o valor no template do CloudFormation).
    new ssm.StringParameter(this, "ParametroSiteUrl", {
      parameterName: `/recanto-paraiso/${config.stage}/site-url`,
      stringValue: config.siteUrl,
    });
  }
}
