import { describe, expect, it } from "vitest";

import { detectarTipoPorMagicNumber, extrairDimensoes } from "../../../src/domain/fotos";
import { construirJpeg, construirPng, construirWebp } from "../../fixtures-imagem";

describe("detectarTipoPorMagicNumber (RN13)", () => {
  it("detecta WebP pela assinatura RIFF....WEBP", () => {
    expect(detectarTipoPorMagicNumber(construirWebp(5, 7))).toBe("image/webp");
  });

  it("detecta JPEG por FF D8 FF", () => {
    expect(detectarTipoPorMagicNumber(construirJpeg(3, 2))).toBe("image/jpeg");
  });

  it("detecta PNG pela assinatura de 8 bytes", () => {
    expect(detectarTipoPorMagicNumber(construirPng(10, 20))).toBe("image/png");
  });

  it("6. HTML renomeado com Content-Type: image/webp não casa com nenhuma assinatura", () => {
    const html = Buffer.from("<!DOCTYPE html><html></html>", "utf8");
    expect(detectarTipoPorMagicNumber(html)).toBeUndefined();
  });

  it("7. SVG não casa com nenhuma assinatura aceita", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
    expect(detectarTipoPorMagicNumber(svg)).toBeUndefined();
  });

  it("buffer vazio ou curto não lança erro, só devolve undefined", () => {
    expect(detectarTipoPorMagicNumber(Buffer.alloc(0))).toBeUndefined();
    expect(detectarTipoPorMagicNumber(Buffer.from([0xff]))).toBeUndefined();
  });
});

describe("extrairDimensoes (RN14)", () => {
  it("1. extrai largura/altura de um cabeçalho PNG real", () => {
    expect(extrairDimensoes(construirPng(1600, 1067))).toEqual({ largura: 1600, altura: 1067 });
  });

  it("extrai largura/altura de um cabeçalho JPEG real", () => {
    expect(extrairDimensoes(construirJpeg(4000, 3000))).toEqual({ largura: 4000, altura: 3000 });
  });

  it("extrai largura/altura de um cabeçalho WebP (VP8X) real", () => {
    expect(extrairDimensoes(construirWebp(800, 600))).toEqual({ largura: 800, altura: 600 });
  });

  it("nunca confia em largura/altura vindas do cliente — só o que está no próprio arquivo", () => {
    // Não há parâmetro de entrada para "o cliente disse": a própria assinatura
    // da função já impede isso. Este teste documenta a intenção da RN14.
    const png = construirPng(50, 60);
    expect(extrairDimensoes(png)).toEqual({ largura: 50, altura: 60 });
  });

  it("devolve undefined para um arquivo sem cabeçalho de imagem reconhecível", () => {
    expect(extrairDimensoes(Buffer.from("isto não é uma imagem", "utf8"))).toBeUndefined();
  });

  it("devolve undefined para um cabeçalho verdadeiro mas truncado antes das dimensões", () => {
    const pngTruncado = construirPng(100, 100).subarray(0, 15); // corta antes de width/height
    expect(extrairDimensoes(pngTruncado)).toBeUndefined();
  });

  it("devolve undefined em vez de lançar, para buffer vazio", () => {
    expect(extrairDimensoes(Buffer.alloc(0))).toBeUndefined();
  });
});
