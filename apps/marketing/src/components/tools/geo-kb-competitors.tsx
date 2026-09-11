"use client";
// @input  -- the competitor rows of one v3 draft's locked input, and the coordinates a gesture about them must name
// @output -- one row per rival with its name, where the name came from and whether it is confirmed; the lookup, confirm, rename and withdraw gestures
// @pos    -- the only surface that changes the locked half of a draft outside a re-lock; it holds lookup answers for the session and writes through the competitor route
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Why this block exists, and why it sits above the knowledge sections.
 *
 * The comparisons module was `not_applicable` on every knowledge base ever
 * updated: `competitorsFromProfile` writes every rival `confirmed: false` and
 * nothing offered the owner a way to say otherwise, so no run fetched a
 * competitor page and nothing was compared. These rows are that gesture.
 *
 * They are an input to the next update, not a part of what the last one
 * produced, which is why they are framed above section A rather than filed
 * beside the comparisons they feed -- and why they are drawn on a draft that
 * has no knowledge yet, which is the best moment to confirm a rival: before
 * the first billed update, not after it.
 *
 * A lookup is a proposal. It reads the rival's own homepage through the same
 * gated reader the run uses and shows what that page calls itself; it writes
 * nothing. Only "confirm" writes, and it writes the name on screen at the
 * moment it is pressed -- read, edited or typed. The rows themselves are
 * drawn from the props: a save's answer goes to the parent, which redraws the
 * draft, so this block never holds a second copy of what the server stores.
 */
import { useId, useState, type ReactNode } from "react";

import type { GeoGenerationInputV3 } from "../../lib/geo-tools/kb-v3-contract.ts";
import { Button } from "../ui/button.tsx";
import { GeoKbSectionFrame } from "./geo-kb-card.tsx";
import { useGeoKbCopy, type GeoKbCopy } from "./geo-kb-copy.ts";
import { GeoKbChip } from "./geo-kb-item-row.tsx";
import type { GeoKbCompetitorIdentityV3, GeoKbCompetitorsSaveV3 } from "./geo-kb-v3-wire.ts";
import {
  lookupGeoKbV3Competitor,
  writeGeoKbV3Competitor,
  type GeoKbV3CompetitorGestureWire,
} from "./use-geo-kb-v3-editor.ts";

type Competitor = GeoGenerationInputV3["competitors"][number];

export interface GeoKbCompetitorsProps {
  readonly kbId: string;
  readonly competitors: readonly Competitor[];
  /** The draft version and locked input the rows were drawn under; every write names both. */
  readonly baseVersion: number;
  readonly generationInputHash: string;
  /** The card has a reason no gesture may land right now: a run is open, a save is in flight. */
  readonly disabled: boolean;
  readonly onSaved: (saved: GeoKbCompetitorsSaveV3) => void;
}

type Busy = { readonly domain: string; readonly kind: "lookup" | "write" };
type Editing = { readonly domain: string; readonly name: string };
type Failure = { readonly domain: string; readonly text: string };

/** What a row shows as its name and aliases: the lookup's proposal while unconfirmed, the stored answer once confirmed. */
function proposed(row: Competitor, identity: GeoKbCompetitorIdentityV3 | undefined): { readonly name: string; readonly aliases: readonly string[] } {
  if (!row.confirmed && identity?.status === "available") return { name: identity.brandName, aliases: identity.aliases };
  return { name: row.brandName, aliases: row.aliases ?? [] };
}

function Note({ children, ...rest }: { readonly children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return <div
    {...rest}
    data-knowledge-copy="compact"
    className="min-w-0 whitespace-pre-wrap break-words rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-3 text-[13px] leading-relaxed text-text-dark-secondary [overflow-wrap:anywhere]"
  >{children}</div>;
}

function Meta({ parts }: { readonly parts: readonly string[] }) {
  return <>{parts.map((part, index) => <span key={index} className="min-w-0 break-words [overflow-wrap:anywhere]">{index === 0 ? "" : " · "}{part}</span>)}</>;
}

/** The source line: the host, then where the name on the row came from. */
function sourceParts(row: Competitor, identity: GeoKbCompetitorIdentityV3 | undefined, copy: GeoKbCopy["competitors"]): readonly string[] {
  if (row.domain === "") return [copy.noDomain];
  if (identity === undefined) return [row.domain, copy.fromProfile];
  if (identity.status === "unavailable") return [row.domain, copy.lookupFailed(copy.reason(identity.reason))];
  return [row.domain, copy.readFrom(identity.sourceUrl), ...(identity.method === null ? [] : [copy.method[identity.method]])];
}

function NameField({ value, onChange, label, invalid, describedBy }: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly invalid: boolean;
  readonly describedBy: string | null;
}) {
  return <label className="block min-w-0 flex-1 basis-64 space-y-1">
    <span className="block text-[12px] text-text-dark-secondary">{label}</span>
    <input
      type="text"
      data-competitor-name-input=""
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid ? true : undefined}
      {...(describedBy === null ? {} : { "aria-describedby": describedBy })}
      className="block w-full rounded-[8px] border border-brand-border-card bg-brand-bg px-3 py-2 text-[13px] leading-relaxed text-text-dark-primary"
    />
  </label>;
}

function Row({ row, identity, editing, busy, failure, held, copy, on }: {
  readonly row: Competitor;
  readonly identity: GeoKbCompetitorIdentityV3 | undefined;
  readonly editing: Editing | null;
  readonly busy: Busy | null;
  readonly failure: Failure | null;
  /** Every button on every row: the card said so, or a gesture is in flight. */
  readonly held: boolean;
  readonly copy: GeoKbCopy["competitors"];
  readonly on: {
    readonly lookup: () => void;
    readonly confirm: () => void;
    readonly rename: () => void;
    readonly unconfirm: () => void;
    readonly edit: (name: string) => void;
    readonly save: () => void;
    readonly cancel: () => void;
  };
}) {
  const errorId = useId();
  const shown = proposed(row, identity);
  const editable = row.domain !== "";
  const error = failure?.domain === row.domain ? failure.text : null;
  const lookingUp = busy?.domain === row.domain && busy.kind === "lookup";
  const writing = busy?.domain === row.domain && busy.kind === "write";
  const button = (kind: string, label: string, onClick: () => void, extra: Record<string, unknown> = {}) => (
    <Button type="button" variant="outline" size="sm" data-competitor-action={kind} disabled={held} onClick={onClick} {...extra}>{label}</Button>
  );
  return <article
    data-geo-kb-competitor=""
    data-domain={row.domain}
    data-confirmed={row.confirmed ? "true" : "false"}
    className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5"
  >
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1 basis-64 space-y-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
          <GeoKbChip data-item-type="">{copy.typeLabel}</GeoKbChip>
          {editing === null
            ? <div data-competitor-name="" className="min-w-0 flex-1 break-words text-[13px] leading-relaxed text-text-dark-primary [overflow-wrap:anywhere]">
              {shown.name === "" ? copy.unnamed : shown.name}
            </div>
            : <NameField value={editing.name} onChange={on.edit} label={copy.nameLabel} invalid={error !== null} describedBy={error === null ? null : errorId} />}
        </div>
        <div data-competitor-source="" className="min-w-0 text-[12px] leading-relaxed text-text-dark-secondary">
          <Meta parts={sourceParts(row, identity, copy)} />
        </div>
        {shown.aliases.length === 0 ? null : <div data-competitor-aliases="" className="min-w-0 break-words text-[12px] leading-relaxed text-text-dark-secondary [overflow-wrap:anywhere]">
          {copy.aliases(shown.aliases.join(", "))}
        </div>}
        {error === null ? null : <p id={errorId} role="alert" data-competitor-error="" className="min-w-0 text-[12px] leading-relaxed text-brand-error">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <GeoKbChip data-competitor-chip="">{row.confirmed ? copy.confirmed : copy.unconfirmed}</GeoKbChip>
        {!editable ? null
          : editing !== null ? <>
            {button("save", writing ? copy.saving : copy.save, on.save)}
            {button("cancel", copy.cancel, on.cancel)}
          </>
            : row.confirmed ? <>
              {button("rename", copy.rename, on.rename)}
              {button("unconfirm", writing ? copy.saving : copy.unconfirm, on.unconfirm)}
            </>
              : <>
                {button("lookup", lookingUp ? copy.lookupBusy : copy.lookup, on.lookup)}
                {button("confirm", writing ? copy.saving : copy.confirm, on.confirm)}
              </>}
      </div>
    </div>
  </article>;
}

export function GeoKbCompetitors({ kbId, competitors, baseVersion, generationInputHash, disabled, onSaved }: GeoKbCompetitorsProps) {
  const copy = useGeoKbCopy().competitors;
  const [identities, setIdentities] = useState<Readonly<Record<string, GeoKbCompetitorIdentityV3>>>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const held = disabled || busy !== null;
  const confirmedCount = competitors.filter((row) => row.confirmed).length;

  async function lookup(domain: string): Promise<void> {
    if (held) return;
    setBusy({ domain, kind: "lookup" });
    setFailure(null);
    try {
      const result = await lookupGeoKbV3Competitor({ kbId, domain });
      if (result.ok) setIdentities((current) => ({ ...current, [domain]: result.identity }));
      else setFailure({ domain, text: copy.failed(result.code) });
    } finally {
      setBusy(null);
    }
  }

  async function write(domain: string, gesture: GeoKbV3CompetitorGestureWire): Promise<void> {
    if (held) return;
    setBusy({ domain, kind: "write" });
    setFailure(null);
    try {
      const result = await writeGeoKbV3Competitor({ kbId, baseVersion, expectedGenerationInputHash: generationInputHash, gesture });
      if (!result.ok) {
        setFailure({ domain, text: copy.failed(result.code) });
        return;
      }
      setEditing((current) => (current?.domain === domain ? null : current));
      onSaved(result.saved);
    } finally {
      setBusy(null);
    }
  }

  function confirm(row: Competitor): void {
    const shown = proposed(row, identities[row.domain]);
    // No name to confirm: ask for one rather than refuse. The contract holds
    // a confirmed rival only under a name, and a rival whose page could not
    // be read is exactly the one the owner has to name by hand.
    if (shown.name.trim() === "") {
      setFailure(null);
      setEditing({ domain: row.domain, name: "" });
      return;
    }
    void write(row.domain, { kind: "confirm", domain: row.domain, brandName: shown.name, aliases: shown.aliases });
  }

  function save(row: Competitor): void {
    if (editing === null || editing.domain !== row.domain) return;
    const name = editing.name.trim();
    if (name === "") {
      setFailure({ domain: row.domain, text: copy.nameRequired });
      return;
    }
    void write(row.domain, { kind: "confirm", domain: row.domain, brandName: name, aliases: proposed(row, identities[row.domain]).aliases });
  }

  return <GeoKbSectionFrame name="competitors" title={copy.title} items={copy.items(confirmedCount, competitors.length)}>
    <div data-geo-kb-competitors="" className="min-w-0 space-y-4">
      {competitors.length === 0
        ? <Note data-competitors-empty="">{copy.empty}</Note>
        : competitors.map((row, index) => <Row
          key={row.domain === "" ? `brand:${row.brandName}:${index}` : `domain:${row.domain}`}
          row={row}
          identity={identities[row.domain]}
          editing={editing?.domain === row.domain ? editing : null}
          busy={busy}
          failure={failure}
          held={held}
          copy={copy}
          on={{
            lookup: () => void lookup(row.domain),
            confirm: () => confirm(row),
            rename: () => { setFailure(null); setEditing({ domain: row.domain, name: row.brandName }); },
            unconfirm: () => void write(row.domain, { kind: "unconfirm", domain: row.domain }),
            edit: (name) => setEditing((current) => (current?.domain === row.domain ? { domain: row.domain, name } : current)),
            save: () => save(row),
            cancel: () => { setFailure(null); setEditing(null); },
          }}
        />)}
    </div>
  </GeoKbSectionFrame>;
}
