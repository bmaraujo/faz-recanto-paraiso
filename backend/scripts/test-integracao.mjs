// Sobe o DynamoDB Local (docker-compose.yml na raiz), espera aceitar conexao,
// roda os testes de integracao, e derruba o container sempre no final - mesmo se
// os testes falharem. Ver docs/03-tecnico/14-estrategia-de-testes.md.
import { spawnSync } from "node:child_process";

const COMPOSE = ["compose", "-f", "../docker-compose.yml"];
const ENDPOINT = "http://localhost:8000";
const TIMEOUT_MS = 30_000;

function docker(...args) {
  return spawnSync("docker", [...COMPOSE, ...args], { stdio: "inherit" });
}

async function esperarDynamoDbLocal() {
  const comecouEm = Date.now();
  while (Date.now() - comecouEm < TIMEOUT_MS) {
    try {
      // DynamoDB Local responde (ainda que com erro de assinatura) a qualquer
      // requisicao HTTP - o que importa aqui e so a porta aceitar conexao.
      await fetch(ENDPOINT);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`DynamoDB Local não respondeu em ${ENDPOINT} após ${TIMEOUT_MS}ms.`);
}

docker("up", "-d");

let codigoSaida = 1;
try {
  await esperarDynamoDbLocal();
  const resultado = spawnSync(
    "npx",
    ["vitest", "run", "--config", "vitest.integracao.config.ts"],
    { stdio: "inherit" },
  );
  codigoSaida = resultado.status ?? 1;
} finally {
  docker("down");
}

process.exit(codigoSaida);
