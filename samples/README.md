# SecureDesignStudio sample models

These synthetic `.tma` files are designed for testing both deterministic
**Analyze** rules and the model-aware **Design Assistant**. Every file opens on
an intentionally risky scenario and also contains a secure baseline scenario
for comparison. No customer or production data is included.

| Sample | Primary risks to explore |
|---|---|
| `customer-profile-service.tma` | EU PII export, unauthenticated analytics, missing ownership and retention |
| `payment-processing.tma` | Unsigned provider callbacks, spoofing, replay, payment-data boundary crossings |
| `ai-document-assistant.tma` | Prompt/content logging, prompt injection, tenant disclosure, retention |
| `healthcare-data-exchange.tma` | Regulated health data, partner trust, shared credentials, unauthenticated results |
| `multi-tenant-saas-platform.tma` | Cross-tenant disclosure, confused deputy, privileged export, missing constraints |

## Try Analyze

1. Open a sample through **File > Open**.
2. Confirm the scenario selector is on the risky scenario.
3. Select **Analyze**.
4. Review generated issues such as missing retention, empty edge data, or
   missing production identity. Inventory IDs are optional in core; additional
   ownership requirements apply only when explicitly provided by a selected library.
5. Switch to the secure scenario and run Analyze again.

## Try Design Assistant

Useful questions include:

- Summarize this scenario and identify its trust boundaries.
- Which unauthenticated or weakly authenticated flows cross boundaries?
- Where does personal or customer data leave its intended boundary?
- What STRIDE threats affect the risky flow?
- Which controls distinguish the secure and risky scenarios?
- Recommend mitigations and identify the affected nodes and flows.

Design Assistant can focus returned model references and convert accepted
findings into issues or work items.
