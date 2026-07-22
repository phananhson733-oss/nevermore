const PROJECT_SECTION_DESTINATIONS = new Map<string, string>([
  ["overview", "overview"],
  ["context", "context"],
  ["sources", "sources"],
  ["growth-map", "growth-map"],
  ["execution", "execution"],
  ["results", "results"],
  ["diagnosis", "growth-map"],
  ["plan", "execution"],
  ["studio", "execution"],
  ["report", "results"],
]);

function currentSection(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean)[2];
  return segment
    ? (PROJECT_SECTION_DESTINATIONS.get(segment) ?? "overview")
    : "overview";
}

/** Preserve the canonical equivalent of the current section across projects. */
export function projectSwitchHref(pathname: string, projectId: string): string {
  return `/p/${projectId}/${currentSection(pathname)}`;
}
