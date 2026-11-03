import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { checkRouteId, LIBPOD_ROUTES, matchLibpodRoute, routeTarget, type LibpodRouteName } from "../../src/runtime/libpod-routes.js";

// The routes the table held before the scratch volume work (R2). The table adds exactly the four volume routes to these.
const ROUTES_BEFORE_R2: readonly LibpodRouteName[] = [
  "info",
  "listContainers",
  "inspectContainer",
  "stopContainer",
  "removeContainer",
  "createContainer",
  "startContainer",
];
const VOLUME_ROUTES: readonly LibpodRouteName[] = ["createVolume", "inspectVolume", "listVolumes", "removeVolume"];
const API_VERSION = "5.7.1";

function refusedWith(code: ErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof RealmError && error.code === code;
}

void test("R2: the route table holds the routes it held before, plus the four scratch volume routes, and no other", () => {
  assert.deepEqual(Object.keys(LIBPOD_ROUTES).sort(), [...ROUTES_BEFORE_R2, ...VOLUME_ROUTES].sort());
});

void test("R2: each scratch volume route has its method and its provisional path", () => {
  assert.deepEqual(LIBPOD_ROUTES.createVolume, { method: "POST", path: "/libpod/volumes/create" });
  assert.deepEqual(LIBPOD_ROUTES.inspectVolume, { method: "GET", path: "/libpod/volumes/{id}/json" });
  assert.deepEqual(LIBPOD_ROUTES.listVolumes, { method: "GET", path: "/libpod/volumes/json" });
  assert.deepEqual(LIBPOD_ROUTES.removeVolume, { method: "DELETE", path: "/libpod/volumes/{id}" });
});

void test("R2: a volume route is targeted under the API version, with the volume name in its {id} segment", () => {
  assert.equal(routeTarget(LIBPOD_ROUTES.createVolume, undefined, API_VERSION), "/v5.7.1/libpod/volumes/create");
  assert.equal(routeTarget(LIBPOD_ROUTES.inspectVolume, "realm-scratch-a", API_VERSION), "/v5.7.1/libpod/volumes/realm-scratch-a/json");
  assert.equal(routeTarget(LIBPOD_ROUTES.removeVolume, "realm-scratch-a", API_VERSION), "/v5.7.1/libpod/volumes/realm-scratch-a");
  assert.equal(
    routeTarget(LIBPOD_ROUTES.listVolumes, undefined, API_VERSION, { filters: "{}" }),
    "/v5.7.1/libpod/volumes/json?filters=%7B%7D",
  );
});

void test("R2: a volume route refuses a name outside the id pattern, and a route without {id} refuses a name", () => {
  for (const name of ["bad/name", "", "a?b", "-leading"]) {
    assert.throws(() => routeTarget(LIBPOD_ROUTES.inspectVolume, name, API_VERSION), refusedWith("SCHEMA_INVALID"), name);
  }
  assert.throws(() => routeTarget(LIBPOD_ROUTES.createVolume, "realm-scratch-a", API_VERSION), refusedWith("SCHEMA_INVALID"));
  assert.throws(() => {
    checkRouteId(LIBPOD_ROUTES.inspectVolume, undefined);
  }, refusedWith("SCHEMA_INVALID"));
});

void test("R2: a versioned volume path maps back to its route, with the name it carries", () => {
  assert.deepEqual(matchLibpodRoute("GET", "/v5.7.1/libpod/volumes/realm-scratch-a/json"), {
    name: "inspectVolume",
    containerId: "realm-scratch-a",
  });
  assert.deepEqual(matchLibpodRoute("DELETE", "/v5.7.1/libpod/volumes/realm-scratch-a"), {
    name: "removeVolume",
    containerId: "realm-scratch-a",
  });
  assert.deepEqual(matchLibpodRoute("GET", "/v5.7.1/libpod/volumes/json"), { name: "listVolumes", containerId: null });
  assert.deepEqual(matchLibpodRoute("POST", "/v5.7.1/libpod/volumes/create"), { name: "createVolume", containerId: null });
});

void test("R2: a volume path is matched only by its own method, and an unversioned volume path is not matched", () => {
  assert.equal(matchLibpodRoute("POST", "/v5.7.1/libpod/volumes/realm-scratch-a"), undefined);
  assert.equal(matchLibpodRoute("GET", "/v5.7.1/libpod/volumes/realm-scratch-a"), undefined);
  assert.equal(matchLibpodRoute("GET", "/libpod/volumes/realm-scratch-a/json"), undefined);
  assert.equal(matchLibpodRoute("DELETE", "/libpod/volumes/json"), undefined);
});
