// A stand-in for the compute driver's resource lookup. The test holds the resources it provisions, keyed by the gateway's sandbox id,
// and removes or replaces them to model a DeleteSandbox or a replaced resource. An unknown id is undefined, as the driver's lookup is.

import type { ProvisionedResource, ProvisionedResources } from "../../../src/runtime/driver/isolation/boundary.js";

export interface FakeResources extends ProvisionedResources {
  readonly records: Map<string, ProvisionedResource>;
}

export function fakeResources(initial: Readonly<Record<string, ProvisionedResource>> = {}): FakeResources {
  const records = new Map<string, ProvisionedResource>(Object.entries(initial));
  return {
    records,
    provisionedResource(sandboxId: string) {
      return records.get(sandboxId);
    },
  };
}
