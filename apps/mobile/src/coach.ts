/**
 * The Coach's stream (OS-513), as the PWA reads it (OS-705): `POST /api/ai/coach` answers with one JSON
 * event per line. Pure, so it is tested without a phone (coach.test.ts).
 */

export type CoachEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error' }
  | { type: 'done'; tools: string[] }
  | { type: 'error'; message: string; code?: string };

/** Splits NDJSON as it arrives: the events of the complete lines and what is left for the next chunk. */
export function splitEvents(buffer: string): { events: CoachEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  return { events: lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as CoachEvent), rest };
}

/** Reads a streamed response body event by event. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<CoachEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const { events, rest } = splitEvents(buffer);
    buffer = rest;
    yield* events;
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as CoachEvent;
}

export type Piece = { text: string } | { activity: number };

/**
 * An answer's text with its links to activities picked out, and no bold marks. A link comes bare
 * ("/activities/123") or in Markdown ("[Activity 123](/activities/123)"): both become one link.
 */
export function pieces(text: string): Piece[] {
  return text
    .replace(/\[[^\]\n]*\]\((\/activities\/\d+)\)/g, '$1')
    .split(/(\/activities\/\d+)/)
    .filter((part) => part !== '')
    .map((part) => {
      const id = /^\/activities\/(\d+)$/.exec(part);
      return id ? { activity: Number(id[1]) } : { text: part.replace(/\*\*/g, '') };
    });
}

export type Block = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };

/** Paragraphs and simple bullet lists, as the Coach writes them. */
export function blocks(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .filter((b) => b.trim())
    .map((block) => {
      const lines = block.split('\n');
      return lines.every((line) => /^\s*[-•*]\s+/.test(line))
        ? { kind: 'list', items: lines.map((line) => line.replace(/^\s*[-•*]\s+/, '')) }
        : { kind: 'paragraph', text: block };
    });
}
