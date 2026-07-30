// @input  -- GlossaryTerm[] from parent page
// @output -- A-Z alphabet navigation sidebar
// @pos    -- glossary index page sidebar, sticky on desktop, horizontal on mobile
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import type { GlossaryTerm } from "@/lib/glossary";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface GlossarySidebarProps {
  readonly terms: ReadonlyArray<GlossaryTerm>;
}

export function GlossarySidebar({ terms }: GlossarySidebarProps) {
  const activeLetters = new Set(
    terms.map((t) => t.term.charAt(0).toUpperCase()),
  );

  return (
    <nav
      aria-label="Alphabet navigation"
      className="shrink-0 md:sticky md:top-28 md:self-start"
    >
      {/* Desktop: vertical sidebar */}
      <div className="hidden md:flex flex-col gap-1 w-8">
        {ALPHABET.map((letter) => {
          const isActive = activeLetters.has(letter);
          return (
            <a
              key={letter}
              href={isActive ? `#letter-${letter}` : undefined}
              className={`w-8 h-8 flex items-center justify-center rounded text-[13px] font-medium transition-colors ${
                isActive
                  ? "text-text-dark-primary hover:bg-brand-accent/20 hover:text-brand-accent cursor-pointer"
                  : "text-text-dark-secondary/30 cursor-default"
              }`}
              aria-disabled={!isActive}
              tabIndex={isActive ? 0 : -1}
            >
              {letter}
            </a>
          );
        })}
      </div>

      {/* Mobile: horizontal scroll */}
      <div className="md:hidden flex gap-1 overflow-x-auto pb-4 mb-6 -mx-6 px-6 scrollbar-hide">
        {ALPHABET.map((letter) => {
          const isActive = activeLetters.has(letter);
          return (
            <a
              key={letter}
              href={isActive ? `#letter-${letter}` : undefined}
              className={`shrink-0 w-8 h-8 flex items-center justify-center rounded text-[13px] font-medium transition-colors ${
                isActive
                  ? "text-text-dark-primary hover:bg-brand-accent/20 hover:text-brand-accent cursor-pointer"
                  : "text-text-dark-secondary/30 cursor-default"
              }`}
              aria-disabled={!isActive}
              tabIndex={isActive ? 0 : -1}
            >
              {letter}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
