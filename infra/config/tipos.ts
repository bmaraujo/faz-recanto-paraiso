/**
 * Configuração por stage — docs/03-tecnico/12-infraestrutura-cdk.md#stages.
 *
 * Só os campos que as stacks construídas até agora (`dados`, `auth`) precisam.
 * `siteUrl` aponta para `localhost` em `dev` porque `stack-frontend` (CloudFront)
 * ainda não existe — não há domínio real para registrar como callback do Cognito.
 * Trocar para a URL do CloudFront quando essa stack nascer, e para o domínio
 * `[DEFINIR]` quando a pendência 8.1 for resolvida (docs/06-planejamento/02-pendencias-definir.md).
 */
export type Stage = "dev" | "prod";

export interface ConfigStage {
  readonly stage: Stage;
  readonly pontoRecuperacaoContinua: boolean;
  readonly protecaoContraExclusaoTabela: boolean;
  readonly retemTabelaAoDestruirStack: boolean;
  readonly siteUrl: string;
}

export function sufixoStage(nome: string, stage: Stage): string {
  return `${nome}-${stage}`;
}

/**
 * ADR-011: todos os dados em `sa-east-1`. Única exceção do projeto é o
 * certificado ACM do CloudFront, que nenhuma stack construída até agora usa.
 */
export const REGIAO_FIXA = "sa-east-1";

/**
 * Barreira contra a região default do perfil AWS local vazar para uma stack
 * (já aconteceu: `cdk` injeta `CDK_DEFAULT_REGION` a partir do perfil, que pode
 * não ser `sa-east-1`). Chame no construtor de toda stack, após `super()`.
 */
export function exigirRegiaoFixa(regiaoDaStack: string): void {
  if (regiaoDaStack !== REGIAO_FIXA) {
    throw new Error(
      `Região "${regiaoDaStack}" não é "${REGIAO_FIXA}" (ADR-011). ` +
        `Verifique se algo está lendo CDK_DEFAULT_REGION em vez do valor fixo.`,
    );
  }
}
