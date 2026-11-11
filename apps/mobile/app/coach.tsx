/**
 * The Coach on the phone (OS-513), as in the PWA (OS-704, OS-705): the weekly report on top and
 * questions in natural language, answered as they are written. The stream comes from `expo/fetch`,
 * which gives React Native a readable body. The conversation lives in this screen only.
 */
import { aiStatusQuery, weeklyReportsQuery, type WeeklyReport } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetch } from 'expo/fetch';
import { router, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '../src/auth';
import { Icon } from '../src/Icon';
import { blocks, pieces, readEvents } from '../src/coach';
import { locale, t } from '../src/i18n';
import { accessToken, instanceUrl } from '../src/session';
import { useTheme } from '../src/theme';
import { accent, Body, Button, Card, CardTitle, Muted, onAccent, styles as ui, InfoButton } from '../src/ui';

type Turn = { role: 'user' | 'assistant'; content: string; error?: string };

const TOOL_LABELS: Record<string, Parameters<typeof t>[0]> = {
  search_activities: 'coach.tool.search_activities',
  activity_details: 'coach.tool.activity_details',
  fitness_stats: 'coach.tool.fitness_stats',
  records: 'coach.tool.records',
  daily_health: 'coach.tool.daily_health',
  estimates: 'coach.tool.estimates',
};
// Two examples, short and different: performance and recovery.
const SUGGESTIONS = ['coach.suggestion.1', 'coach.suggestion.3'] as const;

const day = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' });

export default function CoachScreen() {
  const api = useApi();
  const status = useQuery({ ...aiStatusQuery(api), retry: false });
  const info = status.data;
  const c = useTheme();
  if (!info) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (!info.available || !info.enabled)
    return (
      <View style={[ui.page, { flex: 1, backgroundColor: c.bg }]}>
        <Body>{info.available ? t('coach.off') : t('coach.unavailable')}</Body>
        {info.available && <Button onPress={() => router.push('/settings')}>{t('nav.settings')}</Button>}
      </View>
    );
  return <Chat weekly={!!info.weekly} budgetSpent={!!info.budget?.exceeded} />;
}

function Weekly() {
  const api = useApi();
  const c = useTheme();
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
  // The long text waits behind a link: the headline, the highlights and next week's advice say most.
  const [full, setFull] = useState(false);
  if (!reports.data) return null;
  return (
    <Card>
      <CardTitle>{t('weekly.title')}</CardTitle>
      {latest && (
        <Muted style={{ marginTop: -8 }}>{t('weekly.week', { date: day(latest.week_start) })}</Muted>
      )}
      {!latest && <Muted>{t('weekly.none')}</Muted>}
      {latest?.status === 'pending' && <Muted>{t('weekly.pending')}</Muted>}
      {latest?.status === 'failed' && <Muted accessibilityRole="alert">{t('weekly.failed')}</Muted>}
      {latest?.status === 'done' && (
        <>
          <Text style={{ color: c.fg, fontSize: 18, fontWeight: '700' }}>{latest.headline}</Text>
          {(latest.highlights?.length ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {latest.highlights?.map((item) => (
                <Text
                  key={item}
                  style={{
                    color: c.fg,
                    fontSize: 13,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderRadius: 999,
                    backgroundColor: c.surface2,
                  }}
                >
                  {item}
                </Text>
              ))}
            </View>
          )}
          {latest.recommendation && (
            <View style={{ backgroundColor: c.accentSoft, borderRadius: 12, padding: 12, gap: 4 }}>
              <Text style={{ color: c.fg, fontWeight: '700' }}>{t('weekly.recommendation')}</Text>
              <Body>{latest.recommendation}</Body>
            </View>
          )}
          {full && <Body>{latest.summary}</Body>}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: full }}
            onPress={() => setFull(!full)}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
          >
            <Text style={{ color: c.accent, fontWeight: '600' }}>
              {t(full ? 'weekly.less' : 'weekly.more')}
            </Text>
            <Icon
              name={full ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
              color={String(c.accent)}
              size={20}
            />
          </Pressable>
        </>
      )}
      {/* Writing it by hand only when there is none yet; Monday's comes on its own. */}
      {!latest && (
        <Pressable
          accessibilityRole="button"
          onPress={() => write.mutate()}
          disabled={write.isPending}
          hitSlop={8}
          style={{ alignSelf: 'center', paddingTop: 6, opacity: write.isPending ? 0.5 : 1 }}
        >
          <Text style={{ color: c.muted, fontSize: 13, textDecorationLine: 'underline' }}>
            {write.isPending ? t('coach.thinking') : t('weekly.generate')}
          </Text>
        </Pressable>
      )}
      {write.isError && <Muted accessibilityRole="alert">{t('weekly.failed')}</Muted>}
    </Card>
  );
}

function Chat({ weekly, budgetSpent }: { weekly: boolean; budgetSpent: boolean }) {
  const api = useApi();
  const c = useTheme();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // "New conversation" in the header as soon as there is one; while answering it stops first.
  const navigation = useNavigation();
  const hasTurns = turns.length > 0;
  // What the coach can and cannot do, behind an (i) in the header instead of a line under the chat.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
          <InfoButton text={t('coach.disclaimer')} label={t('coach.about')} />
          {hasTurns && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('coach.clear')}
              hitSlop={10}
              onPress={() => {
                abort.current?.abort();
                setTurns([]);
              }}
            >
              <Icon name="add_comment" color={c.fg} />
            </Pressable>
          )}
        </View>
      ),
    });
  }, [navigation, hasTurns, c.fg]);

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
    const send = () =>
      fetch(`${instanceUrl() ?? ''}/api/ai/coach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken(api)}` },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
        signal: controller.signal,
      });
    try {
      let response = await send();
      if (response.status === 401) {
        // An expired access token: a read through the client refreshes it, then ask again.
        await api.GET('/api/ai/status');
        response = await send();
      }
      if (!response.ok || !response.body) throw new Error(String(response.status));
      let text = '';
      for await (const event of readEvents(response.body)) {
        if (event.type === 'text') {
          text += event.text;
          setWorking(null);
          patch({ content: text });
        } else if (event.type === 'tool') {
          setWorking(event.status === 'running' ? t(TOOL_LABELS[event.name] ?? 'coach.thinking') : null);
        } else if (event.type === 'error') {
          patch({ error: event.code === 'budget' ? t('coach.budget') : t('coach.error') });
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) patch({ error: t('coach.error') });
    } finally {
      setBusy(false);
      setWorking(null);
      abort.current = null;
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={ui.page}
          // Only a conversation follows its newest message: on opening, the report shows from the top.
          onContentSizeChange={() => {
            if (turns.length > 0) scroll.current?.scrollToEnd({ animated: true });
          }}
        >
          {weekly && turns.length === 0 && <Weekly />}
          {budgetSpent && <Muted accessibilityRole="alert">{t('coach.budget')}</Muted>}
          {turns.length === 0 && !budgetSpent && (
            <>
              <Text style={{ color: c.fg, fontWeight: '600', marginTop: 4 }}>
                {t('coach.suggestionsTitle')}
              </Text>
              <View style={{ gap: 8 }}>
                {SUGGESTIONS.map((key) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    onPress={() => void ask(t(key))}
                    style={{ borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 12 }}
                  >
                    <Text style={{ color: c.fg }}>{t(key)}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <View accessibilityLiveRegion="polite" style={{ gap: 10 }}>
            {turns.map((turn, index) =>
              turn.role === 'user' ? (
                <View
                  key={index}
                  style={{
                    alignSelf: 'flex-end',
                    maxWidth: '85%',
                    backgroundColor: accent(c),
                    borderRadius: 16,
                    padding: 12,
                  }}
                >
                  <Text style={{ color: onAccent(c), fontSize: 15 }}>{turn.content}</Text>
                </View>
              ) : (
                <View key={index} style={{ gap: 6 }}>
                  {turn.content ? <Answer text={turn.content} /> : null}
                  {turn.error && <Muted accessibilityRole="alert">{turn.error}</Muted>}
                </View>
              ),
            )}
            {working && <Muted>{working}</Muted>}
          </View>
        </ScrollView>
        {!budgetSpent && (
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              padding: 12,
              borderTopWidth: 1,
              borderColor: c.line,
              alignItems: 'flex-end',
            }}
          >
            {/* The whole width for the question; send (or stop, while answering) sits inside it. */}
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={t('coach.placeholder')}
                accessibilityLabel={t('coach.placeholder')}
                placeholderTextColor={c.muted}
                multiline
                maxLength={4000}
                style={[
                  ui.input,
                  {
                    // Taller and edged in the theme's colour, so the place to ask stands out.
                    color: c.fg,
                    backgroundColor: c.surface,
                    borderColor: `${String(c.accent)}99`,
                    borderWidth: 1.5,
                    borderRadius: 16,
                    fontSize: 17,
                    minHeight: 56,
                    maxHeight: 140,
                    paddingVertical: 15,
                    paddingLeft: 46,
                    paddingRight: 52,
                  },
                ]}
              />
              <View pointerEvents="none" style={{ position: 'absolute', left: 14, top: 16 }}>
                <Icon name="wand_stars" color={String(c.accent)} size={22} />
              </View>
              {(busy || draft.trim()) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={busy ? t('coach.stop') : t('coach.send')}
                  hitSlop={8}
                  onPress={() => (busy ? abort.current?.abort() : void ask(draft.trim()))}
                  style={{
                    position: 'absolute',
                    right: 6,
                    bottom: 6,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: busy ? c.surface2 : accent(c),
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={busy ? 'stop' : 'send'} color={busy ? c.fg : onAccent(c)} size={20} />
                </Pressable>
              )}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Paragraphs and bullet lists, with links to activities that open their detail. */
function Answer({ text }: { text: string }) {
  const c = useTheme();
  const line = (content: string, key: number | string) => (
    <Text key={key} style={{ color: c.fg, fontSize: 15, lineHeight: 21 }}>
      {pieces(content).map((piece, n) =>
        'activity' in piece ? (
          <Text
            key={n}
            accessibilityRole="link"
            onPress={() => router.push(`/activity/${piece.activity}`)}
            style={{ color: c.accent, fontWeight: '600' }}
          >
            {t('coach.activityLink', { id: piece.activity })}
          </Text>
        ) : (
          piece.text
        ),
      )}
    </Text>
  );
  return (
    <>
      {blocks(text).map((block, index) =>
        block.kind === 'list' ? (
          <View key={index} style={{ gap: 4 }}>
            {block.items.map((item, n) => line(`• ${item}`, n))}
          </View>
        ) : (
          line(block.text, index)
        ),
      )}
    </>
  );
}
