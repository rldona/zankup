import { aiStatusQuery, weeklyReportsQuery, type WeeklyReport } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';

type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[]; error?: string };
type Event =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error' }
  | { type: 'done'; tools: string[] }
  | { type: 'error'; message: string; code?: string };

const TOOL_LABELS: Record<string, Parameters<typeof t>[0]> = {
  search_activities: 'coach.tool.search_activities',
  activity_details: 'coach.tool.activity_details',
  fitness_stats: 'coach.tool.fitness_stats',
  records: 'coach.tool.records',
  daily_health: 'coach.tool.daily_health',
  estimates: 'coach.tool.estimates',
};
const SUGGESTIONS = [
  'coach.suggestion.1',
  'coach.suggestion.2',
  'coach.suggestion.3',
  'coach.suggestion.4',
] as const;

const day = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' });

/**
 * The Coach (OS-705): questions in natural language, answered as they are written, with the weekly
 * report on top (OS-704). The conversation lives in this screen only: nothing is stored.
 */
export function Coach() {
  const status = useQuery({ ...aiStatusQuery(api), retry: false });
  const info = status.data;
  return (
    <section className="page coach">
      <h1>{t('coach.title')}</h1>
      {info && !info.available && <p className="state">{t('coach.unavailable')}</p>}
      {info?.available && !info.enabled && (
        <p className="state">
          {t('coach.off')} <Link to="/settings/ai">{t('nav.settings')}</Link>
        </p>
      )}
      {info?.available && info.enabled && (
        <>
          {info.weekly && <Weekly />}
          {info.budget?.exceeded ? <p className="warn">{t('coach.budget')}</p> : <Chat />}
        </>
      )}
    </section>
  );
}

function Weekly() {
  const queryClient = useQueryClient();
  const reports = useQuery(weeklyReportsQuery(api));
  const write = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/ai/weekly', { body: {} });
      if (!data) throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? 'error'));
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: weeklyReportsQuery(api).queryKey }),
  });
  const latest: WeeklyReport | undefined = reports.data?.[0];
  if (!reports.data) return null;
  return (
    <section className="panel weekly" aria-labelledby="weekly-title">
      <div className="ph">
        <h2 id="weekly-title">{t('weekly.title')}</h2>
        {latest && <span className="note">{t('weekly.week', { date: day(latest.week_start) })}</span>}
      </div>
      {!latest && <p className="note">{t('weekly.none')}</p>}
      {latest?.status === 'pending' && <p className="note">{t('weekly.pending')}</p>}
      {latest?.status === 'failed' && (
        <p className="note" role="alert">
          {t('weekly.failed')}
        </p>
      )}
      {latest?.status === 'done' && (
        <>
          <h3>{latest.headline}</h3>
          <p className="desc">{latest.summary}</p>
          {latest.highlights && latest.highlights.length > 0 && (
            <ul className="highlights">
              {latest.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {latest.recommendation && (
            <p className="recommendation">
              <b>{t('weekly.recommendation')}:</b> {latest.recommendation}
            </p>
          )}
        </>
      )}
      <div className="actions">
        <button type="button" onClick={() => write.mutate()} disabled={write.isPending}>
          {write.isPending ? t('coach.thinking') : t('weekly.generate')}
        </button>
        {write.isError && (
          <span className="note" role="alert">
            {t('weekly.failed')}
          </span>
        )}
      </div>
    </section>
  );
}

/** Reads the NDJSON stream of `POST /api/ai/coach`, one event per line. */
async function* events(response: Response): AsyncGenerator<Event> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as Event;
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as Event;
}

function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [turns, working]);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async (question: string) => {
    const history: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns([...history, { role: 'assistant', content: '' }]);
    setDraft('');
    setBusy(true);
    setWorking(t('coach.thinking'));
    const controller = new AbortController();
    abort.current = controller;
    const patch = (change: Partial<Turn>) =>
      setTurns((current) => {
        const last = current[current.length - 1];
        if (!last || last.role !== 'assistant') return current;
        return [...current.slice(0, -1), { ...last, ...change }];
      });
    try {
      const response = await fetch('/api/ai/coach', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      let text = '';
      for await (const event of events(response)) {
        if (event.type === 'text') {
          text += event.text;
          setWorking(null);
          patch({ content: text });
        } else if (event.type === 'tool') {
          setWorking(event.status === 'running' ? t(TOOL_LABELS[event.name] ?? 'coach.thinking') : null);
        } else if (event.type === 'done') {
          patch({ tools: event.tools });
        } else if (event.type === 'error') {
          patch({ error: event.code === 'budget' ? t('coach.budget') : t('coach.error') });
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) patch({ error: t('coach.error') });
    } finally {
      setBusy(false);
      setWorking(null);
      abort.current = null;
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() && !busy) void ask(draft.trim());
  };

  return (
    <section className="chat" aria-label={t('coach.title')}>
      {turns.length === 0 && (
        <div className="intro">
          <p>{t('coach.intro')}</p>
          <div className="suggestions">
            {SUGGESTIONS.map((key) => (
              <button key={key} type="button" onClick={() => void ask(t(key))}>
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      )}
      <ol className="turns" aria-live="polite">
        {turns.map((turn, index) => (
          <li key={index} className={turn.role}>
            {turn.role === 'user' ? <p>{turn.content}</p> : <Answer text={turn.content} />}
            {turn.error && (
              <p className="note" role="alert">
                {turn.error}
              </p>
            )}
          </li>
        ))}
        {working && (
          <li className="assistant working" role="status">
            {working}
          </li>
        )}
      </ol>
      <div ref={end} />
      <form className="composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('coach.placeholder')}
          aria-label={t('coach.placeholder')}
          rows={2}
          maxLength={4000}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (draft.trim() && !busy) void ask(draft.trim());
            }
          }}
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()}>
            {t('coach.stop')}
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!draft.trim()}>
            {t('coach.send')}
          </button>
        )}
        {turns.length > 0 && !busy && (
          <button type="button" className="link" onClick={() => setTurns([])}>
            {t('coach.clear')}
          </button>
        )}
      </form>
      <p className="note disclaimer">{t('coach.disclaimer')}</p>
    </section>
  );
}

/** Plain text with paragraphs, simple bullet lists and links to activities (/activities/123). */
function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split('\n');
        if (lines.every((line) => /^\s*[-•*]\s+/.test(line))) {
          return (
            <ul key={index}>
              {lines.map((line, n) => (
                <li key={n}>{linkify(line.replace(/^\s*[-•*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{linkify(block)}</p>;
      })}
    </>
  );
}

function linkify(text: string): ReactNode[] {
  const parts = text.split(/(\/activities\/\d+)/);
  return parts.map((part, index) =>
    /^\/activities\/\d+$/.test(part) ? (
      <Link key={index} to={part}>
        {t('coach.activityLink', { id: part.replace('/activities/', '') })}
      </Link>
    ) : (
      part.replace(/\*\*/g, '')
    ),
  );
}
