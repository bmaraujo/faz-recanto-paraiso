import { defineConfig } from "vitest/config";

// Sem portão de cobertura: quem mede isso é backend/domain e packages/shared.
// Aqui o teste é sobre o template sintetizado (aws-cdk-lib/assertions), não sobre
// lógica de negócio.
export default defineConfig({
  // 20s: desde que `stack-backend` existe, `sintetizar()` faz hash de ~8 MB de
  // bundle das Lambdas (`Code.fromAsset`) a cada chamada — mais lento que
  // sintetizar só `dados`/`auth`/`frontend`, mas ainda síncrono e local.
  test: { include: ["test/**/*.test.ts"], testTimeout: 20_000 },
});
