import type { ConfigStage } from "./tipos.js";

export const configDev: ConfigStage = {
  stage: "dev",
  pontoRecuperacaoContinua: false,
  protecaoContraExclusaoTabela: false,
  retemTabelaAoDestruirStack: false,
  retemBucketAoDestruirStack: false,
  retencaoLogDias: 7,
  siteUrl: "http://localhost:4321",
};
