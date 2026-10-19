/**
 * Construct padrão de Lambda deste projeto — docs/03-tecnico/12-infraestrutura-cdk.md#stack-backend.
 *
 * Usa `lambda.Function` + `Code.fromAsset`, **não** `NodejsFunction` (como o
 * documento sugere): o bundle de cada handler já existe —
 * `backend/esbuild.config.mjs` produz `backend/dist/handlers/<nome>.mjs`, testado
 * e usado pelo próprio `backend/` (ver `npm run build -w backend`). Deixar o CDK
 * rebundlar com o esbuild interno do `NodejsFunction` duplicaria a configuração
 * de bundle (minify, sourcemap, formato ESM) em dois lugares que podem divergir
 * silenciosamente. **Pré-requisito:** `npm run build -w backend` antes de
 * `cdk synth`/`deploy` — o diretório `backend/dist/handlers` precisa existir.
 */
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

/** Só os dois valores que os stages deste projeto já usam (7/14 dias) — ver
 * `config/dev.ts`/`config/prod.ts`. Lança para qualquer outro, de propósito:
 * melhor um erro claro no `synth` do que silenciosamente cair num padrão. */
function paraRetentionDays(dias: number): logs.RetentionDays {
  if (dias === 7) return logs.RetentionDays.ONE_WEEK;
  if (dias === 14) return logs.RetentionDays.TWO_WEEKS;
  throw new Error(`Retenção de log de "${dias}" dias não mapeada em lambda-node.ts.`);
}

export interface PropsLambdaNode {
  /** Nome do arquivo em `backend/dist/handlers/`, sem extensão — ex.: "api-admin". */
  readonly nomeArquivo: string;
  /** Caminho absoluto para `backend/dist/handlers`. */
  readonly diretorioDist: string;
  readonly memoriaMb: number;
  readonly timeout: cdk.Duration;
  readonly concorrenciaReservada: number;
  readonly retencaoLogDias: number;
  readonly environment: Record<string, string>;
}

export class LambdaNode extends lambda.Function {
  constructor(scope: Construct, id: string, props: PropsLambdaNode) {
    const logGroup = new logs.LogGroup(scope, `${id}Logs`, {
      retention: paraRetentionDays(props.retencaoLogDias),
      removalPolicy: cdk.RemovalPolicy.DESTROY, // log, não dado de negócio — nunca RETAIN
    });

    super(scope, id, {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64, // Graviton: ~20% mais barato
      code: lambda.Code.fromAsset(props.diretorioDist),
      handler: `${props.nomeArquivo}.handler`,
      memorySize: props.memoriaMb,
      timeout: props.timeout,
      reservedConcurrentExecutions: props.concorrenciaReservada,
      environment: props.environment,
      tracing: lambda.Tracing.DISABLED, // X-Ray custa; não usamos
      logGroup,
    });
  }
}
