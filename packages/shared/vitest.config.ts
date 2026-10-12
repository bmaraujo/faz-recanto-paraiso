import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/dominio/**/*.ts"],
      // Portao de qualidade: docs/03-tecnico/14-estrategia-de-testes.md
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
