/**
 * Projeção pública da configuração geral (UC-A13, RN14).
 *
 * Este módulo existe antes da escrita completa de `ConfigGeral` (`PUT
 * /api/admin/config`, validação RN1–RN16) porque `GET /api/config-publica` é
 * Fase 1, e a escrita é Fase 2 — ver
 * docs/06-planejamento/03-progresso-de-implementacao.md. `ConfigGeral` aqui é só
 * **forma**: o item como existe no banco, sem nenhuma regra de validação de
 * administração (isso nasce com UC-A13).
 *
 * Nota sobre `textoRegrasGerais`: o exemplo JSON de
 * docs/03-tecnico/02-modelo-de-dados.md#7-configuração-geral não lista esse campo,
 * mas o grupo 5 de UC-A13 o lista explicitamente como texto legal editável.
 * Tratado aqui como existente — a omissão no outro documento parece exemplo
 * incompleto, não decisão de excluí-lo.
 */

export interface FaixaCancelamento {
  diasMinimos: number;
  percentualDevolucao: number;
}

export interface PerguntaFaq {
  pergunta: string;
  resposta: string;
}

/** O item `CONFIG/GERAL` por completo — campos públicos e privados (RN14). */
export interface ConfigGeral {
  nomeFazenda: string;
  whatsapp: string;
  emailAdmin: string;
  emailRemetente: string;
  emailResponder: string;
  prazoSolicitacaoHoras: number;
  antecedenciaMinimaDias: number;
  janelaReservaMeses: number;
  horarioCheckin: string;
  horarioCheckout: string;
  maxSolicitacoesPendentesPorEmail: number;
  faixasCancelamento: FaixaCancelamento[];
  devolveTaxaLimpeza: boolean;
  textoCancelamento: string;
  textoPrivacidade: string;
  textoTermos: string;
  textoRegrasGerais: string;
  faq: PerguntaFaq[];
}

/**
 * Subconjunto que `GET /api/config-publica` devolve (RN14). **Nunca** inclui
 * `emailAdmin`, `emailRemetente`, `emailResponder`, `prazoSolicitacaoHoras` ou
 * `maxSolicitacoesPendentesPorEmail`.
 */
export type ConfigGeralPublica = Pick<
  ConfigGeral,
  | "nomeFazenda"
  | "whatsapp"
  | "horarioCheckin"
  | "horarioCheckout"
  | "antecedenciaMinimaDias"
  | "janelaReservaMeses"
  | "faixasCancelamento"
  | "devolveTaxaLimpeza"
  | "textoCancelamento"
  | "textoPrivacidade"
  | "textoTermos"
  | "textoRegrasGerais"
  | "faq"
>;

/**
 * Projeta para os campos públicos — **allowlist**, não denylist (UC-A13,
 * "armadilha" 3): lista o que pode sair, não o que não pode. Um campo novo
 * adicionado a `ConfigGeral` no futuro fica privado por padrão, que é o lado
 * seguro do erro.
 */
export function projetarConfigGeralPublica(config: ConfigGeral): ConfigGeralPublica {
  return {
    nomeFazenda: config.nomeFazenda,
    whatsapp: config.whatsapp,
    horarioCheckin: config.horarioCheckin,
    horarioCheckout: config.horarioCheckout,
    antecedenciaMinimaDias: config.antecedenciaMinimaDias,
    janelaReservaMeses: config.janelaReservaMeses,
    faixasCancelamento: config.faixasCancelamento,
    devolveTaxaLimpeza: config.devolveTaxaLimpeza,
    textoCancelamento: config.textoCancelamento,
    textoPrivacidade: config.textoPrivacidade,
    textoTermos: config.textoTermos,
    textoRegrasGerais: config.textoRegrasGerais,
    faq: config.faq,
  };
}
