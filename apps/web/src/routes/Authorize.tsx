import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';
import { Mark } from '../Mark';
import { Wordmark } from '../Wordmark';

/**
 * Connecting an AI assistant to the MCP server by OAuth (api/oauth.py): the assistant sends the person
 * here, signed in (RequireSession sends them to sign in first and back). They see who asks and what
 * it can do, and allow it (a code goes back to the assistant) or cancel (the assistant is told so).
 */
export function Authorize() {
  const [params] = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const challenge = params.get('code_challenge') ?? '';
  const method = params.get('code_challenge_method') ?? 'S256';
  const state = params.get('state');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const client = useQuery({
    queryKey: ['oauth', 'client', clientId, redirectUri],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/oauth/client', {
        params: { query: { client_id: clientId, redirect_uri: redirectUri } },
      });
      if (error || !data) throw new Error('unknown client');
      return data;
    },
    retry: false,
    enabled: Boolean(clientId && redirectUri),
  });

  const valid =
    params.get('response_type') === 'code' && clientId && redirectUri && challenge && method === 'S256';
  if (!valid || client.isError) {
    return (
      <main className="placeholder">
        <Wordmark />
        <p>{t('oauth.invalid')}</p>
      </main>
    );
  }
  if (!client.data) {
    return (
      <main className="placeholder">
        <p>{t('common.loading')}</p>
      </main>
    );
  }

  const allow = async () => {
    setBusy(true);
    setFailed(false);
    const { data, error } = await api.POST('/api/oauth/approve', {
      body: {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: method,
        state,
      },
    });
    if (error || !data) {
      setBusy(false);
      setFailed(true);
      return;
    }
    window.location.assign(data.redirect);
  };
  const cancel = () => {
    // Only to the address the assistant registered (checked above): it learns the person said no.
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (state) url.searchParams.set('state', state);
    window.location.assign(url.toString());
  };

  return (
    <main className="placeholder authorize">
      <Mark />
      <h1>{t('oauth.title', { name: client.data.name })}</h1>
      <p>{t('oauth.what', { name: client.data.name })}</p>
      <ul>
        <li>{t('oauth.reads')}</li>
        <li>{t('oauth.never')}</li>
        <li>{t('oauth.revoke')}</li>
      </ul>
      {failed && <p role="alert">{t('common.error')}</p>}
      <button type="button" className="block primary" disabled={busy} onClick={() => void allow()}>
        {t('oauth.allow')}
      </button>
      <button type="button" className="block" disabled={busy} onClick={cancel}>
        {t('oauth.cancel')}
      </button>
    </main>
  );
}
