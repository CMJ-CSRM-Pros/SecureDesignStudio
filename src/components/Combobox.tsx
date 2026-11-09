import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboboxOption {
  // Stable value emitted to the parent on selection.
  value: string;
  // User-facing text shown in the dropdown and the input.
  label: string;
  iconUrl?: string;
  category?: string;
}

interface ComboboxProps {
  // The currently-selected value. Used to resolve the label shown in the
  // input when the user isn't actively typing.
  value: string;
  options: ComboboxOption[];
  placeholder?: string;
  // Called when the user picks an option (by click or Enter on a highlight)
  // OR when free-text matches an option's label exactly.
  onSelect: (value: string) => void;
  // Called when the user commits free text that doesn't match any option's
  // label. Should create the new entry and return the new value to select;
  // returning undefined leaves the selection unchanged.
  onCreate?: (label: string) => string | undefined;
}

// A select-styled input that lets the user pick from `options` (by label)
// or type a brand-new entry that gets promoted via `onCreate`. The text in
// the input always represents the *label*; `value`/onSelect deal in the
// option's stable `value` (e.g. an id), so labels can be renamed without
// breaking references held elsewhere.
export function Combobox({
  value,
  options,
  placeholder,
  onSelect,
  onCreate,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = useMemo(() => {
    const match = options.find((o) => o.value === value);
    return match ? match.label : value;
  }, [options, value]);

  // `text` is what the user sees / types in the input. Re-sync when either
  // the selected id changes or that id's catalog label is renamed.
  const [text, setText] = useState(selectedLabel);
  const lastSyncedValue = useRef(value);
  const lastSyncedLabel = useRef(selectedLabel);
  useEffect(() => {
    if (
      lastSyncedValue.current !== value ||
      lastSyncedLabel.current !== selectedLabel
    ) {
      lastSyncedValue.current = value;
      lastSyncedLabel.current = selectedLabel;
      setText(selectedLabel);
    }
  }, [value, selectedLabel]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const owner = rootRef.current?.ownerDocument ?? document;
    owner.addEventListener("mousedown", onDown);
    return () => owner.removeEventListener("mousedown", onDown);
  }, [open]);

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.label.localeCompare(b.label)),
    [options]
  );
  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return sortedOptions;
    return sortedOptions.filter((o) =>
      [o.label, o.category]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(q)),
    );
  }, [sortedOptions, text]);

  useEffect(() => {
    setHighlight(filtered.length > 0 ? 0 : -1);
  }, [filtered, open]);

  const commit = (label: string) => {
    const trimmed = label.trim();
    // Empty input — leave selection alone, snap input back to current label.
    if (!trimmed) {
      setText(selectedLabel);
      setOpen(false);
      return;
    }
    const match = options.find(
      (o) => o.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (match) {
      onSelect(match.value);
      setText(match.label);
      setOpen(false);
      return;
    }
    if (onCreate) {
      const created = onCreate(trimmed);
      if (created !== undefined) {
        onSelect(created);
        // Caller may canonicalize the label (e.g., trim/dedupe) — fall back
        // to what the user typed if the new option hasn't propagated yet.
        const next = options.find((o) => o.value === created);
        setText(next ? next.label : trimmed);
        setOpen(false);
        return;
      }
    }
    // No match and no creator — revert.
    setText(selectedLabel);
    setOpen(false);
  };

  const commitOption = (opt: ComboboxOption) => {
    onSelect(opt.value);
    setText(opt.label);
    setOpen(false);
  };

  return (
    <div className="ps-combobox" ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        className="ps-combobox-input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          // Defer so a click on a menu option can fire first.
          window.setTimeout(() => commit(text), 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) =>
              filtered.length === 0 ? -1 : (h + 1) % filtered.length
            );
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) =>
              filtered.length === 0
                ? -1
                : (h - 1 + filtered.length) % filtered.length
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && highlight >= 0 && filtered[highlight] != null) {
              commitOption(filtered[highlight]);
            } else {
              commit(text);
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setText(selectedLabel);
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="ps-combobox-toggle"
        aria-label="Toggle options"
        tabIndex={-1}
        onMouseDown={(e) => {
          // Prevent input blur so the menu toggle is a single click.
          e.preventDefault();
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
      >
        ▾
      </button>
      {open && filtered.length > 0 && (
        <ul className="ps-combobox-menu" role="listbox">
          {filtered.map((o, idx) => (
            <li
              key={o.value}
              role="option"
              aria-selected={idx === highlight}
              className={`ps-combobox-option${
                idx === highlight ? " is-highlighted" : ""
              }`}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => {
                // Prevent input blur from firing before the click commits.
                e.preventDefault();
                commitOption(o);
              }}
            >
              {o.iconUrl && (
                <img
                  className="ps-combobox-option-icon"
                  src={o.iconUrl}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              )}
              <span className="ps-combobox-option-content">
                <span>{o.label}</span>
                {o.category && (
                  <span className="ps-combobox-option-category">
                    {o.category}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
