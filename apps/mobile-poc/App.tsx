/**
 * OpenSport React Native proof of concept (OS-501): sign in, then the detail of the latest activity.
 * "All" opens a plain list to pick another one. Not the Android app: that is phase 5.
 */
import { createApiClient, type ApiClient, type ApiPaths } from '@opensport/core';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ActivityDetail } from './src/ActivityDetail';
import { authorisedClient, loadSession, signIn, signOut, type Session } from './src/api';

type Summary = ApiPaths['/api/activities']['get']['responses'][200]['content']['application/json']['items'][number];

// Through `adb reverse tcp:8000 tcp:8000` the phone reaches the API on the computer as localhost.
const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export default function App() {
  const dark = useColorScheme() === 'dark';
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [activityId, setActivityId] = useState<number | null>(null);
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    loadSession().then(setSession, () => setSession(null));
  }, []);

  const api = useMemo(() => (session ? authorisedClient(session, () => setSession(null)) : null), [session]);

  useEffect(() => {
    if (!api || activityId != null) return;
    api
      .GET('/api/activities', { params: { query: { limit: 1 } } })
      .then(({ data, error, response }) => {
        console.log(`PERF feed status=${response.status} items=${data?.items.length ?? 'none'} error=${JSON.stringify(error)}`);
        const first = data?.items[0];
        if (first) setActivityId(first.id);
        else setShowList(true);
      })
      .catch((e: unknown) => console.log(`PERF feed failed ${String(e)}`));
  }, [api, activityId]);

  const bg = dark ? '#0e1013' : '#ffffff';
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {session === undefined ? null : !session || !api ? (
        <SignIn dark={dark} onSignedIn={setSession} />
      ) : showList ? (
        <ActivityList
          api={api}
          dark={dark}
          onPick={(id) => {
            setActivityId(id);
            setShowList(false);
          }}
          onSignOut={async () => {
            await signOut();
            setSession(null);
          }}
        />
      ) : activityId != null ? (
        <ActivityDetail key={activityId} api={api} activityId={activityId} onOpenList={() => setShowList(true)} />
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      )}
    </GestureHandlerRootView>
  );
}

function SignIn({ dark, onSignedIn }: { dark: boolean; onSignedIn: (s: Session) => void }) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = dark ? '#eef0f3' : '#16181d';
  const field = [styles.field, { color: text, borderColor: dark ? '#333840' : '#d4d7dd' }];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const health = await createApiClient(url).GET('/api/health');
      if (!health.data) throw new Error(`No OpenSport API at ${url}`);
      onSignedIn(await signIn(url, email.trim(), password, code.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.signIn}>
      <Text style={[styles.heading, { color: text }]}>OpenSport</Text>
      <TextInput style={field} value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="Server URL" />
      <TextInput
        style={field}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="E-mail"
        placeholderTextColor="#8a909b"
      />
      <TextInput
        style={field}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        placeholderTextColor="#8a909b"
      />
      <TextInput
        style={field}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        placeholder="6-digit code"
        placeholderTextColor="#8a909b"
        maxLength={8}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
    </View>
  );
}

function ActivityList({
  api,
  dark,
  onPick,
  onSignOut,
}: {
  api: ApiClient;
  dark: boolean;
  onPick: (id: number) => void;
  onSignOut: () => void;
}) {
  const [items, setItems] = useState<Summary[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const text = dark ? '#eef0f3' : '#16181d';
  const muted = dark ? '#9aa1ad' : '#646a75';

  const load = async (next?: string) => {
    const { data } = await api.GET('/api/activities', { params: { query: { limit: 50, cursor: next } } });
    if (!data) return;
    setItems((prev) => (next ? [...prev, ...data.items] : data.items));
    setCursor(data.next_cursor);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FlatList
      data={items}
      keyExtractor={(a) => String(a.id)}
      contentContainerStyle={{ paddingTop: 48, paddingHorizontal: 16 }}
      ListHeaderComponent={
        <View style={styles.listHeader}>
          <Text style={[styles.heading, { color: text }]}>Activities</Text>
          <Pressable onPress={onSignOut}>
            <Text style={{ color: muted }}>Sign out</Text>
          </Pressable>
        </View>
      }
      onEndReached={() => cursor && load(cursor)}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => onPick(item.id)}>
          <Text style={{ color: text, fontWeight: '600' }}>{item.name ?? item.sport}</Text>
          <Text style={{ color: muted }}>
            {item.start_utc.slice(0, 10)} · {item.distance_m ? `${(item.distance_m / 1000).toFixed(1)} km` : item.sport}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  signIn: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  heading: { fontSize: 26, fontWeight: '800', marginBottom: 8 },
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#fc4c02', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8884' },
});
