# GEO Knowledge Base Frozen View Pruning Design

## Goal

Remove customer-irrelevant provenance and version identity from the GEO
Knowledge Base frozen view. The information remains part of the frozen record
for server validation, generation, measurement, and audit purposes, but none of
it is rendered to the customer, including behind expandable controls.

## Customer-visible contract

The V2 frozen view must not render any of the following:

- the frozen revision/count/time summary;
- the expandable frozen snapshot identity;
- the confirmed Profile revision or Profile hash;
- the Brand and measurement scope panel;
- the Roles and review record panel;
- the Declared facts and evidence actually admitted panel;
- the Source summary panel or its evidence/receipt disclosures;
- the Version identity panel or any candidate, schema, registry, method, or
  content hash values within it.

These values must be absent from the DOM and accessibility tree. CSS hiding,
collapsed disclosures, dialogs, and alternate tabs do not satisfy the
requirement.

The frozen view continues to render the customer-useful content:

- Product Profile business fields, without the Profile revision/hash identity;
- competitor identity;
- the complete question set.

## Architecture

Keep the V2 payload, question set, snapshot context, wire format, persistence,
and server routes unchanged. The frozen host selects a customer-facing rendering
mode on the existing read-only version component. That mode omits the five
internal panels and tells the shared Profile readout not to render its archival
revision/hash block. The top-level frozen summary component is removed from the
V2 host rather than moved into another disclosure.

The complete mode remains the default for the shared read-only component so a
future internal or candidate reviewer can still render the provenance-rich
view.

## Error and state behavior

This change introduces no requests, state transitions, error handling, or data
mutation. Empty, legacy, generation-running, and generation-failure states keep
their existing behavior. Only an existing V2 frozen record uses the pruned
customer presentation.

## Verification

Tests must first fail against the current implementation by asserting that the
production frozen host does not contain the listed headings, summary, snapshot
identity, Profile hash, or internal detail selectors. The same test must prove
that Profile business content, competitors, and questions remain visible.

After the smallest rendering change, run focused component tests, directly
related GEO Knowledge Base tests, scoped type and lint checks, documentation
verification, and the Marketing production build. No commit, push, deployment,
database migration, provider call, or production mutation is authorized by this
request.
