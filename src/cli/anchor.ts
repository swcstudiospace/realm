// realm anchor (H1): prints, or with --publish sends, the Merkle root of one session's audit log. The default is a
// dry run that makes no network call. Publishing needs the key file (the CLI entry edge passes it in), refuses
// any endpoint whose genesis hash is not devnet's, and sends only the anchor record: never audit content.

import { Buffer } from "node:buffer";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AnchorError,
  buildAnchorRecord,
  DEVNET_GENESIS_HASH,
  encodeMemo,
  loadAnchorKey,
  publishAnchor,
  splitAuditLines,
  type AnchorRecord,
  type AnchorRpc,
} from "../audit/anchor.js";
import { isSessionId } from "../session/paths.js";

export const DEFAULT_ANCHOR_RPC_URL = "https://api.devnet.solana.com";

export interface AnchorArgs {
  readonly sessionId: string;
  readonly publish: boolean;
  readonly rpcUrl: string | undefined;
}

export interface AnchorRunDeps {
  readonly stateDir: string;
  readonly keyFile: string | undefined;
  readonly createRpc: (url: string) => AnchorRpc;
  readonly now: () => Date;
}

export interface AnchorRunResult {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

// Accepts --session <id> (required), --publish (flag) and --rpc <url>, each at most once, in any order.
export function parseAnchorArgs(args: readonly string[]): AnchorArgs | undefined {
  let sessionId: string | undefined;
  let publish = false;
  let rpcUrl: string | undefined;
  let index = 0;
  while (index < args.length) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--publish" && !publish) {
      publish = true;
      index += 1;
    } else if (flag === "--session" && sessionId === undefined && value !== undefined) {
      sessionId = value;
      index += 2;
    } else if (flag === "--rpc" && rpcUrl === undefined && value !== undefined) {
      rpcUrl = value;
      index += 2;
    } else {
      return undefined;
    }
  }
  if (sessionId === undefined || !isSessionId(sessionId)) {
    return undefined;
  }
  return { sessionId, publish, rpcUrl };
}

// Reads the session's audit log and builds its anchor record. A missing or empty log is an AnchorError.
function recordOfAuditLog(sessionId: string, stateDir: string, now: Date): { record: AnchorRecord; memo: string } {
  const file = join(stateDir, "audit", `${sessionId}.jsonl`);
  if (!existsSync(file)) {
    throw new AnchorError(`no audit log exists for session ${sessionId}`);
  }
  if (!lstatSync(file).isFile()) {
    throw new AnchorError(`audit log for session ${sessionId} is not a regular file`);
  }
  const lines = splitAuditLines(readFileSync(file));
  if (lines.length === 0) {
    throw new AnchorError(`audit log for session ${sessionId} has no lines`);
  }
  const record = buildAnchorRecord({ sessionId, lines, createdAt: now });
  return { record, memo: encodeMemo(record) };
}

export async function runAnchor(args: AnchorArgs, deps: AnchorRunDeps): Promise<AnchorRunResult> {
  try {
    const { record, memo } = recordOfAuditLog(args.sessionId, deps.stateDir, deps.now());
    if (!args.publish) {
      const out = { mode: "dry-run", record, memo, memoBytes: Buffer.byteLength(memo, "utf8") };
      return { exitCode: 0, stdout: `${JSON.stringify(out)}\n`, stderr: "" };
    }
    if (deps.keyFile === undefined) {
      throw new AnchorError("REALM_ANCHOR_KEY_FILE is not set; --publish needs the anchor key file");
    }
    const signer = loadAnchorKey({ keyFile: deps.keyFile, stateDir: deps.stateDir });
    const rpc = deps.createRpc(args.rpcUrl ?? DEFAULT_ANCHOR_RPC_URL);
    const { signature } = await publishAnchor({
      rpc,
      signer,
      record,
      expectedGenesisHash: DEVNET_GENESIS_HASH,
    });
    const out = {
      mode: "published",
      cluster: "devnet",
      signature,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      record,
    };
    return { exitCode: 0, stdout: `${JSON.stringify(out)}\n`, stderr: "" };
  } catch (error) {
    if (error instanceof AnchorError) {
      return { exitCode: 1, stdout: "", stderr: `realm anchor: ${error.message}\n` };
    }
    throw error;
  }
}
