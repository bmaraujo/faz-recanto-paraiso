// Regra de arquitetura do backend (docs/03-tecnico/01-arquitetura.md):
//
//   handlers/  →  domain/ + lib/
//   domain/    não importa lib/ nem o AWS SDK
//
// É a única regra de dependência do projeto. Fica verificada aqui em vez de só
// por disciplina, porque é exatamente o tipo de erosão que passa despercebida
// num projeto pequeno sem revisor (docs/03-tecnico/14-estrategia-de-testes.md).
import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // Convenção do pacote: variável/parâmetro prefixado com `_` é descartado de
      // propósito (ex.: desestruturar um campo só para testar a ausência dele).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      // NBSP e outros espaços "irregulares" aparecem de propósito em comentário
      // de teste, para documentar o caractere exato que o Intl usa (ex.:
      // packages/shared/test/formato.test.ts). Em string/código continua proibido.
      "no-irregular-whitespace": ["error", { skipComments: true }],
    },
  },
  {
    files: ["backend/src/**/*.ts"],
    plugins: { import: importPlugin },
    settings: {
      // Sem isto, o resolver padrao do eslint-plugin-import nao entende import
      // sem extensao apontando para .ts, e a regra abaixo falha em silencio
      // (nao resolve o módulo -> não casa a zona -> nenhum erro, nenhum aviso).
      "import/resolver": { typescript: { project: "./backend/tsconfig.json" } },
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./backend/src/domain",
              from: "./backend/src/lib",
              message: "domain/ não importa lib/ (docs/03-tecnico/01-arquitetura.md).",
            },
            {
              target: "./backend/src/domain",
              from: "**/node_modules/@aws-sdk/**",
              message: "domain/ não importa o AWS SDK (docs/03-tecnico/01-arquitetura.md).",
            },
          ],
        },
      ],
      // Log sem console.log fora de lib/log.ts (docs/03-tecnico/01-arquitetura.md).
      // lib/log.ts ainda não existe (ver backend/README.md); quando nascer, ganha
      // sua própria exceção aqui via "overrides" por arquivo.
      "no-console": "error",
    },
  },
);
