"use client";

import { ChevronDown, CircleHelp } from "lucide-react";
import { useId, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from "react";

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
export function Field({ label, hint, error, wide, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={wide ? "field wide" : "field"}>
      <span className="field-label-row">
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

/**
 * A styled native `<select>`, deliberately not a custom popover listbox.
 *
 * A hand-built dropdown means re-implementing roving focus, type-ahead, screen reader
 * announcements, touch behaviour and the mobile picker, and getting any of those subtly wrong is
 * worse for the person using it than a native control that already does all of them. The chevron
 * and the focus ring are ours; the behaviour is the platform's.
 */
export function SelectField({
  label,
  hint,
  error,
  wide,
  options,
  placeholder,
  ...select
}: Omit<FieldProps, "children"> & {
  options: readonly Option[];
  /** Shown as a non-selectable first entry when there is no sensible default. */
  placeholder?: string | undefined;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} {...(hint ? { hint } : {})} {...(error ? { error } : {})} {...(wide ? { wide } : {})}>
      {({ id, describedBy }) => (
        <div className="select-shell">
          <select id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...select}>
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
          {/* Decorative: the select already announces itself as a listbox. */}
          <ChevronDown size={16} aria-hidden="true" />
        </div>
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
