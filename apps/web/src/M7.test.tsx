import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const ME = { id: 1, email: 'me@example.com', display_name: 'Runner', totp_enabled: true };
const SETTINGS = {
  theme: 'system',
  language: null,
  units: 'metric',
  hr_max: 190,
  hr_rest: 50,
  hr_max_estimate: 188,
  zone_model: 'max',
  lthr: null,
  ftp: null,
  privacy_zones: [],
  notifications: {},
  ai: { enabled: true, summaries: true, weekly: true },
};
const STATUS = {
  available: true,
  enabled: true,
  summaries: true,
  weekly: true,
  model: 'claude-haiku-5-5',
  budget: { month_cost_usd: 0.42, limit_usd: 5, warning: false, exceeded: false },
  sends: ['sport, date and distance'],
  never_sends: ['coordinates and routes'],
};
const RUN = {
  id: 7,
  name: 'Morning run',
  sport: 'run',
  sub_sport: null,
  source: 'garmin',
  start_utc: '2026-11-04T07:30:00Z',
  timezone: '+01:00',
  duration_s: 3600,
  moving_s: 3500,
  distance_m: 10000,
  ascent_m: 80,
  avg_hr: 150,
  avg_power: null,
  has_gps: false,
  route: null,
  photo: null,
  photos: 0,
};
const SUMMARY = {
  activity_id: 7,
  language: 'en',
  suggested_title: 'Steady 10 km with a 5 km record',
  summary: 'A steady 10.0 km at 5:50 min/km, a little faster than usual.',
  highlights: ['5 km record'],
  model: 'claude-haiku-5-5',
  created_at: '2026-11-04T09:00:00Z',
};
const REPORT = {
  id: 1,
  week_start: '2026-11-02',
  status: 'done',
  language: 'en',
  headline: 'A solid week',
  summary: 'You ran 32.0 km over four sessions.',
  recommendation: 'Keep the volume and add one easy day.',
  highlights: ['32 km', '5 km record'],
  error: null,
  created_at: '2026-11-09T06:00:00Z',
  finished_at: '2026-11-09T06:20:00Z',
};

type Handler = (url: URL, request: Request) => Response | Promise<Response>;

function mockApi(extra: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const handlers: Record<string, Handler> = {
    '/api/auth/me': () => Response.json(ME),
    '/api/settings': () => Response.json(SETTINGS),
    '/api/ai/status': () => Response.json(STATUS),
    '/api/activities': () => Response.json({ items: [RUN], next_cursor: null }),
    '/api/ai/tokens': () => Response.json([]),
    '/api/ai/weekly': () => Response.json([REPORT]),
    ...extra,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request =
        typeof input === 'string' ? new Request(new URL(input, 'http://localhost'), init) : input;
      const url = new URL(request.url);
      const text = request.method === 'GET' ? '' : await request.clone().text();
      calls.push({ method: request.method, path: url.pathname, body: text ? JSON.parse(text) : null });
      const handler = handlers[`${request.method} ${url.pathname}`] ?? handlers[url.pathname];
      return handler ? handler(url, request) : Response.json({ detail: 'Not Found' }, { status: 404 });
    }),
  );
  return calls;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App queryClient={queryClient} router={router} />);
  return router;
}

const ndjson = (events: object[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } },
  );

describe('phase 7: the AI assistant', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the Coach in Home's header only when this server has a model and the switch is on", async () => {
    mockApi();
    renderAt('/');
    // In Home's header (on a phone) and at the foot of the rail.
    const header = within(await screen.findByRole('main'));
    expect(await header.findByRole('link', { name: 'Coach' })).toHaveAttribute('href', '/coach');
    expect(await screen.findAllByRole('link', { name: 'Coach' })).toHaveLength(2);
    vi.unstubAllGlobals();
    mockApi({
      '/api/ai/status': () => Response.json({ ...STATUS, available: false, model: null, budget: null }),
    });
    renderAt('/coach');
    expect(
      await screen.findByText('Zankup Coach turns on as soon as you save an Anthropic key above.'),
    ).toBeInTheDocument();
  });

  it('answers a question as it streams, with the tools it used and links to activities', async () => {
    const calls = mockApi({
      'POST /api/ai/coach': () =>
        ndjson([
          { type: 'tool', name: 'search_activities', status: 'running' },
          { type: 'tool', name: 'search_activities', status: 'done' },
          { type: 'text', text: 'You ran **16.0 km** in two runs' },
          {
            type: 'text',
            text: ', the longest being /activities/7.\n\n- 10.0 km on Wednesday\n- 6.0 km on Monday',
          },
          { type: 'done', tools: ['search_activities'], usage: {} },
        ]),
    });
    renderAt('/coach');
    expect(await screen.findByRole('heading', { name: "Coach's weekly report" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A solid week' })).toBeInTheDocument();
    expect(screen.getByText(/Keep the volume/)).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Ask the coach…' });
    await userEvent.type(box, 'How much did I run this month?{Enter}');
    expect(await screen.findByText(/You ran 16.0 km in two runs/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activity 7' })).toHaveAttribute('href', '/activities/7');
    expect(screen.getByText('10.0 km on Wednesday')).toBeInTheDocument();
    const sent = calls.find((c) => c.path === '/api/ai/coach');
    expect(sent?.body).toEqual({ messages: [{ role: 'user', content: 'How much did I run this month?' }] });
    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.getByText('How am I doing for a 10K?')).toBeInTheDocument();
  });

  it('tells the user when the budget is spent instead of asking', async () => {
    mockApi({
      '/api/ai/status': () =>
        Response.json({
          ...STATUS,
          budget: { month_cost_usd: 5, limit_usd: 5, warning: true, exceeded: true },
        }),
    });
    renderAt('/coach');
    expect(await screen.findByText(/This month's Zankup Coach budget is spent/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the summary on the activity and lets the user write it and take the title', async () => {
    let summary: object | null = null;
    const calls = mockApi({
      '/api/activities/7': () => Response.json({ ...RUN, laps: [], splits: [], best_efforts: [] }),
      '/api/activities/7/summary': () =>
        summary ? Response.json(summary) : Response.json({ detail: 'No summary yet' }, { status: 404 }),
      'POST /api/activities/7/summary': () => {
        summary = SUMMARY;
        return Response.json(SUMMARY);
      },
      'PATCH /api/activities/7': (_url, request) =>
        request.json().then((body: { name: string }) => Response.json({ ...RUN, name: body.name })),
    });
    renderAt('/activities/7');
    expect(await screen.findByRole('heading', { name: 'Zankup Coach' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ask for a summary' }));
    expect(await screen.findByText(/A steady 10.0 km/)).toBeInTheDocument();
    expect(screen.getByText('5 km record')).toBeInTheDocument();
    expect(screen.getByText('Steady 10 km with a 5 km record')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use this title' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        name: 'Steady 10 km with a 5 km record',
      }),
    );
    // A written summary stays as it is: no button to write it again.
    expect(screen.queryByRole('button', { name: 'Ask for a summary' })).not.toBeInTheDocument();
  });

  it('has the AI switches, the explanation and the MCP tokens in Settings', async () => {
    let tokens: object[] = [];
    const calls = mockApi({
      '/api/ai/tokens': () => Response.json(tokens),
      'POST /api/ai/tokens': () => {
        tokens = [
          {
            id: 3,
            name: 'Claude Desktop',
            prefix: 'zk_abcde',
            created_at: '2026-11-09T10:00:00Z',
            last_used_at: null,
          },
        ];
        return Response.json({ ...tokens[0], token: 'zk_abcdefghij', url: '/api/mcp' }, { status: 201 });
      },
      'PATCH /api/settings': (_url, request) =>
        request.json().then((body: object) => Response.json({ ...SETTINGS, ...body })),
      'DELETE /api/ai/tokens/3': () => {
        tokens = [];
        return new Response(null, { status: 204 });
      },
    });
    renderAt('/settings/ai');
    expect(await screen.findByRole('heading', { name: 'Zankup Coach' })).toBeInTheDocument();
    expect(await screen.findByText('coordinates and routes')).toBeInTheDocument();
    expect(screen.getByText(/\$0\.42 of \$5\.00 spent this month/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use Zankup Coach' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/settings')?.body).toEqual({
        ai: { enabled: false, summaries: true, weekly: true },
      }),
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Token name' }), 'Claude Desktop');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByDisplayValue('zk_abcdefghij')).toBeInTheDocument();
    expect(screen.getByText('Copy it now: it is shown only once.')).toBeInTheDocument();
    expect(await screen.findByText('Claude Desktop', { selector: 'b' })).toBeInTheDocument();
    vi.stubGlobal('confirm', () => true);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/ai/tokens/3')).toBe(true),
    );
    expect(await screen.findByText('No tokens yet.')).toBeInTheDocument();
  });

  it('the Coach as on the app: two examples, and its note behind the (i) (OS-915)', async () => {
    mockApi();
    renderAt('/coach');
    expect(await screen.findByText('Questions you could ask:')).toBeInTheDocument();
    const chat = screen.getByRole('region', { name: 'Zankup Coach' });
    expect(
      within(chat)
        .getAllByRole('button')
        .filter((b) => b.textContent?.endsWith('?')),
    ).toHaveLength(2);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'About the coach' }));
    expect(screen.getByRole('note')).toHaveTextContent(/can be wrong/);
  });
});

describe('connecting an AI assistant by OAuth', () => {
  afterEach(() => vi.unstubAllGlobals());

  const query =
    '?response_type=code&client_id=abc&redirect_uri=' +
    encodeURIComponent('https://claude.ai/api/mcp/auth_callback') +
    '&code_challenge=' +
    'c'.repeat(43) +
    '&code_challenge_method=S256&state=xyz';

  it('says who asks and, allowed, sends the code back to the assistant', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const calls = mockApi({
      '/api/oauth/client': () => Response.json({ name: 'Claude' }),
      'POST /api/oauth/approve': () =>
        Response.json({ redirect: 'https://claude.ai/api/mcp/auth_callback?code=k&state=xyz' }),
    });
    renderAt(`/oauth/authorize${query}`);
    expect(await screen.findByRole('heading', { name: 'Claude wants to access your Zankup' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=k&state=xyz'),
    );
    const approve = calls.find((c) => c.path === '/api/oauth/approve');
    expect(approve?.body).toMatchObject({ client_id: 'abc', state: 'xyz', code_challenge_method: 'S256' });
  });

  it('refuses a link that is not a valid request', async () => {
    mockApi({ '/api/oauth/client': () => Response.json({ detail: 'no' }, { status: 400 }) });
    renderAt(`/oauth/authorize${query}`);
    expect(await screen.findByText(/not valid or has expired/)).toBeVisible();
  });
});
