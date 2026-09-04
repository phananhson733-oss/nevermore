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
- the current Product Profile readout beneath the generation controls;
- the frozen Product Profile description, business fields, and edit link;
- the confirmed Profile revision or Profile hash;
- the Brand and measurement scope panel;
- the Competitor identity panel, including capture results and disclosures;
- the Roles and review record panel;
- the Declared facts and evidence actually admitted panel;
- the Source summary panel or its evidence/receipt disclosures;
- the Version identity panel or any candidate, schema, registry, method, or
  content hash values within it.

These values must be absent from the DOM and accessibility tree. CSS hiding,
collapsed disclosures, dialogs, and alternate tabs do not satisfy the
requirement.

The frozen view continues to render the complete question set. Product Profile
data remains available in the separate Product Profile module and remains part
of the frozen record, but it is not repeated inside the GEO panel.

## Architecture

Keep the V2 payload, question set, snapshot context, wire format, persistence,
and server routes unchanged. The V2 host no longer mounts its duplicate current
Profile readout. The frozen host selects a customer-facing rendering mode on the
existing read-only version component; that mode omits the frozen Profile copy
and the six internal panels. The top-level frozen summary component is removed
from the V2 host rather than moved into another disclosure.

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
identity, Profile readouts, Profile hash, edit link, or internal detail
selectors. The same test must prove that every frozen question remains visible.

After the smallest rendering change, run focused component tests, directly
related GEO Knowledge Base tests, scoped type and lint checks, documentation
verification, and the Marketing production build. No commit, push, deployment,
database migration, provider call, or production mutation is authorized by this
request.
