/**
 * The Coach's texts mark what matters most in **double asterisks** (the report on an activity): split
 * into plain and bold runs for the apps to draw. Nothing else is read as markdown; an asterisk left
 * unpaired stays as it is.
 */
export type Run = { text: string; bold: boolean };

export function emphasis(text: string): Run[] {
  const runs: Run[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), bold: false });
    runs.push({ text: match[1], bold: true });
    last = at + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  return runs;
}
