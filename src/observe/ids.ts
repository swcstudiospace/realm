// Correlation ids (OBS-02). One fresh id per control request that does work; the id is
// carried in log lines and audit lines so a call can be joined across both.

import { randomUUID } from "node:crypto";

const CORRELATION_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]{1,64}$/;

export const newCorrelationId = (): string => randomUUID();

export function isCorrelationId(value: unknown): value is string {
  return typeof value === "string" && CORRELATION_ID_PATTERN.test(value);
}
