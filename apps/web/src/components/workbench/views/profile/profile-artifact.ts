import {
  profileContextPrompt,
  profileDocMarkdown,
  profileJson,
} from "@/lib/workbench/mock/builders/profile";
import { artifactGscData } from "@/lib/workbench/mock/provenance";
import type { ArtifactType, Profile, ProfileDoc } from "@/lib/workbench/types";
import type { ArtifactDraft } from "../../hooks/useAddArtifact.ts";

/**
 * The three output tabs and what each hands to `useAddArtifact` (plan Task 9
 * Step 4; research §3.3; jsx:1204-1208).
 *
 * The body is the mock-layer builder's output, unstamped (Q23): the pane shows
 * it and the actions stamp it once. The builders whose body carries GSC-derived
 * content (the Markdown document and the AI context) read the snapshot's own
 * `gscSource` (Q6), so nothing here passes a provenance of its own — a second
 * argument would be a second, possibly contradicting, answer. The JSON builder
 * reads no GSC data at all, and its declaration is always `none` (below).
 *
 * Each tab's provenance declaration speaks for its own body (Q36): a tab whose
 * body carries GSC-derived content maps the snapshot's frozen `gscSource`,
 * never the project's current `gscRowsSource`, so rows imported after
 * generation cannot relabel a profile already written; a tab whose body
 * carries none is `none`, whatever the snapshot holds.
 *
 * `module: "profile"`, `engine: "both"` (the prototype's `""`, R2). File names
 * are the prototype's; the drawer forces the extension from `type` anyway.
 */

export type ProfileTab = "doc" | "json" | "ctx";

export const PROFILE_TABS: readonly ProfileTab[] = ["doc", "json", "ctx"];

export function isProfileTab(id: string): id is ProfileTab {
  return (PROFILE_TABS as readonly string[]).includes(id);
}

interface TabMeta {
  readonly type: ArtifactType;
  readonly filename?: string;
  /**
   * Whether the body carries GSC-derived content when the snapshot has GSC
   * signals (Q36). `doc`: the search section's counts, which `gscSection` prints
   * only for a non-null `doc.gsc`. `ctx`: the context data's `search` object,
   * which `contextData` builds from `doc.gsc` only when it is not null. `json`:
   * `profileJson` holds the profile's own fields and the AI document, and the AI
   * document (`demoAiDoc(profile)`) takes no GSC input, so never.
   */
  readonly carriesGsc: boolean;
}

const TAB_META: Readonly<Record<ProfileTab, TabMeta>> = {
  doc: { type: "md", filename: "product-profile.md", carriesGsc: true },
  json: { type: "json", filename: "profile.json", carriesGsc: false },
  ctx: { type: "prompt", carriesGsc: true },
};

/** The text a tab shows, which is also the body its artifact is stamped from. */
export function profileArtifactBody(tab: ProfileTab, profile: Profile, doc: ProfileDoc): string {
  switch (tab) {
    case "doc":
      return profileDocMarkdown({ profile, doc });
    case "json":
      return profileJson({ profile, ai: doc.ai, snapshotAt: doc.at });
    case "ctx":
      return profileContextPrompt({ profile, doc });
  }
}

export function profileArtifactDraft(
  tab: ProfileTab,
  profile: Profile,
  doc: ProfileDoc,
  title: string,
): ArtifactDraft {
  const { type, filename, carriesGsc } = TAB_META[tab];
  const base = {
    module: "profile",
    type,
    engine: "both",
    title,
    body: profileArtifactBody(tab, profile, doc),
    gscData: artifactGscData(carriesGsc && doc.gsc !== null, doc.gscSource),
  } as const;
  return filename === undefined ? base : { ...base, filename };
}
