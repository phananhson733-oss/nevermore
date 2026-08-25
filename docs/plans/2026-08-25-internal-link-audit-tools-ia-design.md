# Internal Link Audit Tools IA Design

Date: 2026-08-25

Status: Owner-approved in the current conversation by choosing option 1.

## Goal

Keep Internal Link Audit as a standalone public Tools product without presenting
it as an Agent or mixing a specific tool into the Resources catalogue menu.

## Approved information architecture

- The Agents header submenu contains exactly two products: SEO Agent and GEO
  Agent.
- The Resources header submenu remains a catalogue of Prompts, Tools, Skills,
  and Docs. Its Tools item continues to open `/tools`.
- The Tools hub continues to expose the Internal Link Audit card, which opens
  `/tools/internal-link-audit`.
- The `/agents` hub continues to show SEO Agent and GEO Agent only.
- `/agents/tech` remains the subordinate technical focus and compatibility route
  for SEO Agent. It is not renamed, removed, or redirected by this change.

```text
Agents -> SEO Agent | GEO Agent
Resources -> Tools -> Internal Link Audit
```

## Copy boundary

Remove only `nav.agentsMenu.internalLinkAudit` from English and Chinese message
catalogues because the item no longer exists in the Agents menu. Keep the
Tools-hub copy, `nav.toolsMenu.internalLinkAudit`, related-tool copy, page copy,
and public no-login wording unchanged.

## Non-goals

- Do not add Internal Link Audit as a fifth Resources-menu item.
- Do not promote Tools to a new top-level header destination.
- Do not change the tool page, API, crawler, cache, quota, sitemap, canonical,
  redirect, or authentication behavior.
- Do not change other links that are explicitly labelled Technical focus.
- Do not commit, push, create a PR, deploy, or touch production in this task.

## Acceptance criteria

1. Agents navigation resolves to exactly `/agents/seo` and `/agents/geo`.
2. No Agents-menu item or Agents-menu translation key names Internal Link Audit.
3. Resources navigation remains exactly Prompts, Tools, Skills, and Docs, with
   Tools targeting `/tools`.
4. The browser path is `Resources -> Tools -> Internal Link Audit`, with the
   localized tool link targeting `/zh/tools/internal-link-audit` in Chinese.
5. The standalone tool, Tools hub card, `/agents/tech`, sitemap, and API remain
   covered and unchanged.

