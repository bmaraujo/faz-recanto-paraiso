import type { ConfigStage } from "./tipos.js";

export const configProd: ConfigStage = {
  stage: "prod",
  pontoRecuperacaoContinua: true,
  protecaoContraExclusaoTabela: true,
  retemTabelaAoDestruirStack: true,
  retemBucketAoDestruirStack: true,
  retencaoLogDias: 14,
  // [DEFINIR] (docs/06-planejamento/02-pendencias-definir.md, item 8.1/8.2): sem
  // domínio nem distribuição CloudFront ainda. Placeholder óbvio de propósito —
  // atualizar antes do primeiro deploy real de prod, nunca silenciosamente.
  siteUrl: "https://dominio-nao-definido.exemplo.invalido",
};
