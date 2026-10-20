/**
 * Builders de cabeçalho de imagem **estruturalmente válido** (não uma
 * imagem real decodificável) para testar `domain/fotos.ts` sem depender de
 * um arquivo binário externo. Cada layout de bytes foi conferido contra a
 * lógica de parsing real da biblioteca `image-size` (não é um palpite).
 * Compartilhado entre o teste de unidade de `domain/fotos.ts`, o de
 * `handlers/api-admin.ts` (mocka `lib/s3.ts`, mas usa bytes reais aqui) e o
 * de integração — as três camadas precisam dos mesmos bytes válidos.
 */

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function construirPng(largura: number, altura: number): Buffer {
  const buffer = Buffer.alloc(24);
  ASSINATURA_PNG.copy(buffer, 0);
  buffer.write("IHDR", 12, "latin1");
  buffer.writeUInt32BE(largura, 16);
  buffer.writeUInt32BE(altura, 20);
  return buffer;
}

/** SOI + um marcador de 0 bytes de payload + SOF0 com altura/largura. */
export function construirJpeg(largura: number, altura: number): Buffer {
  const buffer = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, // marcador descartado (image-size pula os 4 primeiros bytes)
    0x00, 0x02, // "comprimento" do segmento seguinte: 2 (só os 2 bytes do próprio campo)
    0xff, 0xc0, // marcador SOF0
    0x00, 0x11, // comprimento do segmento SOF (não lido pelo parser)
    0x08, // precisão
    0x00, 0x00, // altura (preenchido abaixo)
    0x00, 0x00, // largura (preenchido abaixo)
  ]);
  buffer.writeUInt16BE(altura, 11);
  buffer.writeUInt16BE(largura, 13);
  return buffer;
}

/** RIFF/WEBP/VP8X (canvas estendido) — largura/altura em 24 bits, little-endian, menos um. */
export function construirWebp(largura: number, altura: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "latin1");
  buffer.write("WEBP", 8, "latin1");
  buffer.write("VP8X", 12, "latin1");
  buffer[20] = 0x00; // flags: bits 7/6/0 precisam ser 0
  buffer.writeUIntLE(largura - 1, 24, 3);
  buffer.writeUIntLE(altura - 1, 27, 3);
  return buffer;
}
