import { configDev } from "./dev.js";
import { configProd } from "./prod.js";
import type { ConfigStage, Stage } from "./tipos.js";

export type { ConfigStage, Stage } from "./tipos.js";
export { REGIAO_FIXA, exigirRegiaoFixa, sufixoStage } from "./tipos.js";

const CONFIGS: Record<Stage, ConfigStage> = { dev: configDev, prod: configProd };

/**
 * `--context stage=` é obrigatório, sem padrão — um deploy sem stage explícito é
 * exatamente o tipo de erro que decide "em qual ambiente" por acidente.
 */
export function carregarConfig(stage: unknown): ConfigStage {
  if (stage !== "dev" && stage !== "prod") {
    throw new Error(
      `Contexto "stage" ausente ou inválido (recebido: ${JSON.stringify(stage)}). ` +
        `Use --context stage=dev ou --context stage=prod.`,
    );
  }
  return CONFIGS[stage];
}
