/**
 * docs/03-tecnico/12-infraestrutura-cdk.md#testes-de-infraestrutura: "Template não
 * muda sem intenção." Uma mudança real no template deve aparecer como diff
 * explícito na revisão (`vitest run -u` para aceitar de propósito), não passar
 * silenciosa.
 */
import type { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, it, expect } from "vitest";

import { sintetizar } from "./apoio.js";

/**
 * `CDKMetadata` e `BootstrapVersion` mudam com a versão do CDK CLI, não com uma
 * decisão nossa — mantê-los no snapshot faria todo bump de versão parecer uma
 * mudança de infraestrutura.
 */
function templateEstavel(stack: Stack): unknown {
  const json = Template.fromStack(stack).toJSON() as {
    Resources: Record<string, unknown>;
    Parameters?: Record<string, unknown>;
    Rules?: unknown;
  };
  delete json.Resources.CDKMetadata;
  delete json.Parameters?.BootstrapVersion;
  delete json.Rules;
  return json;
}

describe.each(["dev", "prod"] as const)("stage %s", (stage) => {
  const { dados, auth, frontend } = sintetizar(stage);

  it("stack dados", () => {
    expect(templateEstavel(dados)).toMatchSnapshot();
  });

  it("stack auth", () => {
    expect(templateEstavel(auth)).toMatchSnapshot();
  });

  it("stack frontend", () => {
    expect(templateEstavel(frontend)).toMatchSnapshot();
  });
});
