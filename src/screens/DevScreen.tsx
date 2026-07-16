// ============================================================================
// DEV SIMULATION CONTROLLER — temporary. Delete before release.
//
// Reachable only from the red DEV tile on Home, which is itself wrapped in
// `__DEV__`. Metro strips `if (__DEV__)` branches from production bundles, so
// neither the tile nor this route exists in a release build. To remove the
// screen entirely, see DEV_TESTING.md ("Removing the dev page").
//
// What this is for: driving states that are painful to reach by hand — an
// expired subscription, a corrupt settings blob, a fresh install — without
// touching the server or waiting a month for a real expiry.
//
// IMPORTANT — simulated subscription states are LOCAL ONLY and get overwritten:
// pullAll() writes subscriptionEnd/isActive from `societies` on every pull, and
// App.tsx pulls whenever the app returns to the foreground. So a simulated
// expiry survives until the next sync/foreground, then snaps back to whatever
// the server says. That is the honest behaviour, not a bug in this page — the
// banner below shows when it happens.
// ============================================================================
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { getSettings, saveSettings, DEFAULT_SETTINGS, AppSettings } from '../lib/settings';
import { computeLocked, isLockedNow, refreshLock, SubscriptionLockedError } from '../lib/subscription';
import { supabase } from '../lib/supabase';
import { pushAll, pullAll } from '../lib/sync';
import {
  getDb, pendingCount, todayTotals, listMembers,
  insertMember, updateMember, deleteMember, insertCollection, insertPayout,
  insertLedgerEntry, insertLocalSale, insertUnionSale, insertKapatItem,
  setLocalSaleRate, setRateChart, lockSession, toggleMemberKapat,
} from '../lib/db';

const DAY = 86400_000;
const PROBE_CODE = 99999; // every probe row uses this so cleanup can find them

type Status = {
  email: string | null;
  userId: string | null;
  societyId: string | null;
  serverIsActive: boolean | null;
  serverEnd: string | null;
  settings: AppSettings | null;
  locked: boolean;
  cachedLock: boolean;
  pending: number;
  members: number;
  totals: { litres: number; amount: number; count: number } | null;
};

export default function DevScreen({ navigation }: any) {
  const { session, signOut } = useAuth();
  const { locked, refresh, guard } = useSubscription();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const say = (line: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 200));

  const load = useCallback(async () => {
    const settings = await getSettings();
    let societyId: string | null = null;
    let serverIsActive: boolean | null = null;
    let serverEnd: string | null = null;

    if (session?.user?.id) {
      const { data: prof } = await supabase.from('profiles').select('society_id').eq('id', session.user.id).maybeSingle();
      societyId = prof?.society_id ?? null;
      if (societyId) {
        const { data: soc } = await supabase
          .from('societies').select('is_active, subscription_end_date').eq('id', societyId).maybeSingle();
        serverIsActive = soc?.is_active ?? null;
        serverEnd = soc?.subscription_end_date ?? null;
      }
    }

    setStatus({
      email: session?.user?.email ?? null,
      userId: session?.user?.id ?? null,
      societyId,
      serverIsActive,
      serverEnd,
      settings,
      locked: await computeLocked(),
      cachedLock: isLockedNow(),
      pending: await pendingCount(),
      members: (await listMembers()).length,
      totals: await todayTotals(),
    });
  }, [session]);

  useFocusEffect(useCallback(() => { if (autoRefresh) load(); }, [load, autoRefresh]));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      say(`✗ ${label}: ${e?.message ?? String(e)}`);
      Alert.alert('Failed', e?.message ?? String(e));
    } finally {
      setBusy(null);
      await load();
      await refresh();
    }
  };

  // ---------------------------------------------------- subscription states
  const setSub = (label: string, patch: Partial<AppSettings>) =>
    run(label, async () => {
      const s = await getSettings();
      await saveSettings({ ...s, ...patch });
      const nowLocked = await refreshLock();
      say(`${label} → locked=${nowLocked}`);
    });

  const SUB_STATES: { label: string; hint: string; patch: Partial<AppSettings>; expect: boolean }[] = [
    { label: 'Active · 30 days left', hint: 'the normal, healthy state', expect: false,
      patch: { isActive: true, subscriptionEnd: new Date(Date.now() + 30 * DAY).toISOString() } },
    { label: 'Active · expires in 2 min', hint: 'watch it flip to locked while you use it', expect: false,
      patch: { isActive: true, subscriptionEnd: new Date(Date.now() + 2 * 60_000).toISOString() } },
    { label: 'EXPIRED · 1 minute ago', hint: 'the boundary case', expect: true,
      patch: { isActive: true, subscriptionEnd: new Date(Date.now() - 60_000).toISOString() } },
    { label: 'EXPIRED · 5 days ago', hint: 'a lapsed dairy', expect: true,
      patch: { isActive: true, subscriptionEnd: new Date(Date.now() - 5 * DAY).toISOString() } },
    { label: 'DISABLED by admin (is_active=false)', hint: 'the kill switch; date still valid', expect: true,
      patch: { isActive: false, subscriptionEnd: new Date(Date.now() + 30 * DAY).toISOString() } },
    { label: 'New signup / fresh install', hint: 'no subscription → locked; there is no trial', expect: true,
      patch: { isActive: true, subscriptionEnd: '' } },
    { label: 'CORRUPT end date', hint: 'NaN compare → fails OPEN (unlocked)', expect: false,
      patch: { isActive: true, subscriptionEnd: 'not-a-real-date' } },
  ];

  // ------------------------------------------------------------ write probe
  // Every guarded write, attempted for real. Run this while LOCKED: each should
  // throw SubscriptionLockedError. Anything that returns instead of throwing is
  // a hole in the backstop — and it just wrote a row, which cleanup removes.
  const WRITES: { name: string; fn: () => Promise<void> }[] = [
    { name: 'insertMember', fn: () => insertMember({ membercode: PROBE_CODE, name: 'DEV probe' }) },
    { name: 'updateMember', fn: () => updateMember({ membercode: PROBE_CODE, name: 'DEV probe edited' }) },
    { name: 'deleteMember', fn: () => deleteMember(PROBE_CODE) },
    { name: 'insertCollection', fn: () => insertCollection({
        membercode: PROBE_CODE, session: 0, collect_date: new Date().toISOString().slice(0, 10),
        weight: 1, fat: 4, snf: 8, clr: 26, rate: 30, price: 30, kg_fat: 0.04, kg_snf: 0.08,
        deduction: 0, pay_price: 30,
      }) },
    { name: 'insertPayout', fn: () => insertPayout({ membercode: PROBE_CODE, amount: 1, method: 'cash' }) },
    { name: 'insertLedgerEntry', fn: () => insertLedgerEntry({ membercode: PROBE_CODE, amount: 1, kind: 'jama' }) },
    { name: 'insertLocalSale', fn: () => insertLocalSale({ customer_name: 'DEV probe', quantity: 1, rate: 50, amount: 50 }) },
    { name: 'insertUnionSale', fn: () => insertUnionSale({
        sale_date: new Date().toISOString().slice(0, 10), session: 0, quantity: 1,
        fat: 4, snf: 8, rate: 30, amount: 30, kg_fat: 0.04, kg_snf: 0.08,
      }) },
    { name: 'insertKapatItem', fn: () => insertKapatItem({ name: 'DEV probe', type: 'fixed', value: 1 }) },
    { name: 'setLocalSaleRate', fn: () => setLocalSaleRate('__dev_probe', 1) },
    { name: 'setRateChart', fn: () => setRateChart([{ fat: 4, rate: 32 }]) },
    { name: 'lockSession', fn: () => lockSession('1999-01-01', 0) },
    { name: 'toggleMemberKapat', fn: () => toggleMemberKapat(PROBE_CODE, 1, true) },
  ];

  const probeWrites = () =>
    run('Probe writes', async () => {
      if (!isLockedNow()) {
        Alert.alert(
          'Not locked',
          'This probe checks that every write REFUSES while locked. Right now the app is unlocked, so the writes would succeed and insert junk rows.\n\nPick an EXPIRED state first, then run the probe.'
        );
        return;
      }
      say('── probing every guarded write while LOCKED ──');
      const holes: string[] = [];
      for (const w of WRITES) {
        try {
          await w.fn();
          holes.push(w.name);
          say(`✗ ${w.name} — WROTE ANYWAY (no assertUnlocked)`);
        } catch (e: any) {
          if (e instanceof SubscriptionLockedError || e?.name === 'SubscriptionLockedError') {
            say(`✓ ${w.name} — blocked`);
          } else {
            say(`? ${w.name} — threw something else: ${e?.message}`);
          }
        }
      }
      await cleanupProbeRows();
      say(holes.length ? `── ${holes.length} UNGUARDED: ${holes.join(', ')} ──` : '── all writes blocked ──');
      Alert.alert(
        holes.length ? `${holes.length} unguarded write(s)` : 'All writes blocked ✓',
        holes.length
          ? `These wrote data despite the lock:\n\n${holes.join('\n')}\n\nThey are missing assertUnlocked() in db.ts. Probe rows have been cleaned up.`
          : 'Every guarded write threw SubscriptionLockedError. The db.ts backstop holds.'
      );
    });

  // Probe rows are all tagged with PROBE_CODE / '__dev_probe' / 'DEV probe'.
  async function cleanupProbeRows() {
    const db = await getDb();
    await db.runAsync(`DELETE FROM members WHERE membercode = ?`, [PROBE_CODE]);
    await db.runAsync(`DELETE FROM milk_collections WHERE membercode = ?`, [PROBE_CODE]);
    await db.runAsync(`DELETE FROM payouts WHERE membercode = ?`, [PROBE_CODE]);
    await db.runAsync(`DELETE FROM ledger_entries WHERE membercode = ?`, [PROBE_CODE]);
    await db.runAsync(`DELETE FROM member_kapat WHERE membercode = ?`, [PROBE_CODE]);
    await db.runAsync(`DELETE FROM local_sales WHERE customer_name = 'DEV probe'`);
    await db.runAsync(`DELETE FROM union_sales WHERE sale_date = ? AND quantity = 1 AND note IS NULL`, ['1999-01-01']);
    await db.runAsync(`DELETE FROM kapat_items WHERE name = 'DEV probe'`);
    await db.runAsync(`DELETE FROM local_sale_rates WHERE milk_type = '__dev_probe'`);
    await db.runAsync(`DELETE FROM session_locks WHERE collect_date = '1999-01-01'`);
  }

  // ------------------------------------------------------------------ render
  const s = status;
  const serverLocked =
    s?.serverIsActive === null ? null
      : s?.serverIsActive === false || (!!s?.serverEnd && Date.now() > new Date(s.serverEnd).getTime());
  const drift = serverLocked !== null && s !== null && serverLocked !== s.locked;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 14, paddingBottom: 60 }}>
      <View style={styles.warnBar}>
        <Text style={styles.warnText}>
          ⚠️  DEV ONLY — temporary page. Subscription states set here are LOCAL and are overwritten by the next sync or app foreground.
        </Text>
      </View>

      {/* ---------------------------------------------------------- status */}
      <Section title="Current state">
        <Row k="Signed in as" v={s?.email ?? '—'} />
        <Row k="User id" v={s?.userId?.slice(0, 8) ?? '—'} />
        <Row k="Society id" v={s?.societyId?.slice(0, 8) ?? '— (no society!)'} bad={!s?.societyId} />
        <Row k="Pending sync rows" v={String(s?.pending ?? 0)} />
        <Row k="Farmers (local)" v={String(s?.members ?? 0)} />
        <Row k="Today" v={s ? `${s.totals?.litres ?? 0} L · ₹${s.totals?.amount ?? 0} · ${s.totals?.count ?? 0} entries` : '—'} />

        <View style={styles.hr} />
        <Text style={styles.subhead}>Lock</Text>
        <Row k="useSubscription().locked" v={locked ? 'LOCKED 🔒' : 'unlocked'} bad={locked} />
        <Row k="isLockedNow() (write backstop)" v={s?.cachedLock ? 'LOCKED 🔒' : 'unlocked'} bad={s?.cachedLock} />
        <Row k="computeLocked() (recomputed)" v={s?.locked ? 'LOCKED 🔒' : 'unlocked'} bad={s?.locked} />
        {s && s.cachedLock !== s.locked && (
          <Text style={styles.alertText}>
            ⚠️ The cached lock disagrees with a fresh compute. Writes use the cached one, so it is stale — tap “Refresh lock”.
          </Text>
        )}

        <View style={styles.hr} />
        <Text style={styles.subhead}>Local settings (what the lock reads)</Text>
        <Row k="isActive" v={String(s?.settings?.isActive)} />
        <Row k="subscriptionEnd" v={s?.settings?.subscriptionEnd || '(empty)'} />

        <View style={styles.hr} />
        <Text style={styles.subhead}>Server (what the next pull will write)</Text>
        <Row k="societies.is_active" v={s?.serverIsActive == null ? '—' : String(s.serverIsActive)} />
        <Row k="subscription_end_date" v={s?.serverEnd ?? '—'} />
        <Row k="⇒ server implies" v={serverLocked === null ? '—' : serverLocked ? 'LOCKED 🔒' : 'unlocked'} bad={!!serverLocked} />
        {drift && (
          <Text style={styles.alertText}>
            ⚠️ Local and server disagree. This is expected right after simulating a state — the next pull will overwrite local with the server value above.
          </Text>
        )}

        <View style={styles.rowBtns}>
          <Btn label="Reload" onPress={() => run('Reload', load)} />
          <Btn label="Refresh lock" onPress={() => run('Refresh lock', async () => { const l = await refreshLock(); say(`refreshLock() → ${l}`); })} />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Auto-reload on focus</Text>
          <Switch value={autoRefresh} onValueChange={setAutoRefresh} />
        </View>
      </Section>

      {/* -------------------------------------------- subscription simulator */}
      <Section title="Simulate subscription state" note="Writes local settings, then recomputes the lock. Expected result is shown on each row.">
        {SUB_STATES.map((st) => (
          <TouchableOpacity key={st.label} style={styles.simRow} onPress={() => setSub(st.label, st.patch)} disabled={!!busy}>
            <View style={{ flex: 1 }}>
              <Text style={styles.simLabel}>{st.label}</Text>
              <Text style={styles.simHint}>{st.hint}</Text>
            </View>
            <Text style={[styles.pill, st.expect ? styles.pillLocked : styles.pillOpen]}>
              {st.expect ? 'LOCKED' : 'open'}
            </Text>
          </TouchableOpacity>
        ))}
        <Btn label="Reset to server truth (pull now)" kind="blue" onPress={() =>
          run('Pull', async () => {
            const r = await pullAll();
            say(`pullAll → pulled=${r.pulled}${r.error ? ` error=${r.error}` : ''}`);
          })
        } />
      </Section>

      {/* ------------------------------------------------------ lock testing */}
      <Section title="Test the lock" note="Two layers: the guard() alert in screens, and assertUnlocked() inside db.ts writes.">
        <Btn label="Trigger the guard() alert" onPress={() => {
          // Exactly what every entry screen's save handler does: `if (!guard()) return;`
          const allowed = guard();
          say(`guard() → ${allowed ? 'true (save would proceed)' : 'false (blocked, alert shown)'}`);
          if (allowed) {
            Alert.alert('guard() returned true', 'The app is unlocked, so no alert is shown and the save proceeds. Simulate an EXPIRED state above, then press this again to see the real bilingual alert.');
          }
        }} />
        <Btn label="Probe EVERY guarded write (run while locked)" kind="amber" onPress={probeWrites} />
        <Text style={styles.note}>
          Attempts all {WRITES.length} write functions in db.ts and reports which ones ignore the lock. Junk rows are cleaned up afterwards.
        </Text>
      </Section>

      {/* -------------------------------------------------------------- sync */}
      <Section title="Sync">
        <Btn label="pushAll()" onPress={() => run('push', async () => {
          const r = await pushAll();
          say(`push → members=${r.pushedMembers} cols=${r.pushedCollections} payouts=${r.pushedPayouts} ledger=${r.pushedLedger} local=${r.pushedLocalSales} union=${r.pushedUnionSales}${r.error ? ` ERROR=${r.error}` : ''}`);
        })} />
        <Btn label="pullAll()" onPress={() => run('pull', async () => {
          const r = await pullAll();
          say(`pull → pulled=${r.pulled}${r.error ? ` ERROR=${r.error}` : ''}`);
        })} />
        <Btn label="Reset pull cursor (force full re-pull)" kind="blue" onPress={() => run('reset cursor', async () => {
          await AsyncStorage.removeItem('sync:lastPullAt');
          say('cleared sync:lastPullAt — next pull fetches everything');
        })} />
        <Btn label="Simulate offline (bad URL) — 1 call" kind="amber" onPress={() => run('offline', async () => {
          // Point a throwaway client at a dead host to see the exact error text
          // the sync bar would surface on a rural connection.
          try {
            const res = await fetch('https://10.255.255.1/rest/v1/members', { signal: AbortSignal.timeout(3000) });
            say(`unexpected response ${res.status}`);
          } catch (e: any) {
            say(`offline error looks like: "${e?.message}"`);
            Alert.alert('Offline error text', String(e?.message));
          }
        })} />
      </Section>

      {/* ------------------------------------------------------- local data */}
      <Section title="Local data" note="SQLite on this device only. Seeding writes real rows that WILL sync on the next push.">
        <Btn label="Seed 5 farmers + 10 collections" kind="blue" onPress={() => run('seed', async () => {
          if (isLockedNow()) return Alert.alert('Locked', 'Unlock first (pick an Active state) — seeding uses the same guarded writes.');
          const today = new Date().toISOString().slice(0, 10);
          for (let i = 1; i <= 5; i++) {
            await insertMember({ membercode: 9000 + i, name: `DEV Farmer ${i}`, mobile1: `90000000${i}${i}` });
          }
          for (let i = 0; i < 10; i++) {
            const code = 9001 + (i % 5);
            const weight = 5 + i, fat = 3.5 + (i % 5) * 0.2, rate = 30;
            await insertCollection({
              membercode: code, session: i % 2, collect_date: today, weight, fat,
              snf: 8.5, clr: 26, rate, price: weight * rate, kg_fat: (fat * weight) / 100,
              kg_snf: (8.5 * weight) / 100, deduction: 0, pay_price: weight * rate,
            });
          }
          say('seeded 5 farmers + 10 collections (membercode 9001-9005)');
        })} />
        <Btn label="Delete seeded DEV rows (9001-9005)" kind="amber" onPress={() => run('unseed', async () => {
          const db = await getDb();
          await db.runAsync(`DELETE FROM milk_collections WHERE membercode BETWEEN 9001 AND 9005`);
          await db.runAsync(`DELETE FROM members WHERE membercode BETWEEN 9001 AND 9005`);
          say('deleted local DEV rows — note: rows already pushed still exist on the server');
        })} />
        <Btn label="Mark everything unsynced (force re-push)" kind="blue" onPress={() => run('dirty', async () => {
          const db = await getDb();
          for (const t of ['members', 'milk_collections', 'payouts', 'ledger_entries', 'local_sales', 'union_sales']) {
            await db.runAsync(`UPDATE ${t} SET synced = 0`);
          }
          say('all rows marked synced=0');
        })} />
        <Btn label="WIPE local database" kind="red" onPress={() => {
          Alert.alert('Wipe local data?', 'Deletes every local row on this device. Anything not yet pushed is lost for good. Server data is untouched and comes back on the next pull.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Wipe', style: 'destructive', onPress: () => run('wipe', async () => {
              const db = await getDb();
              for (const t of ['milk_collections', 'payouts', 'ledger_entries', 'local_sales', 'union_sales', 'member_kapat', 'members', 'session_locks']) {
                await db.runAsync(`DELETE FROM ${t}`);
              }
              await AsyncStorage.removeItem('sync:lastPullAt');
              say('local DB wiped + pull cursor reset');
            }) },
          ]);
        }} />
        <Btn label="Reset settings to defaults" kind="amber" onPress={() => run('reset settings', async () => {
          await saveSettings(DEFAULT_SETTINGS);
          await refreshLock();
          say('settings reset to DEFAULT_SETTINGS');
        })} />
      </Section>

      {/* -------------------------------------------------------- navigation */}
      <Section title="Jump to a screen">
        <View style={styles.chips}>
          {['MilkCollection', 'Payout', 'MembersList', 'MemberForm', 'Ledger', 'LocalSales',
            'UnionSale', 'Inventory', 'RateChart', 'Kapat', 'Reports', 'DatewiseReport',
            'PaymentReport', 'CollectionHistory', 'Settings', 'Subscription'].map((r) => (
            <TouchableOpacity key={r} style={styles.chip} onPress={() => navigation.navigate(r)}>
              <Text style={styles.chipText}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.note}>
          With an EXPIRED state set, open any entry screen and press Save — you should get the bilingual “Subscription expired” alert instead of a saved row.
        </Text>
      </Section>

      {/* -------------------------------------------------------------- auth */}
      <Section title="Session">
        <Btn label="Sign out" kind="red" onPress={() => run('signout', async () => { await signOut(); })} />
      </Section>

      {/* --------------------------------------------------------------- log */}
      <Section title="Log">
        {log.length === 0 ? <Text style={styles.note}>Nothing yet.</Text> : null}
        {log.map((l, i) => <Text key={i} style={styles.logLine}>{l}</Text>)}
        {log.length > 0 && <Btn label="Clear log" onPress={() => setLog([])} />}
      </Section>

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.busyText}>{busy}…</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ bits
function Section({ title, note, children }: any) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {note ? <Text style={styles.cardNote}>{note}</Text> : null}
      {children}
    </View>
  );
}

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, bad && styles.vBad]} numberOfLines={1}>{v}</Text>
    </View>
  );
}

function Btn({ label, onPress, kind = 'grey' }: { label: string; onPress: () => void; kind?: 'grey' | 'blue' | 'red' | 'amber' }) {
  return (
    <TouchableOpacity style={[styles.btn, styles[`btn_${kind}` as const]]} onPress={onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0d1b2a' },
  warnBar: { backgroundColor: '#7a2f2f', borderRadius: 10, padding: 10, marginBottom: 12 },
  warnText: { color: '#ffd9d9', fontSize: 12, fontWeight: '700', lineHeight: 17 },
  card: { backgroundColor: '#152a3f', borderRadius: 12, padding: 14, marginBottom: 12 },
  cardTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 4 },
  cardNote: { color: '#8fa6bd', fontSize: 12, marginBottom: 10, lineHeight: 17 },
  subhead: { color: '#8fb', fontSize: 12, fontWeight: '800', marginBottom: 6, letterSpacing: 1 },
  hr: { height: 1, backgroundColor: '#24405c', marginVertical: 10 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 10 },
  k: { color: '#8fa6bd', fontSize: 12, flexShrink: 0 },
  v: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'right' },
  vBad: { color: '#ff8f8f' },
  alertText: { color: '#ffd479', fontSize: 12, marginTop: 8, lineHeight: 17 },
  simRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: '#24405c', paddingVertical: 10 },
  simLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  simHint: { color: '#8fa6bd', fontSize: 11, marginTop: 1 },
  pill: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  pillLocked: { backgroundColor: '#5c2020', color: '#ff9a9a' },
  pillOpen: { backgroundColor: '#1b4d38', color: '#7ee2b0' },
  btn: { borderRadius: 8, paddingVertical: 11, paddingHorizontal: 12, alignItems: 'center', marginTop: 8 },
  btn_grey: { backgroundColor: '#2c4763' },
  btn_blue: { backgroundColor: '#2a6fdb' },
  btn_red: { backgroundColor: '#c0392b' },
  btn_amber: { backgroundColor: '#b7791f' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  switchLabel: { color: '#8fa6bd', fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#2c4763', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6 },
  chipText: { color: '#cfe', fontSize: 11, fontWeight: '600' },
  note: { color: '#8fa6bd', fontSize: 11, marginTop: 8, lineHeight: 16 },
  logLine: { color: '#9fe', fontSize: 11, fontFamily: 'monospace', paddingVertical: 1 },
  busy: { position: 'absolute', bottom: 20, alignSelf: 'center', flexDirection: 'row', gap: 8, backgroundColor: '#000c', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  busyText: { color: '#fff', fontWeight: '700' },
});
