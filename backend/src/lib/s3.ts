/**
 * Adaptador S3 — presigned POST de upload de fotos (UC-A03). Único lugar do
 * backend que conhece o `S3Client`, mesma regra de camadas de `lib/db.ts`:
 * `domain/` nunca importa este módulo.
 *
 * O cliente é criado uma vez, em escopo de módulo — mesmo motivo de
 * `clienteDynamoDB` em `lib/db.ts`: reaproveita a conexão entre invocações do
 * mesmo container Lambda.
 */
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

import { TAMANHO_MAX_FOTO_BYTES, formatarInstanteIso } from "@recanto/shared";

export const clienteS3 = new S3Client({});

/** RN/contrato de UC-A03: a policy expira em 5 minutos (E9 — um presigned
 * expirado leva o navegador a pedir um novo automaticamente, uma vez). */
const EXPIRACAO_PRESIGNED_SEGUNDOS = 300;

export function nomeBucket(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.BUCKET;
  if (bucket === undefined) {
    throw new Error("Variável de ambiente BUCKET não definida.");
  }
  return bucket;
}

export interface PresignedPostFoto {
  chave: string;
  url: string;
  campos: Record<string, string>;
  expiraEm: string;
}

/**
 * `POST .../fotos/upload` (UC-A03): devolve a policy assinada que autoriza o
 * navegador a enviar o arquivo direto ao S3, sem passar por esta Lambda.
 *
 * Condições da policy (docs/03-tecnico/07-armazenamento-de-imagens.md):
 * `content-length-range` de 1 B a 3 MB (RN3 — e é a razão de ser **presigned
 * POST, não PUT**: um PUT assinado não suporta esta condição, então um
 * cliente malicioso subiria um arquivo de qualquer tamanho) e `Content-Type`
 * exatamente igual ao declarado. A chave já chega pronta e exata de quem
 * chama (`construirChaveFoto`, `@recanto/shared`) — o `Key` do presigned POST
 * já é, por si só, uma condição de igualdade exata, mais restritiva que um
 * prefixo.
 */
export async function criarPresignedPostFoto(
  chave: string,
  contentType: string,
  agora: Date,
): Promise<PresignedPostFoto> {
  const { url, fields } = await createPresignedPost(clienteS3, {
    Bucket: nomeBucket(),
    Key: chave,
    Conditions: [
      { "Content-Type": contentType },
      ["content-length-range", 1, TAMANHO_MAX_FOTO_BYTES],
    ],
    Fields: { "Content-Type": contentType },
    Expires: EXPIRACAO_PRESIGNED_SEGUNDOS,
  });

  return {
    chave,
    url,
    campos: fields,
    expiraEm: formatarInstanteIso(new Date(agora.getTime() + EXPIRACAO_PRESIGNED_SEGUNDOS * 1000)),
  };
}
