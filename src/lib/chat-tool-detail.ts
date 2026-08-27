/**
 * What a tool chip shows once you open it: the params the model passed in, and what came back.
 *
 * Both halves of the chat feed the same shape. A turn still streaming carries the payloads off the
 * SSE (`chat-stream-events`); a reloaded turn carries the `input`/`output` persisted in the
 * `tool_calls` JSON (`assistantContentFromSteps`). So opening a chip reads the same whether you
 * are watching the tool run or replaying it a week later.
 */

/** Hard ceiling on what one panel renders — past this the DOM stops paying for itself. */
export const TOOL_PAYLOAD_MAX = 20_000;

/** Roughly what fits in the panel's scroll box. Under it, "show all" would toggle nothing. */
const TOOL_PAYLOAD_FOLD = 520;

export type ToolPayloadView = {
  /** Pretty-printed and ready for a `<pre>`, already capped at the max. */
  text: string;
  /** Characters the value serialized to BEFORE the cap — what the panel reports as its size. */
  length: number;
  /** `text` is only a prefix: the value ran past the cap. */
  truncated: boolean;
  /** Serialized JSON (monospace, indented) rather than prose the tool wrote itself. */
  json: boolean;
  /** Runs past the panel's scroll box, so the "show all" toggle is worth offering. */
  long: boolean;
};

export type ToolCallDetail = {
  input: ToolPayloadView | null;
  output: ToolPayloadView | null;
  /** Tool threw: the message the run reported, when the stream carried one. */
  error: string | null;
};

/** The call shapes a chip can be handed — a live stream entry or a persisted `tool-call` part. */
export type ToolCallLike = {
  toolName?: string;
  input?: unknown;
  args?: unknown;
  output?: unknown;
  errorText?: unknown;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON.stringify that survives cycles and never throws — a tool output is arbitrary data. */
function stringify(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[circolare]';
          seen.add(v as object);
        }
        if (typeof v === 'bigint') return `${v}`;
        return v;
      },
      2
    );
  } catch {
    return undefined;
  }
}

/** A tool that answered with a JSON string still deserves the indented view. */
function reparse(text: string): unknown {
  const first = text[0];
  if (first !== '{' && first !== '[') return undefined;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function serialize(value: unknown): { text: string; json: boolean } | null {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = reparse(trimmed);
    if (parsed !== undefined) {
      const text = stringify(parsed);
      if (text) return { text, json: true };
    }
    return { text: value, json: false };
  }
  // `{}` is a tool that takes no params — a panel saying "{}" is noise, not control.
  if (isPlainObject(value) && Object.keys(value).length === 0) return null;
  const text = stringify(value);
  return text === undefined ? null : { text, json: true };
}

/** One side of a chip panel. `null` when there is nothing worth opening a panel for. */
export function toolPayloadView(value: unknown, max: number = TOOL_PAYLOAD_MAX): ToolPayloadView | null {
  const ser = serialize(value);
  if (!ser) return null;
  const length = ser.text.length;
  return {
    text: length > max ? ser.text.slice(0, max) : ser.text,
    length,
    truncated: length > max,
    json: ser.json,
    long: length > TOOL_PAYLOAD_FOLD || ser.text.split('\n', 13).length > 12
  };
}

/**
 * Params + result for one call, or `null` when the chip has nothing to open — a live chip whose
 * tool has not returned yet, or a legacy row that only ever stored the tool's name.
 */
export function toolCallDetail(call: ToolCallLike | null | undefined): ToolCallDetail | null {
  if (!call) return null;
  const input = toolPayloadView(call.input ?? call.args);
  const output = toolPayloadView(call.output);
  const errorText = typeof call.errorText === 'string' ? call.errorText.trim() : '';
  const error = errorText || null;
  if (!input && !output && !error) return null;
  return { input, output, error };
}

/** Cheap enough to call per chip on every render: does this one open? */
export const hasToolDetail = (call: ToolCallLike | null | undefined): boolean => !!toolCallDetail(call);
