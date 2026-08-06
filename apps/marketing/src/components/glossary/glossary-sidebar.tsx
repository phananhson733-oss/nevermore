// @input  -- GlossaryTerm[] from parent page
// @output -- A-Z alphabet navigation sidebar
// @pos    -- glossary index page sidebar, sticky on desktop, horizontal on mobile
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import type { GlossaryTerm } from "@/lib/glossary";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// 字母导航按「过滤 pill」配方：有词条的字母是可点 chip，无词条的只留最淡的 mono 字。
const LETTER_BASE =
  "flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] transition-colors";
const LETTER_ACTIVE =
  "cursor-pointer border border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/50 hover:text-brand-accent-text";
// 全量 faint，不再叠 /50：叠上去只有 1.75:1，等于把「哪些字母有词条」这个唯一
// 信号抹掉。可点性本来就靠 active 那档的描边表达，不靠把无效字母调到看不见。
const LETTER_INACTIVE = "cursor-default text-text-dark-faint";

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
      className="shrink-0 md:sticky md:top-[84px] md:self-start"
    >
      {/* Desktop: vertical sidebar */}
      <div className="hidden w-8 flex-col gap-1.5 md:flex">
        {ALPHABET.map((letter) => {
          const isActive = activeLetters.has(letter);
          return (
            <a
              key={letter}
              href={isActive ? `#letter-${letter}` : undefined}
              className={`${LETTER_BASE} ${
                isActive ? LETTER_ACTIVE : LETTER_INACTIVE
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
      <div className="scrollbar-hide -mx-6 mb-6 flex gap-1.5 overflow-x-auto px-6 pb-4 md:hidden">
        {ALPHABET.map((letter) => {
          const isActive = activeLetters.has(letter);
          return (
            <a
              key={letter}
              href={isActive ? `#letter-${letter}` : undefined}
              className={`${LETTER_BASE} ${
                isActive ? LETTER_ACTIVE : LETTER_INACTIVE
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
