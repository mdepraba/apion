import type { EnvelopeSlot } from '@apion/contracts';
import { FIELD, MUTED } from '../ui.js';

/*
 * A slot field sits inside a panel that is already on `surface-1`, so it takes
 * the deeper `surface-0` rather than the shared input treatment: nesting one
 * raised surface inside another flattens both.
 */
const SLOT_INPUT =
  'w-full rounded-sm border border-line-control bg-surface-0 p-2 text-text disabled:bg-surface-1 disabled:text-text-muted';
const SLOT_JSON = `${SLOT_INPUT} resize-y font-mono text-sm`;

/**
 * One field per slot the project's response standard declares.
 *
 * This is the whole point of the standard being declarative: an author writing
 * an example is asked for `$status_code`, `$message`, `$data` and `$meta`
 * because the project said every response carries them, and the mock then
 * serves exactly that.
 */
export function SlotFields({
  slots,
  values,
  statusCode,
  idPrefix,
  onChange,
  disabled = false,
}: {
  slots: readonly EnvelopeSlot[];
  /** Authored values, keyed by slot token. */
  values: Readonly<Record<string, unknown>>;
  /** Fills `$status_code` when the author has not overridden it. */
  statusCode: number | 'default';
  /** Keeps ids unique when several of these are on one page. */
  idPrefix: string;
  onChange: (token: string, value: unknown) => void;
  disabled?: boolean;
}) {
  if (slots.length === 0) {
    return (
      <p className={MUTED}>
        This project's response standard declares no slots, so an example is
        just the response body.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {slots.map((slot) => {
        const id = `${idPrefix}-${slot.token.slice(1)}`;
        const supplied = slot.token in values;
        const derived = !supplied && isStatusSlot(slot.token);

        return (
          <div key={slot.token} className={FIELD}>
            <label className="flex flex-wrap items-baseline gap-2" htmlFor={id}>
              <code className="font-semibold">{slot.token}</code>
              <span className="text-sm text-text-muted">
                under "{slot.key}"
              </span>
            </label>

            {slot.isData ? (
              <JsonSlot
                id={id}
                rows={6}
                disabled={disabled}
                value={values[slot.token]}
                onChange={(value) => onChange(slot.token, value)}
              />
            ) : isStatusSlot(slot.token) ? (
              <input
                id={id}
                className={SLOT_INPUT}
                type="number"
                disabled={disabled}
                placeholder={
                  typeof statusCode === 'number' ? String(statusCode) : ''
                }
                value={supplied ? String(values[slot.token] ?? '') : ''}
                onChange={(event) =>
                  onChange(
                    slot.token,
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                  )
                }
              />
            ) : isTextSlot(slot.token) ? (
              <input
                id={id}
                className={SLOT_INPUT}
                disabled={disabled}
                value={String(values[slot.token] ?? '')}
                onChange={(event) => onChange(slot.token, event.target.value)}
              />
            ) : (
              <JsonSlot
                id={id}
                rows={3}
                disabled={disabled}
                value={values[slot.token]}
                onChange={(value) => onChange(slot.token, value)}
              />
            )}

            {derived ? (
              <span className={MUTED}>
                Taken from the response status unless you set it here.
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** A slot whose value is JSON rather than a scalar. */
function JsonSlot({
  id,
  rows,
  value,
  disabled,
  onChange,
}: {
  id: string;
  rows: number;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const text = value === undefined ? '' : JSON.stringify(value, null, 2);

  return (
    <textarea
      id={id}
      className={SLOT_JSON}
      rows={rows}
      spellCheck={false}
      disabled={disabled}
      defaultValue={text}
      placeholder="null"
      onBlur={(event) => {
        // Parsed on blur, not on keystroke: half-typed JSON is not an error
        // worth interrupting someone mid-word for.
        const raw = event.target.value.trim();
        if (raw === '') {
          onChange(null);
          return;
        }
        try {
          onChange(JSON.parse(raw));
        } catch {
          // Kept as a string so nothing the author typed is thrown away.
          onChange(raw);
        }
      }}
    />
  );
}

function isStatusSlot(token: string): boolean {
  return token === '$status_code' || token === '$status';
}

function isTextSlot(token: string): boolean {
  return (
    token === '$message' ||
    token === '$title' ||
    token === '$detail' ||
    token === '$code' ||
    token === '$type'
  );
}
