"use client";

import { Check, ChevronDown, CircleHelp } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes
} from "react";

/**
 * The form primitives every operational screen shares.
 *
 * They exist so a label, a hint and an error always sit in the same place and are always wired to
 * their control. Before this, each screen laid out its own `<label>` with the input nested inside,
 * which reads fine but leaves the hint unassociated: a screen reader announced the field without
 * ever reaching the text that explains what to type.
 */

// `| undefined` on every optional prop: the repository compiles with `exactOptionalPropertyTypes`,
// so a caller passing a value that may be absent would not type without it.
type FieldProps = {
  label: string;
  /** Explains the expected input. Wired with aria-describedby, not merely placed nearby. */
  hint?: string | undefined;
  error?: string | undefined;
  /** Spans the full width of a grid form. For notes and descriptions. */
  wide?: boolean | undefined;
  /**
   * Keeps the label for screen readers but not on screen. For a control that sits under a heading
   * already saying the same words, where showing it twice is noise for whoever can see it and
   * dropping it leaves an unnamed control for whoever cannot.
   */
  labelHidden?: boolean | undefined;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
};

/**
 * The hint is a `?` beside the label, not a line of text under the control.
 *
 * A sentence under every field costs a row of height per field and pushes the controls out of line
 * with each other, which is what made the forms look noisy. The same affordance the data tables
 * already use shows it on hover and on focus, and `aria-describedby` still points at it so it is
 * announced with the control rather than only shown to whoever can see the tooltip.
 */
export function Field({ label, hint, error, wide, labelHidden, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={wide ? "field wide" : "field"}>
      <span className={labelHidden && !hint ? "sr-only" : "field-label-row"}>
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {hint && (
          // Named with the hint alone, not `label: hint`. Prefixing it with the field name gave two
          // things in the form the same accessible name, so anything looking for the field by name
          // found the icon as well — a screen reader reads it as a second control, and the test that
          // caught it was only the first thing to trip over it.
          <span className="field-help" tabIndex={0} aria-label={hint}>
            <CircleHelp size={13} aria-hidden="true" />
            <span role="tooltip" id={hintId}>
              <strong>{label}</strong>
              {hint}
            </span>
          </span>
        )}
      </span>
      {children({ id, describedBy })}
      {error && (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

type Option = { value: string; label: string; disabled?: boolean };

export function SelectControl({
  options,
  placeholder,
  className,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  name,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...select
}: {
  options: readonly Option[];
  placeholder?: string | undefined;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ""));
  const selectedValue = value === undefined ? internalValue : String(value);
  const selectedOption = options.find((option) => option.value === selectedValue);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue);
    const native = nativeRef.current;
    if (native) {
      native.value = nextValue;
      native.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setOpen(false);
    buttonRef.current?.focus();
  };

  const move = (direction: -1 | 1) => {
    const enabled = options.filter((option) => !option.disabled);
    const current = enabled.findIndex((option) => option.value === selectedValue);
    const next =
      current < 0
        ? direction === 1
          ? 0
          : enabled.length - 1
        : (current + direction + enabled.length) % enabled.length;
    const option = enabled[next];
    if (option) choose(option.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    }
  };

  return (
    <div ref={rootRef} className={["select-shell", open ? "is-open" : "", className].filter(Boolean).join(" ")}>
      <select
        ref={nativeRef}
        className="select-native-proxy"
        name={name}
        value={selectedValue}
        onChange={(event) => {
          if (value === undefined) setInternalValue(event.target.value);
          onChange?.(event);
        }}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        {...select}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option value={option.value} key={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        ref={buttonRef}
        id={controlId}
        className="select-trigger"
        type="button"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-required={required}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className={selectedOption ? "" : "is-placeholder"}>{selectedOption?.label ?? placeholder ?? ""}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="select-dropdown" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === selectedValue}
              disabled={option.disabled}
              key={option.value}
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              {option.value === selectedValue && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A themed listbox backed by a native `<select>` for form submission and change events.
 *
 * The visible layer keeps the same surfaces, focus and selected state in light and dark mode. The
 * proxy preserves existing form contracts while the trigger exposes combobox semantics and the
 * keyboard behaviour expected from a compact select.
 */
export function SelectField({
  label,
  hint,
  error,
  wide,
  labelHidden,
  options,
  placeholder,
  ...select
}: Omit<FieldProps, "children"> & {
  options: readonly Option[];
  /** Shown as a non-selectable first entry when there is no sensible default. */
  placeholder?: string | undefined;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      {...(wide ? { wide } : {})}
      {...(labelHidden ? { labelHidden } : {})}
    >
      {({ id, describedBy }) => (
        <SelectControl
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          options={options}
          {...(placeholder ? { placeholder } : {})}
          {...select}
        />
      )}
    </Field>
  );
}

export function TextField({
  label,
  hint,
  error,
  wide,
  ...input
}: Omit<FieldProps, "children"> & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} {...(hint ? { hint } : {})} {...(error ? { error } : {})} {...(wide ? { wide } : {})}>
      {({ id, describedBy }) => (
        <input id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...input} />
      )}
    </Field>
  );
}

/**
 * A switch-styled checkbox. Still a checkbox underneath, so it is reachable with Tab, toggles with
 * Space and announces its checked state without any ARIA of ours.
 */
export function ToggleField({
  label,
  hint,
  ...input
}: { label: string; hint?: string | undefined } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field toggle-field">
      <input type="checkbox" id={id} aria-describedby={hint ? hintId : undefined} {...input} />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <small className="field-hint" id={hintId}>
          {hint}
        </small>
      )}
    </div>
  );
}
