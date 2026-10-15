import * as cdk from "aws-cdk-lib";

import { carregarConfig, type Stage } from "../config/index.js";
import { StackAuth } from "../lib/stack-auth.js";
import { StackDados } from "../lib/stack-dados.js";

/** Sintetiza as duas stacks construídas até agora, para um stage. Só para teste. */
export function sintetizar(stage: Stage): { dados: StackDados; auth: StackAuth } {
  const app = new cdk.App();
  const config = carregarConfig(stage);
  const env = { account: "123456789012", region: "sa-east-1" };

  const dados = new StackDados(app, `TesteDados${stage}`, { config, env });
  const auth = new StackAuth(app, `TesteAuth${stage}`, { config, env });

  return { dados, auth };
}
