import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

function mockFetch(response: Response | Error) {
  const fn =
    response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the product name and the claim', () => {
    mockFetch(Response.json({ status: 'ok', version: '0.1.0' }));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'OpenSport' })).toBeInTheDocument();
    expect(screen.getByText('Your sports data, on another level.')).toBeInTheDocument();
  });

  it('shows the API version when /api/health answers', async () => {
    const fetchMock = mockFetch(Response.json({ status: 'ok', version: '0.1.0' }));
    render(<App />);
    expect(await screen.findByText('API connected · v0.1.0')).toBeInTheDocument();
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/health');
  });

  it('says the API is unreachable when the request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch(new Error('network down'));
    render(<App />);
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });
});
