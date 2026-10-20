/**
 * RN13/RN14 (UC-A03): verificação do conteúdo real de uma foto, sem confiar
 * no `Content-Type` declarado pelo cliente nem nas dimensões informadas.
 * Pura — recebe os bytes já lidos por `lib/s3.ts`, nunca lê nada sozinha, e
 * por isso é testável com buffers reais, sem mock e sem S3 (mesmo critério
 * de todo `domain/`). Diferente de `domain/casas.ts`/`domain/precos.ts`, não
 * é um reexport de `@recanto/shared`: esta verificação é só do backend, o
 * site nunca precisa dela.
 */
import type { TipoFotoAceito } from "@recanto/shared";
import { imageSize } from "image-size";

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * RN13: confere a magic number dos bytes iniciais do objeto. Detecta o
 * formato **real** do arquivo, sem depender do `Content-Type` que o S3
 * devolve (esse vem do que foi declarado no presigned POST — não é prova de
 * nada). `undefined` quando os bytes não casam com nenhum dos três formatos
 * aceitos (RN2) — o chamador decide o que fazer (hoje: `400 ARQUIVO_INVALIDO`
 * e apaga o objeto).
 */
export function detectarTipoPorMagicNumber(bytes: Buffer): TipoFotoAceito | undefined {
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(ASSINATURA_PNG)) {
    return "image/png";
  }
  return undefined;
}

/**
 * RN14: extrai largura/altura do próprio cabeçalho da imagem — nunca do que
 * o cliente informou. Usa a biblioteca `image-size` (zero dependências, só
 * lê metadados do cabeçalho, nunca decodifica pixel) em vez de reimplementar
 * à mão o desempacotamento de bits do WebP (VP8/VP8L/VP8X têm três
 * codificações de dimensão diferentes) ou o scanner de marcadores do JPEG —
 * o tipo de lógica fácil de acertar no caso feliz e sutil de errar nas
 * bordas. `undefined` em qualquer falha (formato não reconhecido, cabeçalho
 * incompleto) — o chamador trata como arquivo inválido, nunca deixa a
 * exceção escapar.
 */
export function extrairDimensoes(bytes: Buffer): { largura: number; altura: number } | undefined {
  try {
    const resultado = imageSize(bytes);
    if (
      typeof resultado.width !== "number" ||
      typeof resultado.height !== "number" ||
      resultado.width <= 0 ||
      resultado.height <= 0
    ) {
      return undefined;
    }
    return { largura: resultado.width, altura: resultado.height };
  } catch {
    return undefined;
  }
}
