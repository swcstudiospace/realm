// ACP over the process stdio (TOOL-05, G-03). The protocol lives in src/acp/agent.ts; this entry only
// names the stdio streams the CLI passes. It holds no tool logic (P5-D11) and no protocol logic.

import type { ToolDispatcher } from "../tools/dispatch.js";
import { runAcpAgent } from "./agent.js";

// Speaks ACP over the given streams until stdin closes. stdout carries protocol frames only; diagnostics
// go to stderr. The promise resolves when stdin ends.
export async function runAcpOverStdio(options: {
  readonly dispatcher: Pick<ToolDispatcher, "call">;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
}): Promise<void> {
  await runAcpAgent({ dispatcher: options.dispatcher, input: options.stdin, output: options.stdout });
}
