# scripts — Deploy, seed e manutenção

| Script | Função |
|---|---|
| `deploy-site.sh` | Build do Astro + `s3 sync` + invalidação do CloudFront |
| `smoke.ts` | Smoke test pós-deploy (10 verificações) |
| `invariantes.ts` | Verifica as invariantes I1–I9 no banco (só leitura) |
| `seed-dev.ts` | Popula o `dev` com casas e reservas fictícias |
| `criar-admin.sh` | Cria o usuário admin no Cognito |
| `criar-segredos.sh` | Cria os parâmetros `SecureString` no SSM |

## ⚠ `deploy-site.sh`

Os `--exclude "midia/*"` e `--exclude "_dados/*"` no `aws s3 sync --delete` são
**obrigatórios**. Sem eles, o comando **apaga todas as fotos das casas**, que não estão
versionadas no S3.

Ver [docs/04-operacao/01-ambientes-e-deploy.md](../docs/04-operacao/01-ambientes-e-deploy.md).
