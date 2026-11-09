import { apiTokensQuery, type ApiTokenCreated } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api } from '../api';
import { locale, t } from '../i18n';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

/** Personal tokens for the read-only MCP server (OS-709): create one (shown once), list and revoke. */
export function Mcp() {
  const queryClient = useQueryClient();
  const tokens = useQuery(apiTokensQuery(api));
  const [name, setName] = useState('');
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST('/api/ai/tokens', { body: { name } });
      if (!data) throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? 'error'));
      return data;
    },
    onSuccess: (data) => {
      setCreated(data);
      setCopied(false);
      setName('');
      void queryClient.invalidateQueries({ queryKey: apiTokensQuery(api).queryKey });
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await api.DELETE('/api/ai/tokens/{token_id}', { params: { path: { token_id: id } } });
      if (error) throw new Error('revoke');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: apiTokensQuery(api).queryKey }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };
  const url = created?.url ? new URL(created.url, location.origin).toString() : `${location.origin}/api/mcp`;
  return (
    <>
      <h2 id="mcp">{t('mcp.title')}</h2>
      <p className="note">{t('mcp.help')}</p>
      <p className="note">
        {t('mcp.url')}: <code>{url}</code>
      </p>
      <form className="fields" onSubmit={submit}>
        <label className="field">
          <span>{t('mcp.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Claude Desktop"
          />
        </label>
        <div className="actions">
          <button type="submit" className="primary" disabled={create.isPending || !name.trim()}>
            {t('mcp.create')}
          </button>
          {create.isError && (
            <span className="note" role="alert">
              {t('common.error')}
            </span>
          )}
        </div>
      </form>
      {created && (
        <div className="sharelink" role="status">
          <p className="note">{t('mcp.created')}</p>
          <input
            readOnly
            value={created.token}
            aria-label={t('mcp.name')}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(created.token).then(() => setCopied(true))}
          >
            {copied ? t('mcp.copied') : t('mcp.copy')}
          </button>
        </div>
      )}
      {tokens.data && tokens.data.length === 0 && <p className="note">{t('mcp.none')}</p>}
      {tokens.data && tokens.data.length > 0 && (
        <ul className="rows">
          {tokens.data.map((token) => (
            <li key={token.id}>
              <div>
                <b>{token.name}</b>
                <small className="note">
                  {' '}
                  {token.prefix}… ·{' '}
                  {token.last_used_at
                    ? t('mcp.lastUsed', { date: day(token.last_used_at) })
                    : t('mcp.neverUsed')}
                </small>
              </div>
              <button
                type="button"
                className="link"
                onClick={() => window.confirm(t('mcp.revokeConfirm')) && revoke.mutate(token.id)}
              >
                {t('mcp.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
