/**
 * Leitura de configuracao do ambiente da Lambda.
 *
 * `env` entra por parametro (default `process.env`) pelo mesmo motivo que `agora`
 * entra por parametro em `dominio/datas.ts`: mantem a funcao testavel sem precisar
 * mutar uma variavel global no teste.
 *
 * Ver docs/03-tecnico/13-observabilidade.md#health-check e
 * docs/04-operacao/01-ambientes-e-deploy.md#versionamento.
 */

export interface ConfiguracaoAmbiente {
  /** `dev` ou `prod`. Preenchido pelo CDK por stage. */
  stage: string;
  /** `<AAAA.MM.DD>-<hash curto do commit>`, injetado no build/deploy. */
  versao: string;
}

/**
 * Antes do primeiro deploy (CDK ainda nao existe), `STAGE`/`VERSAO` nao estao
 * definidas - os valores padrao deixam o handler testavel e executavel localmente
 * sem mascarar a ausencia em produção: lá, o pipeline de deploy sempre define as
 * duas (docs/04-operacao/01-ambientes-e-deploy.md).
 */
const STAGE_PADRAO = "dev";
const VERSAO_PADRAO = "dev-local";

export function lerConfiguracaoAmbiente(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguracaoAmbiente {
  return {
    stage: env.STAGE ?? STAGE_PADRAO,
    versao: env.VERSAO ?? VERSAO_PADRAO,
  };
}
