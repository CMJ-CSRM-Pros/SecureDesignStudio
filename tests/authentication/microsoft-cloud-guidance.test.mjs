import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";

const { resolveLibraries } = await import("../../src/libraries/registry.ts");
const { validateAiDesignGuidance } = await import("../../shared/aiDesignGuidance.ts");
const core = resolveLibraries([]);
const byId = new Map(core.nodes.map(type => [type.id, type.definition]));
const withheld = ["azure.compute.vm-infra", "azure.network.network-security", "azure.network.route"];

test("Microsoft cloud catalog: approved AI-guidance set is complete and owner-withheld IDs stay blank", () => {
  const entries = [...byId].filter(([, definition]) => definition.aiDesignGuidance);
  const ids = entries.map(([id]) => id).sort();
  assert.equal(ids.length, 166);
  assert.equal(createHash("sha256").update(ids.join("\n")).digest("hex"),
    "46b71f81d800c5e6547a5a54361a311e58d63be10af9caa4fa518c259318670a");
  for (const id of withheld) assert.equal(byId.get(id)?.aiDesignGuidance, undefined, `${id} remains withheld`);
  for (const [id, definition] of entries) {
    const guidance = definition.aiDesignGuidance;
    assert.deepEqual(validateAiDesignGuidance(guidance), guidance, id);
    assert.ok(guidance.content.length <= 1600, id);
    for (const heading of ["Context", "Dependencies", "Risks", "Uncertainty"]) {
      assert.ok(guidance.content.includes(`${heading}\n`), `${id} has ${heading}`);
    }
    assert.ok(guidance.sources.length, `${id} cites supporting material`);
    for (const source of guidance.sources) {
      assert.equal(new URL(source).protocol, "https:", `${id}: ${source}`);
      assert.match(new URL(source).hostname, /(^|\.)microsoft\.com$/i, `${id}: ${source}`);
    }
  }
});

test("Microsoft cloud catalog: approved WAF, Delivery and Azure Files boundaries match providers and guidance", () => {
  const waf = byId.get("azure.security.waf");
  assert.deepEqual(waf.resourceProviders, [
    "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies",
    "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies",
    "Microsoft.Cdn/cdnWebApplicationFirewallPolicies",
  ]);
  assert.match(waf.aiDesignGuidance.content, /Internet-facing HTTP\/HTTPS applications and APIs should be protected/);
  assert.match(waf.aiDesignGuidance.content, /Azure Front Door.*Application Gateway.*Application Gateway for Containers/s);

  const delivery = byId.get("azure.network.delivery");
  assert.deepEqual(delivery.resourceProviders, [
    "Microsoft.Cdn/profiles",
    "Microsoft.Cdn/profiles/endpoints",
    "Microsoft.Cdn/profiles/afdEndpoints",
    "Microsoft.Network/frontDoors",
  ]);
  assert.match(delivery.aiDesignGuidance.content, /Azure Front Door and legacy Azure CDN only/);
  assert.match(delivery.aiDesignGuidance.content, /does not represent Traffic Manager, Azure Load Balancer or standalone public IP resources/);

  const files = byId.get("azure.storage.file-share");
  assert.deepEqual(files.resourceProviders, [
    "Microsoft.Storage/storageAccounts/fileServices/shares",
    "Microsoft.FileShares/fileShares",
  ]);
  assert.match(files.aiDesignGuidance.content, /classic.*standalone/s);
  assert.match(files.aiDesignGuidance.content, /NFS.*premium SSD.*provisioned-v2.*LRS or ZRS/s);
});

test("Microsoft cloud catalog: selected Enclave and Managed Redis meanings remain variant-aware", () => {
  const enclave = byId.get("azure.network.azure-enclave").aiDesignGuidance.content;
  assert.match(enclave, /managed deployment\/composite/);
  assert.match(enclave, /Bastion is optional/);
  assert.match(enclave, /does not verify/);

  const redis = byId.get("azure.databases.managed-redis").aiDesignGuidance.content;
  assert.match(redis, /customer-operated Redis and the legacy Azure Cache for Redis service/);
  assert.match(redis, /Microsoft.Cache\/RedisEnterprise/);
  assert.match(redis, /do not infer compatibility, migration status or lifecycle equivalence/);
});
