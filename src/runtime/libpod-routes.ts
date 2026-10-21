// Provisional libpod route table (D-48, D-54, podman.md Q5). No libpod route is verified
// against a documentation page, so every method, path, query name, and response field in
// this file is PROVISIONAL. The gated integration suite confirms them on a Podman 5.x host
// (S-09). They live in this file only, so a correction touches one place.
//
// The table holds exactly the five routes the closed libpod client uses. It defines no
// route that starts or joins a process inside a container (RT-03). Agent
// workload code starts only through the OpenShell adapter.

import { makeRealmError } from "../core/errors.js";

export type LibpodMethod = "GET" | "POST" | "DELETE";

export interface LibpodRoute {
  readonly method: LibpodMethod;
  // Path template. The single "{id}" segment is a validated container id.
  readonly path: string;
}

function route(method: LibpodMethod, path: string): LibpodRoute {
  return Object.freeze({ method, path });
}

export const LIBPOD_ROUTES = Object.freeze({
  info: route("GET", "/libpod/info"),
  listContainers: route("GET", "/libpod/containers/json"),
  inspectContainer: route("GET", "/libpod/containers/{id}/json"),
  stopContainer: route("POST", "/libpod/containers/{id}/stop"),
  removeContainer: route("DELETE", "/libpod/containers/{id}"),
});

export type LibpodRouteName = keyof typeof LIBPOD_ROUTES;

// Provisional response fields. A missing field is a contract violation, never a default.
export const LIBPOD_INFO_ROOTLESS_PATH: readonly string[] = Object.freeze(["host", "security", "rootless"]);
export const LIBPOD_INFO_VERSION_PATH: readonly string[] = Object.freeze(["version", "Version"]);
export const LIBPOD_LIST_ID_FIELD = "Id";

// Container ids are validated before they reach a path. The pattern admits only
// characters that need no escaping, so a caller cannot add a path segment or a query.
export const CONTAINER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

// The request target (path plus query string) for a route. Rejects a container id that
// is missing where the route needs one, present where it does not, or malformed.
export function routeTarget(
  target: LibpodRoute,
  containerId: string | undefined,
  query: Readonly<Record<string, string>> = {},
): string {
  let path: string = target.path;
  if (path.includes("{id}")) {
    if (containerId === undefined || !CONTAINER_ID_PATTERN.test(containerId)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    path = path.replace("{id}", containerId);
  } else if (containerId !== undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const search = new URLSearchParams(query).toString();
  return search === "" ? path : `${path}?${search}`;
}

export interface MatchedRoute {
  readonly name: LibpodRouteName;
  readonly containerId: string | null;
}

// Maps an incoming method and path back to a route name. Used by the fake server so it
// shares the one route table with the client.
export function matchLibpodRoute(method: string, pathname: string): MatchedRoute | undefined {
  for (const name of Object.keys(LIBPOD_ROUTES) as LibpodRouteName[]) {
    const target = LIBPOD_ROUTES[name];
    if (target.method !== method) {
      continue;
    }
    if (!target.path.includes("{id}")) {
      if (target.path === pathname) {
        return { name, containerId: null };
      }
      continue;
    }
    const [prefix = "", suffix = ""] = target.path.split("{id}");
    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
      continue;
    }
    const id = pathname.slice(prefix.length, pathname.length - suffix.length);
    if (CONTAINER_ID_PATTERN.test(id)) {
      return { name, containerId: id };
    }
  }
  return undefined;
}
