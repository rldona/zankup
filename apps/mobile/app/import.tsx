/**
 * Import on the phone (OS-515), as in the PWA (OS-404, OS-406): FIT, TCX, GPX or ZIP files (a Garmin
 * or a Strava export) picked with Android's file picker, uploaded in parts with their progress, and the
 * imports with their counts and problems.
 */
import { importsQuery, type ImportOut } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { locale, t } from '../src/i18n';
import { instanceUrl } from '../src/session';
import { useTheme } from '../src/theme';
import { upload, type Source } from '../src/upload';
import { Badge, Body, Button, Card, Heading, Muted, ProgressBar, Screen } from '../src/ui';

type Progress = { name: string; sent: number; size: number } | null;

const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' });
const megabytes = (bytes: number) =>
  `${(bytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;

/** A picked file, read part by part so a large export never sits whole in memory. */
function sourceOf(asset: DocumentPicker.DocumentPickerAsset): Source {
  const file = new File(asset.uri);
  return {
    name: asset.name,
    size: asset.size ?? file.size,
    read: async (offset, length) => {
      const handle = file.open();
      try {
        handle.offset = offset;
        return await handle.readBytes(length);
      } finally {
        handle.close();
      }
    },
  };
}

const put = async (url: string, body: Uint8Array<ArrayBuffer>) => {
  const response = await fetch(url, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  return { ok: response.ok, status: response.status };
};

export default function ImportScreen() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<Progress>(null);
  const imports = useQuery({
    ...importsQuery(api),
    refetchInterval: (q) =>
      q.state.data?.some((i) => i.status === 'queued' || i.status === 'running') ? 3000 : false,
  });
  const send = useMutation({
    mutationFn: async (assets: DocumentPicker.DocumentPickerAsset[]) => {
      for (const asset of assets) {
        const source = sourceOf(asset);
        setProgress({ name: source.name, sent: 0, size: source.size });
        await upload(api, instanceUrl() ?? '', source, put, (sent) =>
          setProgress({ name: source.name, sent, size: source.size }),
        );
        void queryClient.invalidateQueries({ queryKey: importsQuery(api).queryKey });
      }
    },
    onSettled: () => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: importsQuery(api).queryKey });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
  const choose = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      // FIT, TCX and GPX files have no MIME type Android knows: any file, checked by the server.
      type: '*/*',
    });
    if (!result.canceled && result.assets.length) send.mutate(result.assets);
  };

  return (
    <Screen header>
      <Body>{t('import.help')}</Body>
      <Muted>• {t('import.strava')}</Muted>
      <Muted>• {t('import.garmin')}</Muted>
      <Muted>• {t('import.files')}</Muted>
      <Button primary disabled={send.isPending} onPress={() => void choose()}>
        {t('import.choose')}
      </Button>
      {progress && (
        <Card>
          <Body>
            {t('import.uploading', { name: progress.name })} · {megabytes(progress.sent)} /{' '}
            {megabytes(progress.size)}
          </Body>
          <ProgressBar value={progress.sent} max={progress.size} label={progress.name} />
        </Card>
      )}
      {send.isError && <Muted accessibilityRole="alert">{t('import.uploadError')}</Muted>}
      <Heading>{t('import.history')}</Heading>
      {imports.data?.length === 0 && <Muted>{t('import.none')}</Muted>}
      {imports.data?.map((i) => (
        <ImportRow key={i.id} item={i} />
      ))}
    </Screen>
  );
}

function ImportRow({ item: i }: { item: ImportOut }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const running = i.status === 'queued' || i.status === 'running';
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: c.fg, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {i.filename}
        </Text>
        <Badge tone={i.status === 'done' ? 'good' : i.status === 'error' ? 'bad' : undefined}>
          {t(`import.status.${i.status as 'done'}`)}
        </Badge>
      </View>
      <Muted>
        {date(i.created_at)} · {megabytes(i.size)}
        {i.kind ? ` · ${t(`import.kind.${i.kind as 'strava' | 'archive' | 'file'}`)}` : ''}
      </Muted>
      {running && i.total > 0 && <ProgressBar value={i.processed} max={i.total} label={i.filename} />}
      {i.total > 0 && (
        <Muted>
          {t('import.counts', {
            processed: i.processed,
            total: i.total,
            created: i.created,
            merged: i.merged,
            skipped: i.skipped,
            failed: i.failed,
          })}
          {i.photos > 0 && ` · ${t('import.photos', { count: i.photos })}`}
        </Muted>
      )}
      {i.error && <Text style={{ color: c.zone5 }}>{i.error}</Text>}
      {i.errors.length > 0 && (
        <>
          <Button onPress={() => setOpen(!open)}>{t('import.problems', { count: i.failed })}</Button>
          {open &&
            i.errors.map((e, n) => (
              <Muted key={n}>
                {e.file}: {e.error}
              </Muted>
            ))}
        </>
      )}
    </Card>
  );
}
