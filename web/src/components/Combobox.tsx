import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  /** Render hint text on the right side of each option (e.g. current value of a parameter). */
  hint?: (option: string) => string | undefined;
  className?: string;
}

interface Anchor {
  top: number;
  left: number;
  width: number;
}

export function Combobox({ value, onChange, options, placeholder, hint, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [value, options]);

  // Position the floating list relative to the input
  useLayoutEffect(() => {
    if (!open) return;
    const updateAnchor = () => {
      if (!inputRef.current) return;
      const r = inputRef.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    updateAnchor();
    window.addEventListener('scroll', updateAnchor, true);
    window.addEventListener('resize', updateAnchor);
    return () => {
      window.removeEventListener('scroll', updateAnchor, true);
      window.removeEventListener('resize', updateAnchor);
    };
  }, [open]);

  // Close on outside click — listen on both wrapper and the floating list
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open]);

  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0);
  }, [filtered.length, highlighted]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const hasOptions = options.length > 0;
  const showList = open && filtered.length > 0;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        className={hasOptions ? 'input pr-9' : 'input'}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (hasOptions) setOpen(true);
        }}
        onFocus={() => {
          if (hasOptions) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!hasOptions) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && filtered[highlighted]) {
              e.preventDefault();
              select(filtered[highlighted]);
              inputRef.current?.blur();
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Tab') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {hasOptions && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink p-1 transition"
          aria-label="открыть список"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {showList && anchor &&
        createPortal(
          <div
            ref={listRef}
            style={{
              position: 'fixed',
              top: anchor.top,
              left: anchor.left,
              width: anchor.width,
              zIndex: 9999,
            }}
            className="max-h-64 overflow-y-auto bg-card border border-border rounded-md shadow-pop py-1"
          >
            {filtered.map((opt, i) => {
              const sub = hint?.(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(opt)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center justify-between gap-3 ${
                    i === highlighted ? 'bg-flame-tint text-flame' : 'text-ink hover:bg-soft'
                  }`}
                >
                  <span className="truncate">{opt}</span>
                  {sub && (
                    <span className="text-[11px] text-ink-faint shrink-0 truncate max-w-[40%]">
                      {sub}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
