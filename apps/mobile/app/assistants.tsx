/**
 * AI assistants (as Strava's): connect Claude, or another assistant that speaks MCP, to Zankup's MCP
 * server, so you can ask it about your training from its own app, with your own subscription. Claude
 * adds Zankup as a custom connector by its address; Zankup then asks you, signed in, to allow it
 * (OAuth, api/oauth.py). What each assistant can read, and how to disconnect it, at the bottom.
 */
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Icon } from '../src/Icon';
import { t } from '../src/i18n';
import { instanceUrl } from '../src/session';
import { useTheme } from '../src/theme';
import { accent, Button, Card, Muted, onAccent, Screen } from '../src/ui';

/** Where Claude's connectors are: there, "Add custom connector". */
const CLAUDE_CONNECTORS = 'https://claude.ai/settings/connectors';

export default function AssistantsScreen() {
  const c = useTheme();
  const url = `${(instanceUrl() ?? '').replace(/\/$/, '')}/api/mcp`;
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void Clipboard.setStringAsync(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  const steps = (keys: string[]) =>
    keys.map((key, i) => (
      <Text key={key} style={{ color: c.fg, fontSize: 14, lineHeight: 21 }}>
        {i + 1}. {t(key as never)}
      </Text>
    ));

  return (
    <Screen header>
      <Text style={{ color: c.fg, fontSize: 15, lineHeight: 22 }}>{t('assistants.intro')}</Text>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="smart_toy" color={accent(c)} size={28} />
          <Text style={{ color: c.fg, fontSize: 20, fontWeight: '800' }}>Claude</Text>
        </View>
        {steps([
          'assistants.claude.copy',
          'assistants.claude.open',
          'assistants.claude.paste',
          'assistants.claude.allow',
          'assistants.claude.chat',
        ])}
        <View style={{ padding: 12, borderRadius: 10, backgroundColor: c.surface2 }}>
          <Text selectable style={{ color: c.fg, fontFamily: 'monospace', fontSize: 13 }}>
            {url}
          </Text>
        </View>
        <Button icon={<Icon name="content_copy" color={c.fg} size={18} />} onPress={copy}>
          {copied ? t('common.copied') : t('assistants.copy')}
        </Button>
        <Button
          primary
          icon={<Icon name="open_in_new" color={onAccent(c)} size={18} />}
          onPress={() => void Linking.openURL(CLAUDE_CONNECTORS)}
        >
          {t('assistants.openClaude')}
        </Button>
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ color: c.fg, fontSize: 17, fontWeight: '700' }}>{t('assistants.others')}</Text>
        <Muted>{t('assistants.othersHelp')}</Muted>
        <Button onPress={() => router.push('/settings/ai')}>{t('assistants.tokens')}</Button>
      </Card>

      <Muted style={{ fontSize: 13, lineHeight: 19 }}>{t('assistants.privacy')}</Muted>
    </Screen>
  );
}
