// Provisional libpod route table (D-48, D-54, podman.md Q5). No libpod route is verified
// against a documentation page, so every method, path, query name, and response field in
// this file is PROVISIONAL. The gated integration suite confirms them on a Podman 5.x host
// (S-09). They live in this file only, so a correction touches one place.
//
// The table holds the routes the closed libpod client uses: the read, stop, and remove routes, and the
// create and container-start routes of the lifecycle. It defines no exec or attach route and no route
// that starts a process inside a container (RT-03). Agent workload code starts only through the
// OpenShell adapter.

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
  createContainer: route("POST", "/libpod/containers/create"),
  startContainer: route("POST", "/libpod/containers/{id}/start"),
});

export type LibpodRouteName = keyof typeof LIBPOD_ROUTES;

// Provisional response fields. A missing field is a contract violation, never a default.
export const LIBPOD_INFO_ROOTLESS_PATH: readonly string[] = Object.freeze(["host", "security", "rootless"]);
export const LIBPOD_INFO_VERSION_PATH: readonly string[] = Object.freeze(["version", "Version"]);
export const LIBPOD_LIST_ID_FIELD = "Id";

// Container ids are validated before they reach a path. The pattern admits only
// characters that need no escaping, so a caller cannot add a path segment or a query.
export const CONTAINER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

// Podman serves libpod only under a versioned path, /v<api-version>/libpod/..., and answers an
// unversioned libpod path with 404. The version is the one /_ping reports in its Libpod-Api-Version header.
export const PING_PATH = "/_ping";
export const LIBPOD_API_VERSION_HEADER = "libpod-api-version";
export const API_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const VERSIONED_PATH = /^\/v\d+\.\d+\.\d+(\/.*)$/;

// Checks the container id a route needs: present and well formed where the route has an {id}, and absent
// where it has none. It runs before any socket request, so a malformed id never reaches the socket.
export function checkRouteId(target: LibpodRoute, containerId: string | undefined): void {
  if (target.path.includes("{id}")) {
    if (containerId === undefined || !CONTAINER_ID_PATTERN.test(containerId)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  } else if (containerId !== undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The request target (path plus query string) for a route under an API version. Rejects a container id
// that the route does not accept, and an API version that is not a plain version number.
export function routeTarget(
  target: LibpodRoute,
  containerId: string | undefined,
  apiVersion: string,
  query: Readonly<Record<string, string>> = {},
): string {
  checkRouteId(target, containerId);
  if (!API_VERSION_PATTERN.test(apiVersion)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const libpodPath = containerId === undefined ? target.path : target.path.replace("{id}", containerId);
  const path = `/v${apiVersion}${libpodPath}`;
  const search = new URLSearchParams(query).toString();
  return search === "" ? path : `${path}?${search}`;
}

export interface MatchedRoute {
  readonly name: LibpodRouteName;
  readonly containerId: string | null;
}

// Maps an incoming method and path back to a route name. Only a versioned path matches, so the fake
// server refuses an unversioned libpod path as Podman does. The fake shares this one route table with the client.
export function matchLibpodRoute(method: string, pathname: string): MatchedRoute | undefined {
  const libpodPath = VERSIONED_PATH.exec(pathname)?.[1];
  if (libpodPath === undefined) {
    return undefined;
  }
  for (const name of Object.keys(LIBPOD_ROUTES) as LibpodRouteName[]) {
    const target = LIBPOD_ROUTES[name];
    if (target.method !== method) {
      continue;
    }
    if (!target.path.includes("{id}")) {
      if (target.path === libpodPath) {
        return { name, containerId: null };
      }
      continue;
    }
    const [prefix = "", suffix = ""] = target.path.split("{id}");
    if (!libpodPath.startsWith(prefix) || !libpodPath.endsWith(suffix)) {
      continue;
    }
    const id = libpodPath.slice(prefix.length, libpodPath.length - suffix.length);
    if (CONTAINER_ID_PATTERN.test(id)) {
      return { name, containerId: id };
    }
  }
  return undefined;
}
