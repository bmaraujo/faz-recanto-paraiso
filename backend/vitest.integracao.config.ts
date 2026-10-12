import { defineConfig } from "vitest/config";

// Config separada da de unidade (vitest.config.ts): roda só test/integracao/,
// contra o DynamoDB Local (npm run test:integracao). Sem portão de cobertura —
// quem mede domain/ é a suíte de unidade, que não toca I/O.
export default defineConfig({
  test: {
    include: ["test/integracao/**/*.test.ts"],
    env: {
      DYNAMODB_ENDPOINT: "http://localhost:8000",
      AWS_REGION: "sa-east-1",
      AWS_ACCESS_KEY_ID: "local",
      AWS_SECRET_ACCESS_KEY: "local",
    },
  },
});
