/**
 * Erro HTTP estruturado — docs/03-tecnico/01-arquitetura.md ("camadas do backend":
 * `lib/erros.ts`, erros de domínio → status HTTP + código).
 *
 * Pensado para quem lança (`lib/auth.ts`, e futuramente outros adaptadores de I/O)
 * não precisar conhecer `respostaErro`/o formato de `APIGatewayProxyStructuredResultV2`
 * — só o handler, no catch, sabe transformar isto numa resposta HTTP.
 */
export class ErroHttp extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly codigo: string,
    mensagem: string,
    public readonly detalhes: Record<string, unknown> = {},
  ) {
    super(mensagem);
    this.name = "ErroHttp";
  }
}
