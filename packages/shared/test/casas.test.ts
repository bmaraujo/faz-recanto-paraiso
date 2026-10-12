import { describe, expect, it } from "vitest";

import {
  type FotoParaCompletude,
  SLUG_REGEX,
  avaliarCompletudeParaAtivar,
  ehUrlDeMapaPermitida,
  sugerirSlug,
} from "../src/dominio/casas";

/**
 * Casos obrigatórios de docs/02-casos-de-uso/admin/UC-A02-gerenciar-casas.md que
 * pertencem a este módulo puro (os demais exigem DynamoDB — ver o cabeçalho de
 * `dominio/casas.ts`).
 */
describe("casos obrigatórios", () => {
  it("5. nome 'Casa do Lago' sugere o slug 'casa-do-lago'", () => {
    expect(sugerirSlug("Casa do Lago")).toBe("casa-do-lago");
  });

  it("6. ativar casa sem fotos falta 'fotos'", () => {
    const resultado = avaliarCompletudeParaAtivar({
      resumo: "Resumo preenchido de verdade.",
      descricao: "Descrição preenchida de verdade, com detalhes suficientes.",
      fotos: [],
      precosValidos: true,
    });
    expect(resultado).toEqual({ completa: false, faltando: ["fotos"] });
  });

  it("7. ativar casa sem preços válidos falta 'precos'", () => {
    const resultado = avaliarCompletudeParaAtivar({
      resumo: "Resumo preenchido de verdade.",
      descricao: "Descrição preenchida de verdade, com detalhes suficientes.",
      fotos: [{ principal: true, textoAlternativo: "Fachada da casa" }],
      precosValidos: false,
    });
    expect(resultado).toEqual({ completa: false, faltando: ["precos"] });
  });

  it("8. ativar casa com foto sem texto alternativo falta 'textoAlternativo'", () => {
    const resultado = avaliarCompletudeParaAtivar({
      resumo: "Resumo preenchido de verdade.",
      descricao: "Descrição preenchida de verdade, com detalhes suficientes.",
      fotos: [{ principal: true, textoAlternativo: "   " }],
      precosValidos: true,
    });
    expect(resultado.completa).toBe(false);
    expect(resultado.faltando).toContain("textoAlternativo");
  });

  it("9. ativar casa completa retorna completa: true", () => {
    const resultado = avaliarCompletudeParaAtivar({
      resumo: "Resumo preenchido de verdade.",
      descricao: "Descrição preenchida de verdade, com detalhes suficientes.",
      fotos: [{ principal: true, textoAlternativo: "Fachada da casa" }],
      precosValidos: true,
    });
    expect(resultado).toEqual({ completa: true, faltando: [] });
  });

  it("12. mapaEmbedUrl em http:// é recusada", () => {
    expect(ehUrlDeMapaPermitida("http://www.openstreetmap.org/export/embed.html")).toBe(
      false,
    );
  });

  it("13. mapaEmbedUrl em evil.com é recusada", () => {
    expect(ehUrlDeMapaPermitida("https://evil.com/export/embed.html")).toBe(false);
  });
});

describe("sugerirSlug", () => {
  it("remove acentos e símbolos, troca espaço por hífen", () => {
    expect(sugerirSlug("Chalé do Mirante!")).toBe("chale-do-mirante");
    expect(sugerirSlug("Casa da Mata — Fazenda")).toBe("casa-da-mata-fazenda");
  });

  it("não deixa hífen duplicado nem nas pontas", () => {
    expect(sugerirSlug("  --Casa   do   Lago--  ")).toBe("casa-do-lago");
  });

  it("trunca ao limite de 60 caracteres sem deixar hífen pendurado", () => {
    const nomeLongo = "Casa " + "muito ".repeat(15) + "grande";
    const slug = sugerirSlug(nomeLongo);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("nome só com símbolos sugere slug vazio, sem lançar erro", () => {
    expect(sugerirSlug("!!!")).toBe("");
  });

  it("todo slug não vazio sugerido já casa com SLUG_REGEX", () => {
    for (const nome of ["Casa do Lago", "Chalé do Mirante", "Casa 2", "àÁâÂãÃçÇ"]) {
      const slug = sugerirSlug(nome);
      if (slug !== "") expect(slug).toMatch(SLUG_REGEX);
    }
  });
});

describe("ehUrlDeMapaPermitida", () => {
  it("aceita OpenStreetMap em https, com ou sem www", () => {
    expect(ehUrlDeMapaPermitida("https://www.openstreetmap.org/export/embed.html")).toBe(
      true,
    );
    expect(ehUrlDeMapaPermitida("https://openstreetmap.org/export/embed.html")).toBe(
      true,
    );
  });

  it("aceita Google Maps em https, só quando o caminho começa com /maps", () => {
    expect(ehUrlDeMapaPermitida("https://www.google.com/maps/embed?pb=1")).toBe(true);
    expect(ehUrlDeMapaPermitida("https://www.google.com/search?q=casa")).toBe(false);
  });

  it("recusa URL malformada em vez de lançar erro", () => {
    expect(ehUrlDeMapaPermitida("isto nao e uma url")).toBe(false);
    expect(ehUrlDeMapaPermitida("")).toBe(false);
  });

  it("recusa host parecido que não é subdomínio real (ataque de substring)", () => {
    expect(ehUrlDeMapaPermitida("https://openstreetmap.org.evil.com/")).toBe(false);
    expect(ehUrlDeMapaPermitida("https://evilopenstreetmap.org/")).toBe(false);
  });
});

describe("avaliarCompletudeParaAtivar", () => {
  const FOTO_OK: FotoParaCompletude = { principal: true, textoAlternativo: "Fachada" };

  it("acumula todos os itens faltantes de uma vez, não só o primeiro", () => {
    const resultado = avaliarCompletudeParaAtivar({
      resumo: "",
      descricao: "",
      fotos: [],
      precosValidos: false,
    });
    expect(resultado.faltando).toEqual(
      expect.arrayContaining(["fotos", "precos", "resumo", "descricao"]),
    );
    expect(resultado.completa).toBe(false);
  });

  it("falta fotoPrincipal quando nenhuma foto é principal", () => {
    const resultado = avaliarCompletudeParaAtivar({
      resumo: "Resumo válido para a casa.",
      descricao: "Descrição válida e detalhada da casa para o visitante.",
      fotos: [{ principal: false, textoAlternativo: "Fachada" }],
      precosValidos: true,
    });
    expect(resultado.faltando).toEqual(["fotoPrincipal"]);
  });

  it("não reporta fotoPrincipal nem textoAlternativo quando a lista de fotos está vazia", () => {
    // Evita um "faltando" redundante: já existe o item genérico "fotos".
    const resultado = avaliarCompletudeParaAtivar({
      resumo: "x".repeat(25),
      descricao: "x".repeat(60),
      fotos: [],
      precosValidos: true,
    });
    expect(resultado.faltando).toEqual(["fotos"]);
  });

  it("resumo ou descrição só com espaço contam como vazios", () => {
    const resultado = avaliarCompletudeParaAtivar({
      resumo: "   ",
      descricao: "   ",
      fotos: [FOTO_OK],
      precosValidos: true,
    });
    expect(resultado.faltando).toEqual(["resumo", "descricao"]);
  });
});
