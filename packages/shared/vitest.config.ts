import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // O portao de 95% mede so dominio/ (docs/03-tecnico/14-estrategia-de-testes.md,
      // item 3). schemas/ e declarativo (zod), testado em schemas.test.ts, mas sem
      // branch logico proprio para o limiar fazer sentido.
      include: ["src/dominio/**/*.ts"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
