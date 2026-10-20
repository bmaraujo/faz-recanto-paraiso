/**
 * Stack `backend` — as Lambdas `api-publica` e `api-admin`, suas Function URLs
 * e o IAM de privilégio mínimo que cada uma usa **hoje**.
 * docs/03-tecnico/12-infraestrutura-cdk.md#stack-backend.
 *
 * Deliberadamente menor que a tabela do documento: `cron-diario`, `cron-ical` e
 * `publicar-conteudo` não têm handler nenhum escrito ainda, então não entram
 * aqui — criar um recurso Lambda para um arquivo que não existe não faz
 * sentido. Pelo mesmo motivo, a política de IAM de cada Lambda cobre só as
 * ações que o código de hoje de fato chama (ver `lib/db.ts`), não a lista
 * completa do documento (que antecipa SES, SSM e `lambda:InvokeFunction` para
 * recursos que também não existem ainda) — privilégio mínimo real, não
 * aspiracional. Ampliar quando o UC que precisar nascer.
 */
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import * as path from "node:path";

import type { ConfigStage } from "../config/index.js";
import { exigirRegiaoFixa } from "../config/index.js";
import { LambdaNode } from "./constructs/lambda-node.js";

export interface PropsStackBackend extends cdk.StackProps {
  readonly config: ConfigStage;
  readonly tabela: dynamodb.Table;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly bucket: s3.Bucket;
}

/**
 * `process.cwd()`, não `import.meta.url`: o `cdk` CLI só roda de dentro de
 * `infra/` (onde está `cdk.json`), e os testes deste pacote também rodam com
 * `infra/` como diretório de trabalho — então os dois contextos resolvem este
 * caminho da mesma forma. `import.meta.url` não teria essa propriedade: aponta
 * para `infra/lib/stack-backend.ts` em teste (via Vitest, direto do fonte) mas
 * para `infra/dist/lib/stack-backend.js` no `synth`/`deploy` real (via
 * `tsc`) — profundidades diferentes para o mesmo `../backend/dist/handlers`.
 */
const DIRETORIO_DIST_BACKEND = path.resolve(process.cwd(), "../backend/dist/handlers");

export class StackBackend extends cdk.Stack {
  public readonly apiPublica: lambda.Function;
  public readonly apiAdmin: lambda.Function;

  constructor(scope: Construct, id: string, props: PropsStackBackend) {
    super(scope, id, props);
    exigirRegiaoFixa(this.region);
    const { config, tabela, userPool, userPoolClient, bucket } = props;

    this.apiPublica = new LambdaNode(this, "ApiPublica", {
      nomeArquivo: "api-publica",
      diretorioDist: DIRETORIO_DIST_BACKEND,
      memoriaMb: 256,
      timeout: cdk.Duration.seconds(10),
      concorrenciaReservada: 5,
      retencaoLogDias: config.retencaoLogDias,
      environment: { STAGE: config.stage, TABELA: tabela.tableName },
    });
    // GetItem/Query: tudo que api-publica lê hoje (disponibilidade, cotação,
    // config pública). dynamodb:Scan nunca é concedido (regra do projeto).
    tabela.grant(this.apiPublica, "dynamodb:GetItem", "dynamodb:Query");
    this.apiPublica.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    this.apiAdmin = new LambdaNode(this, "ApiAdmin", {
      nomeArquivo: "api-admin",
      diretorioDist: DIRETORIO_DIST_BACKEND,
      memoriaMb: 512,
      timeout: cdk.Duration.seconds(15),
      concorrenciaReservada: 2,
      retencaoLogDias: config.retencaoLogDias,
      environment: {
        STAGE: config.stage,
        TABELA: tabela.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        // UC-A03: presigned POST de fotos (lib/s3.ts) precisa do nome do
        // bucket — api-publica não lê nem escreve S3, então não o recebe.
        BUCKET: bucket.bucketName,
      },
    });
    // Tudo que api-admin escreve/lê hoje (criar/editar/ativar/excluir casa) —
    // mesma lista de dynamodb:Scan nunca concedido.
    tabela.grant(
      this.apiAdmin,
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:TransactWriteItems",
    );
    // RN11 (UC-A03): só o prefixo midia/casas/*, nunca o bucket inteiro — é o
    // que impede esta Lambda de sobrescrever index.html. `bucket.grant()` não
    // serve aqui: ele concede no bucket inteiro, sem escopo de prefixo.
    // `s3:HeadObject` não existe como ação de IAM própria (a operação HeadObject
    // é autorizada por `s3:GetObject`) — divergência do texto do UC-A03/do
    // documento de infraestrutura, que listam as duas separadamente.
    this.apiAdmin.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
        resources: [bucket.arnForObjects("midia/casas/*")],
      }),
    );
    this.apiAdmin.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
  }
}
