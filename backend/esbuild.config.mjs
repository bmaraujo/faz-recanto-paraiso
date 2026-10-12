// Bundle de cada Lambda em backend/src/handlers/*.ts para dist/handlers/*.mjs.
//
// Uma entrada por arquivo em handlers/ - e o que o ADR-005/arquitetura preve:
// "um arquivo por Lambda (ponto de entrada fino)". O arm64 e a retencao de log
// sao configurados no construct do CDK (infra/), nao aqui - este script so
// produz o artefato que o CDK vai empacotar.
import { readdirSync } from "node:fs";
import { build } from "esbuild";

const handlersDir = new URL("src/handlers/", import.meta.url);
const entryPoints = readdirSync(handlersDir)
  .filter((arquivo) => arquivo.endsWith(".ts"))
  .map((arquivo) => new URL(arquivo, handlersDir).pathname);

await build({
  entryPoints,
  outdir: "dist/handlers",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  minify: true,
  logLevel: "info",
});
