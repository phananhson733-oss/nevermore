// @input  -- the tags of published dramas, the tag in the link, the page locale, and the field's look from the page
// @output -- the 标签 filter as a text box: what is typed is the filter (the store matches any part of a tag, in any case), and a list under it shows the tags that contain what is typed, the matching part in bold, picked by click or by arrow keys and Enter
// @pos    -- the 标签 field of the /tasks filter bar, inside its GET form
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useId, useMemo, useState } from "react";

import { taskCopy } from "../../lib/task-center/copy.ts";

/** More than this and the list only gets longer to scroll; typing narrows it anyway. */
const MAX_SHOWN = 100;

export function TagCombobox({
  locale,
  tags,
  defaultValue,
  className,
}: {
  locale: string;
  tags: readonly string[];
  defaultValue: string;
  className: string;
}) {
  const copy = taskCopy(locale);
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // The same rule the store applies: any part of a tag, in any case.
  const needle = value.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? tags.filter((tag) => tag.toLowerCase().includes(needle)) : tags).slice(0, MAX_SHOWN),
    [tags, needle],
  );
  const showList = open && (matches.length > 0 || needle !== "");

  const pick = (tag: string) => {
    setValue(tag);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative">
      <input
        type="search"
        name="tag"
        value={value}
        placeholder={copy.tagPlaceholder}
        className={className}
        maxLength={100}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (matches.length === 0) return;
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current) => (current + step + matches.length) % matches.length);
          } else if (event.key === "Enter" && showList && active >= 0 && matches[active] !== undefined) {
            // Enter on a highlighted tag picks it; otherwise Enter submits the form as typed.
            event.preventDefault();
            pick(matches[active]);
          } else if (event.key === "Escape" && showList) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-[10px] border border-brand-border-strong bg-brand-panel py-1 text-[14px] shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-text-dark-secondary">{copy.tagNoMatch}</li>
          ) : (
            matches.map((tag, index) => (
              <li
                key={tag}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // mousedown, not click: picking must happen before the input's blur closes the list.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(tag);
                }}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer truncate px-3 py-2 text-text-dark-primary ${
                  index === active ? "bg-brand-panel-raised" : ""
                }`}
              >
                <Highlighted text={tag} needle={needle} />
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** The tag with the first place it contains what was typed in bold. */
function Highlighted({ text, needle }: { text: string; needle: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-semibold text-brand-accent">{text.slice(at, at + needle.length)}</strong>
      {text.slice(at + needle.length)}
    </>
  );
}
