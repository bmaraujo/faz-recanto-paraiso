import { describe, expect, it } from "vitest";

import { projetarConfigGeralPublica, type ConfigGeral } from "../src/dominio/configGeral";

const CONFIG_COMPLETA: ConfigGeral = {
  nomeFazenda: "Recanto Paraíso",
  whatsapp: "+5511999999999",
  emailAdmin: "proprietario@exemplo.com.br",
  emailRemetente: "reservas@exemplo.com.br",
  emailResponder: "proprietario@exemplo.com.br",
  prazoSolicitacaoHoras: 48,
  antecedenciaMinimaDias: 1,
  janelaReservaMeses: 12,
  horarioCheckin: "14:00",
  horarioCheckout: "12:00",
  maxSolicitacoesPendentesPorEmail: 3,
  faixasCancelamento: [
    { diasMinimos: 30, percentualDevolucao: 100 },
    { diasMinimos: 0, percentualDevolucao: 0 },
  ],
  devolveTaxaLimpeza: true,
  textoCancelamento: "## Cancelamento\n...",
  textoPrivacidade: "## Privacidade\n...",
  textoTermos: "## Termos\n...",
  textoRegrasGerais: "## Regras\n...",
  faq: [{ pergunta: "Aceita pet?", resposta: "Depende da casa." }],
};

describe("projetarConfigGeralPublica", () => {
  it("devolve exatamente os 12 campos públicos de RN14, nenhum mais", () => {
    const publica = projetarConfigGeralPublica(CONFIG_COMPLETA);

    expect(Object.keys(publica).sort()).toEqual(
      [
        "antecedenciaMinimaDias",
        "devolveTaxaLimpeza",
        "faixasCancelamento",
        "faq",
        "horarioCheckin",
        "horarioCheckout",
        "janelaReservaMeses",
        "nomeFazenda",
        "textoCancelamento",
        "textoPrivacidade",
        "textoRegrasGerais",
        "textoTermos",
        "whatsapp",
      ].sort(),
    );
  });

  it("nunca inclui emailAdmin, emailRemetente, emailResponder, prazoSolicitacaoHoras ou maxSolicitacoesPendentesPorEmail", () => {
    const publica = projetarConfigGeralPublica(CONFIG_COMPLETA) as Record<string, unknown>;

    expect(publica.emailAdmin).toBeUndefined();
    expect(publica.emailRemetente).toBeUndefined();
    expect(publica.emailResponder).toBeUndefined();
    expect(publica.prazoSolicitacaoHoras).toBeUndefined();
    expect(publica.maxSolicitacoesPendentesPorEmail).toBeUndefined();
  });

  it("um campo novo e desconhecido na entrada não aparece na saída (allowlist, não denylist)", () => {
    const comCampoNovo = { ...CONFIG_COMPLETA, campoFuturoAindaNaoPrevisto: "segredo" };
    const publica = projetarConfigGeralPublica(comCampoNovo) as Record<string, unknown>;

    expect(publica.campoFuturoAindaNaoPrevisto).toBeUndefined();
  });

  it("preserva os valores dos campos públicos sem transformá-los", () => {
    const publica = projetarConfigGeralPublica(CONFIG_COMPLETA);

    expect(publica).toEqual({
      nomeFazenda: "Recanto Paraíso",
      whatsapp: "+5511999999999",
      horarioCheckin: "14:00",
      horarioCheckout: "12:00",
      antecedenciaMinimaDias: 1,
      janelaReservaMeses: 12,
      faixasCancelamento: CONFIG_COMPLETA.faixasCancelamento,
      devolveTaxaLimpeza: true,
      textoCancelamento: CONFIG_COMPLETA.textoCancelamento,
      textoPrivacidade: CONFIG_COMPLETA.textoPrivacidade,
      textoTermos: CONFIG_COMPLETA.textoTermos,
      textoRegrasGerais: CONFIG_COMPLETA.textoRegrasGerais,
      faq: CONFIG_COMPLETA.faq,
    });
  });
});
