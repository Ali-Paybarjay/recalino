// No "use client": it always lives inside a client screen that owns the value.
import { type KeyboardEvent, type ReactNode, useId, useMemo, useRef, useState } from "react";
import { Check, MagnifyingGlass, XCircle } from "../icons";
import { shellStrings as strings } from "../strings-shell";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import styles from "./ListPicker.module.css";

export type PickerOption = {
  id: string;
  /** What the row shows, e.g. "Persian — فارسی". */
  label: ReactNode;
  /** Lower-case words the search matches, e.g. "persian فارسی fa". */
  search: string;
  /** Shown at the end of the row, e.g. the Experimental badge. */
  badge?: ReactNode;
};

type ListPickerProps = {
  label: string;
  placeholder: string;
  options: readonly PickerOption[];
  value: string | null;
  onChange: (id: string) => void;
  emptyText: string;
};

/**
 * Search field with a list that is always open (frame A2-1; ARIA 1.2 combobox). The search
 * matches English and native names. Arrow keys move, Enter chooses, the chosen row shows a check.
 * While there is text, a clear button empties the field and returns focus to it (frame A2-1b).
 */
export function ListPicker({
  label,
  placeholder,
  options,
  value,
  onChange,
  emptyText,
}: ListPickerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (id: string) => `${listId}-${encodeURIComponent(id)}`;

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase();
    return words === "" ? options : options.filter((option) => option.search.includes(words));
  }, [options, query]);
  // Options can arrive after hydration or shrink independently of the search query.
  // Always reference an option from this render, rather than an obsolete numeric position.
  const activeIndex = visible.length > 0 ? Math.min(Math.max(active, 0), visible.length - 1) : -1;
  const activeOption = visible[activeIndex];

  const choose = (index: number) => {
    const option = visible[index];
    if (option) onChange(option.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(Math.max(activeIndex + step, 0), Math.max(visible.length - 1, 0));
      setActive(next);
      // The language list scrolls independently; keep its keyboard option visible.
      const option = visible[next];
      if (option)
        document.getElementById(optionId(option.id))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  return (
    <div className={styles.picker}>
      <div className={styles.search}>
        <Icon icon={MagnifyingGlass} size={18} className={styles.searchIcon} />
        <input
          type="search"
          role="combobox"
          aria-label={label}
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeOption ? optionId(activeOption.id) : undefined}
          aria-autocomplete="list"
          ref={inputRef}
          placeholder={placeholder}
          value={query}
          dir="auto"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={styles.input}
        />
        {query === "" ? null : (
          <IconButton
            icon={XCircle}
            label={strings.common.clearSearch}
            className={styles.clear}
            onClick={() => {
              setQuery("");
              setActive(0);
              inputRef.current?.focus();
            }}
          />
        )}
      </div>
      <div id={listId} role="listbox" aria-label={label} className={styles.list}>
        {visible.map((option, index) => {
          const selected = option.id === value;
          return (
            // Options are reached through the search field (aria-activedescendant), which handles
            // the keys, so they are neither focusable nor keyed themselves.
            // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
            // biome-ignore lint/a11y/useFocusableInteractive: see above.
            <div
              key={option.id}
              id={optionId(option.id)}
              role="option"
              aria-selected={selected}
              data-active={index === activeIndex || undefined}
              className={styles.option}
              onClick={() => onChange(option.id)}
              onMouseMove={() => setActive(index)}
            >
              <span className={styles.label}>{option.label}</span>
              {option.badge}
              {selected ? <Icon icon={Check} size={20} className={styles.check} /> : null}
            </div>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <p role="status" className={styles.empty}>
          {emptyText}
        </p>
      ) : null}
    </div>
  );
}
