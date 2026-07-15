import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { todayTotals, pendingCount } from '../lib/db';
import { pushAll, pullAll } from '../lib/sync';

// Big, icon-first actions with Hindi labels for low-literacy users.
const TILES: { en: string; hi: string; icon: string; route: string; color: string }[] = [
  { en: 'Milk Collection', hi: 'दूध संग्रह', icon: '🥛', route: 'MilkCollection', color: '#1b9c66' },
  { en: 'Pay Farmer', hi: 'भुगतान', icon: '💰', route: 'Payout', color: '#2a6fdb' },
  { en: 'Farmers', hi: 'किसान', icon: '👨‍🌾', route: 'MembersList', color: '#e0821b' },
  { en: 'Ledger', hi: 'जमा/उधार', icon: '📒', route: 'Ledger', color: '#6c5ce7' },
  { en: 'Local Sale', hi: 'स्थानीय बिक्री', icon: '🏪', route: 'LocalSales', color: '#d63031' },
  { en: 'Union Sale', hi: 'यूनियन बिक्री', icon: '🏭', route: 'UnionSale', color: '#5f27cd' },
  { en: 'Rate Chart', hi: 'रेट चार्ट', icon: '📋', route: 'RateChart', color: '#c0392b' },
  { en: 'Deductions', hi: 'कपात', icon: '✂️', route: 'Kapat', color: '#8a3ffc' },
  { en: 'Reports', hi: 'रिपोर्ट', icon: '📊', route: 'Reports', color: '#0d7a86' },
  { en: 'Subscription', hi: 'सदस्यता', icon: '⭐', route: 'Subscription', color: '#fdcb6e' },
];

export default function HomeScreen({ navigation }: any) {
  const { signOut } = useAuth();
  const [totals, setTotals] = useState({ litres: 0, amount: 0, count: 0 });
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setTotals(await todayTotals());
    setPending(await pendingCount());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const doSync = async () => {
    setSyncing(true);
    try {
      const r = await pushAll();
      if (r.error) { Alert.alert('Push failed', r.error); await load(); setSyncing(false); return; }
      const p = await pullAll();
      if (p.error) Alert.alert('Pull warning', p.error);
      const pushed = r.pushedMembers + r.pushedCollections + r.pushedPayouts + r.pushedLedger + r.pushedLocalSales + r.pushedUnionSales;
      Alert.alert('Synced ✓', `⬆️ ${pushed} pushed · ⬇️ ${p.pulled} pulled`);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Today · आज</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} hitSlop={10}><Text style={styles.gear}>⚙️</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => signOut()} hitSlop={10}><Text style={styles.signout}>Exit</Text></TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat label="Litres · लीटर" value={totals.litres.toFixed(1)} />
        <Stat label="₹ Amount" value={totals.amount.toFixed(0)} />
        <Stat label="Entries" value={String(totals.count)} />
      </View>

      <TouchableOpacity style={[styles.syncBar, pending > 0 ? styles.syncPending : styles.syncClean]} onPress={doSync} disabled={syncing}>
        {syncing ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.syncText}>
            {pending > 0 ? `⬆︎  Upload ${pending} pending` : '✓  All saved online'}
          </Text>
        )}
      </TouchableOpacity>

      <View style={styles.grid}>
        {TILES.map((t) => (
          <TouchableOpacity key={t.route} style={[styles.tile, { backgroundColor: t.color }]} onPress={() => navigation.navigate(t.route)} activeOpacity={0.85}>
            <Text style={styles.tileIcon}>{t.icon}</Text>
            <Text style={styles.tileEn}>{t.en}</Text>
            <Text style={styles.tileHi}>{t.hi}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', color: '#0d1b2a' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  gear: { fontSize: 22 },
  signout: { color: '#c0392b', fontWeight: '700', fontSize: 16 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800', color: '#1b9c66' },
  statLabel: { color: '#67788a', marginTop: 4, fontSize: 12, textAlign: 'center' },
  syncBar: { borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 20 },
  syncPending: { backgroundColor: '#e08e0b' },
  syncClean: { backgroundColor: '#1b9c66' },
  syncText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%', borderRadius: 18, padding: 20, minHeight: 140, justifyContent: 'center', alignItems: 'center' },
  tileIcon: { fontSize: 46 },
  tileEn: { color: '#fff', fontWeight: '800', fontSize: 17, marginTop: 8 },
  tileHi: { color: '#eef7f2', fontSize: 15, marginTop: 2 },
});
