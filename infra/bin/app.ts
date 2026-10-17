#!/usr/bin/env node
/**
 * Entrada do CDK: uma instância de cada stack por stage, com sufixo `-<stage>`.
 * docs/03-tecnico/12-infraestrutura-cdk.md#stages.
 *
 * `--context stage=` é obrigatório (`carregarConfig` lança se ausente) - decide em
 * qual ambiente o deploy acontece, e não deve ter um padrão que erre silenciosamente.
 *
 * `dados`, `auth` e `frontend` (só o bucket, por agora) existem até agora
 * (docs/06-planejamento/03-progresso-de-implementacao.md). `observabilidade`
 * nasce quando houver o que alarmar; a parte de CloudFront/ACM/domínio de
 * `frontend` nasce quando a pendência de domínio (8.1) for resolvida.
 */
import * as cdk from "aws-cdk-lib";

import { REGIAO_FIXA, carregarConfig, sufixoStage } from "../config/index.js";
import { StackAuth } from "../lib/stack-auth.js";
import { StackDados } from "../lib/stack-dados.js";
import { StackFrontend } from "../lib/stack-frontend.js";

const app = new cdk.App();
const config = carregarConfig(app.node.tryGetContext("stage"));

// Conta 627010764306, decisão já tomada (docs/06-planejamento/02-pendencias-definir.md,
// item 8.3). Região **fixa** em sa-east-1 (ADR-011) - nenhuma stack aqui precisa de
// us-east-1 (essa exceção é só do certificado ACM do CloudFront, que não existe
// ainda). Deliberadamente NÃO lido de CDK_DEFAULT_REGION: o `cdk` CLI injeta essa
// variável a partir da região default do perfil AWS local, que pode ser
// `us-east-1` por configuração pessoal - e essa região nunca pode decidir isso
// neste projeto.
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? "627010764306",
  region: REGIAO_FIXA,
};

new StackDados(app, sufixoStage("RecantoParaisoDados", config.stage), { config, env });
new StackAuth(app, sufixoStage("RecantoParaisoAuth", config.stage), { config, env });
new StackFrontend(app, sufixoStage("RecantoParaisoFrontend", config.stage), { config, env });
