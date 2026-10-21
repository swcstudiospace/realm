// AppInformation shape handshake (ANDA-02, D-61). Hand-written: no schema file and
// no ajv use (D-73). Imports core only (D-50).
//
// Anda documents no protocol or engine version on any route (docs/integration/anda.md
// Q4). This check therefore verifies the shape of the body returned by
// GET /.well-known/information. It is NOT a version check. It stays a shape
// handshake until Anda publishes a version surface (OQ-P3-09); a pass must never be
// reported as a version match.
//
// Rules: the body must be a JSON object. `engines` must be an array,
// `default_engine` a string or null, and `start_time_ms` a non-negative integer.
// Missing or mistyped fields fail closed. Extra fields are ignored.
//
// Privacy rule (src/contract/validate.ts): a failure detail names the field, never
// its value, because a value may be sensitive.

import { makeRealmError, type RealmError } from "../core/errors.js";

export interface AppInformationShape {
  readonly engines: readonly unknown[];
  readonly default_engine: string | null;
  readonly start_time_ms: number;
}

export interface AppInformationOk {
  readonly ok: true;
  readonly value: AppInformationShape;
}

export interface AppInformationFailure {
  readonly ok: false;
  readonly error: RealmError;
  readonly detail: string;
}

export type AppInformationCheck = AppInformationOk | AppInformationFailure;

function mismatch(detail: string): AppInformationFailure {
  return { ok: false, error: makeRealmError("ANDA_VERSION_MISMATCH"), detail };
}

export function checkAppInformationShape(body: unknown): AppInformationCheck {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mismatch("AppInformation body must be a JSON object");
  }
  const { engines, default_engine, start_time_ms } = body as Record<string, unknown>;
  if (!Array.isArray(engines)) {
    return mismatch("AppInformation field engines must be an array");
  }
  if (default_engine !== null && typeof default_engine !== "string") {
    return mismatch("AppInformation field default_engine must be a string or null");
  }
  if (typeof start_time_ms !== "number" || !Number.isInteger(start_time_ms) || start_time_ms < 0) {
    return mismatch("AppInformation field start_time_ms must be a non-negative integer");
  }
  return { ok: true, value: { engines, default_engine, start_time_ms } };
}
