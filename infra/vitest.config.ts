import { defineConfig } from "vitest/config";

// Sem portão de cobertura: quem mede isso é backend/domain e packages/shared.
// Aqui o teste é sobre o template sintetizado (aws-cdk-lib/assertions), não sobre
// lógica de negócio.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
