/**
 * Stack `frontend` — por agora, só o bucket S3.
 * docs/03-tecnico/12-infraestrutura-cdk.md#stack-frontend,
 * docs/03-tecnico/07-armazenamento-de-imagens.md.
 *
 * O bucket serve dois papéis futuros (site estático + mídia das casas), mas o
 * resto da stack planejada — CloudFront, ACM, Route 53, CloudFront Function, OAC —
 * depende de uma decisão de domínio ainda `[DEFINIR]` (pendência 8.1) e de nada
 * ainda precisar servir o bucket publicamente. O que UC-A03 (fotos) precisa hoje
 * é só o bucket existir, com a política de segurança certa, para a Lambda
 * `api-admin` (`stack-backend`) poder escrever em `midia/casas/*` — ver a
 * decisão registrada em docs/06-planejamento/03-progresso-de-implementacao.md.
 *
 * Nome do bucket: **não fixado**. Nomes de bucket S3 são únicos globalmente
 * (diferente do nome da tabela DynamoDB, que só precisa ser único na conta) —
 * um nome fixo como `recanto-paraiso-site-<stage>` arriscaria colidir com um
 * bucket de outra conta AWS e falhar o deploy. Deixar o CDK gerar o nome
 * (incorporando conta, região e o nome da stack, que já tem o sufixo do stage)
 * garante unicidade sem essa aposta.
 */
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import type { ConfigStage } from "../config/index.js";
import { exigirRegiaoFixa } from "../config/index.js";

export interface PropsStackFrontend extends cdk.StackProps {
  readonly config: ConfigStage;
}

export class StackFrontend extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: PropsStackFrontend) {
    super(scope, id, props);
    exigirRegiaoFixa(this.region);
    const { config } = props;

    this.bucket = new s3.Bucket(this, "Bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true, // RN: TLS obrigatório — nega qualquer acesso sem aws:SecureTransport
      versioned: false, // conteúdo regenerável (site) ou já guardado no item da casa (fotos)
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) }],
      removalPolicy: config.retemBucketAoDestruirStack
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      // Só com DESTROY: um bucket RETAIN nunca deve ser esvaziado por engano
      // pelo próprio CDK, mesmo que o stack seja destruído.
      autoDeleteObjects: !config.retemBucketAoDestruirStack,
    });

    new cdk.CfnOutput(this, "NomeDoBucket", { value: this.bucket.bucketName });
  }
}
