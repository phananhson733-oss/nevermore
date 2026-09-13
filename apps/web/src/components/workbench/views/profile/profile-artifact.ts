import {
  profileContextPrompt,
  profileDocMarkdown,
  profileJson,
} from "@/lib/workbench/mock/builders/profile";
import type { ArtifactType, Profile, ProfileDoc } from "@/lib/workbench/types";
import type { ArtifactDraft } from "../../hooks/useAddArtifact.ts";

/**
 * The three output tabs and what each hands to `useAddArtifact` (plan Task 9
 * Step 4; research §3.3; jsx:1204-1208).
 *
 * The body is the mock-layer builder's output, unstamped (Q23): the pane shows
 * it and the actions stamp it once. Every builder reads the snapshot's own
 * `gscSource` (Q6), so nothing here passes a provenance of its own — a second
 * argument would be a second, possibly contradicting, answer.
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
}

const TAB_META: Readonly<Record<ProfileTab, TabMeta>> = {
  doc: { type: "md", filename: "product-profile.md" },
  json: { type: "json", filename: "profile.json" },
  ctx: { type: "prompt" },
};

/** The text a tab shows, which is also the body its artifact is stamped from. */
export function profileArtifactBody(tab: ProfileTab, profile: Profile, doc: ProfileDoc): string {
  switch (tab) {
    case "doc":
      return profileDocMarkdown({ profile, doc });
    case "json":
      return profileJson({ profile, ai: doc.ai });
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
  const { type, filename } = TAB_META[tab];
  const base = {
    module: "profile",
    type,
    engine: "both",
    title,
    body: profileArtifactBody(tab, profile, doc),
  } as const;
  return filename === undefined ? base : { ...base, filename };
}
