import assert from "node:assert/strict";
import { tenantHostname } from "./tenant_delivery.ts";

assert.equal(tenantHostname("creator-hub"), "creator-hub.example.test");
assert.throws(() => tenantHostname("Creator Hub"), /lowercase slug/);
console.log("tenant hostname decision: passed");
