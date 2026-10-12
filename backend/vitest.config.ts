import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Mesmo criterio de packages/shared: o portao de 95% mede domain/ (regra
      // pura reexportada de @recanto/shared). handlers/ e lib/ fazem I/O e parsing
      // de requisicao - cobertos por teste, mas sem o mesmo limiar.
      include: ["src/domain/**/*.ts"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
