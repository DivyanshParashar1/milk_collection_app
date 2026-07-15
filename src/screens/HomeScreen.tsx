import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, RefreshControl, Modal, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPPORT_PHONE = '7737115459';
const LAST_SYNC_KEY = 'last_sync_time';
import { useAuth } from '../context/AuthContext';
import { getSettings } from '../lib/settings';
import { todayTotals, pendingCount } from '../lib/db';
import { pushAll, pullAll } from '../lib/sync';
import { showHelp } from '../lib/help';

// Big, icon-first actions with Hindi labels for low-literacy users.
// descHi / descEn power the long-press "what does this do?" popup.
type Tile = { en: string; hi: string; icon: string; route: string; color: string; entry?: boolean; descHi: string; descEn: string };
const TILES: Tile[] = [
  { en: 'Milk Collection', hi: 'दूध संग्रह', icon: '🥛', route: 'MilkCollection', color: '#1b9c66', entry: true, descHi: 'किसान का दूध तौलें और दर्ज करें।', descEn: "Weigh a farmer's milk and save the entry." },
  { en: 'Pay Farmer', hi: 'भुगतान', icon: '💰', route: 'Payout', color: '#2a6fdb', entry: true, descHi: 'किसान को पैसे का भुगतान करें।', descEn: 'Pay money to a farmer.' },
  { en: 'Farmers', hi: 'किसान', icon: '👨‍🌾', route: 'MembersList', color: '#e0821b', descHi: 'किसानों की सूची देखें और नया जोड़ें।', descEn: 'View the farmer list and add new farmers.' },
  { en: 'Ledger', hi: 'जमा/उधार', icon: '📒', route: 'Ledger', color: '#6c5ce7', entry: true, descHi: 'जमा और उधार का हिसाब रखें।', descEn: 'Track deposits (jama) and credit (udhar).' },
  { en: 'Local Sale', hi: 'स्थानीय बिक्री', icon: '🏪', route: 'LocalSales', color: '#d63031', entry: true, descHi: 'गाँव में सीधे ग्राहक को दूध बेचें।', descEn: 'Sell milk directly to local customers.' },
  { en: 'Union Sale', hi: 'यूनियन बिक्री', icon: '🏭', route: 'UnionSale', color: '#5f27cd', entry: true, descHi: 'डेयरी यूनियन को दूध बेचें।', descEn: 'Sell milk to the dairy union.' },
  { en: 'Inventory', hi: 'भंडार', icon: '📦', route: 'Inventory', color: '#0d7a86', descHi: 'कितना दूध बचा है देखें और स्टॉक जोड़ें।', descEn: 'See how much milk is left and add stock.' },
  { en: 'Rate Chart', hi: 'रेट चार्ट', icon: '📋', route: 'RateChart', color: '#c0392b', descHi: 'फैट के अनुसार दूध की दर देखें।', descEn: 'See milk rates by fat / SNF.' },
  { en: 'Deductions', hi: 'कपात', icon: '✂️', route: 'Kapat', color: '#8a3ffc', descHi: 'कटौती जोड़ें या बदलें।', descEn: 'Add or change deductions.' },
  { en: 'Reports', hi: 'रिपोर्ट', icon: '📊', route: 'Reports', color: '#0d7a86', descHi: 'दूध और पैसे की रिपोर्ट देखें।', descEn: 'View milk and payment reports.' },
  { en: 'Subscription', hi: 'सदस्यता', icon: '⭐', route: 'Subscription', color: '#fdcb6e', descHi: 'ऐप की सदस्यता और नवीनीकरण।', descEn: 'App subscription and renewal.' },
];

export default function HomeScreen({ navigation }: any) {
  const { signOut } = useAuth();
  const [totals, setTotals] = useState({ litres: 0, amount: 0, count: 0 });
  const [subStatus, setSubStatus] = useState<'ok' | 'locked_entry' | 'locked_all'>('ok');
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Three-dot menu button next to the app name in the top bar.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={12} style={{ paddingHorizontal: 4 }}>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900' }}>⋮</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const load = useCallback(async () => {
    setTotals(await todayTotals());
    setPending(await pendingCount());
    const saved = await AsyncStorage.getItem(LAST_SYNC_KEY);
    setLastSync(saved);

    const s = await getSettings();
    if (s.isActive === false) {
      setSubStatus('locked_all');
    } else if (s.subscriptionEnd) {
      const end = new Date(s.subscriptionEnd).getTime();
      const now = Date.now();
      if (now > end) {
        const daysExpired = (now - end) / (1000 * 3600 * 24);
        if (daysExpired > 10) setSubStatus('locked_all');
        else setSubStatus('locked_entry');
      } else {
        setSubStatus('ok');
      }
    } else {
      setSubStatus('ok');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const doSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const r = await pushAll();
      if (r.error) { setSyncError(r.error); await load(); setSyncing(false); return; }
      const p = await pullAll();
      if (p.error) setSyncError(p.error);
      const pushed = r.pushedMembers + r.pushedCollections + r.pushedPayouts + r.pushedLedger + r.pushedLocalSales + r.pushedUnionSales;
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      await AsyncStorage.setItem(LAST_SYNC_KEY, now);
      setLastSync(now);
      if (!p.error) Alert.alert('Synced ✓', `⬆️ ${pushed} pushed · ⬇️ ${p.pulled} pulled`);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  if (subStatus === 'locked_all') {
    return (
      <View style={[styles.wrap, { justifyContent: 'center', padding: 24 }]}>
        <Text style={{ fontSize: 60, textAlign: 'center' }}>🔒</Text>
        <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#c0392b', textAlign: 'center', marginTop: 16 }}>Subscription Expired</Text>
        <Text style={{ fontSize: 16, color: '#4a5a6a', textAlign: 'center', marginTop: 8, marginBottom: 32 }}>Please renew your subscription to continue using Neerja Milk Collection.</Text>
        <TouchableOpacity style={{ backgroundColor: '#1b9c66', padding: 16, borderRadius: 12, alignItems: 'center' }} onPress={() => navigation.navigate('Subscription')}>
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>View Subscription Options</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 24, padding: 16, alignItems: 'center' }} onPress={signOut}>
          <Text style={{ color: '#0d1b2a', fontWeight: 'bold', fontSize: 16 }}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={[styles.title, { marginBottom: 16 }]}>Today · आज</Text>

      {subStatus === 'locked_entry' && (
        <View style={{ backgroundColor: '#fcebe9', padding: 12, borderRadius: 10, marginBottom: 16 }}>
          <Text style={{ color: '#c0392b', fontWeight: 'bold' }}>⚠️ Subscription Expired</Text>
          <Text style={{ color: '#c0392b', fontSize: 12, marginTop: 4 }}>Data entry is blocked. You have limited time to view reports before full lockout. Renew now.</Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <Stat label="Litres · लीटर" value={totals.litres.toFixed(1)} />
        <Stat label="₹ Amount · रकम" value={totals.amount.toFixed(0)} />
        <Stat label="Entries · प्रविष्टि" value={String(totals.count)} />
      </View>

      <TouchableOpacity
        style={[styles.syncBar, syncError ? styles.syncError : pending > 0 ? styles.syncPending : styles.syncClean]}
        onPress={doSync}
        onLongPress={() => showHelp('Sync', 'अपलोड', 'सारा डेटा ऑनलाइन सुरक्षित करें।', 'Upload and back up all your data online.')}
        disabled={syncing}
      >
        {syncing ? <ActivityIndicator color="#fff" /> : (
          <>
            <Text style={styles.syncText}>
              {syncError ? `⚠ Error — tap to retry` : pending > 0 ? `⬆︎  Upload ${pending} pending` : '✓  All saved online'}
            </Text>
            {lastSync && !syncError && (
              <Text style={styles.syncSub}>Last sync: {lastSync}</Text>
            )}
          </>
        )}
      </TouchableOpacity>

      <View style={styles.grid}>
        {TILES.map((t) => {
          const isBlocked = subStatus === 'locked_entry' && t.entry;
          return (
            <TouchableOpacity
              key={t.route}
              style={[styles.tile, { backgroundColor: isBlocked ? '#9aa' : t.color }]}
              onPress={() => !isBlocked && navigation.navigate(t.route)}
              onLongPress={() => showHelp(t.en, t.hi, t.descHi, t.descEn)}
              activeOpacity={0.85}
            >
              <Text style={styles.tileIcon}>{t.icon}</Text>
              <Text style={styles.tileEn}>{t.en}</Text>
              <Text style={styles.tileHi}>{t.hi}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.hint}>दबाकर रखें = मदद · Press & hold any button for help</Text>
    </ScrollView>

    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
      <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
        <View style={styles.menuCard}>
          <MenuItem icon="⚙️" label="Settings · सेटिंग" onPress={() => { setMenuOpen(false); navigation.navigate('Settings'); }} />
          <MenuItem icon="📞" label="Contact us · संपर्क" onPress={() => { setMenuOpen(false); Linking.openURL(`tel:${SUPPORT_PHONE}`); }} />
          <View style={styles.menuDivider} />
          <MenuItem icon="🚪" label="Sign out · लॉग आउट" onPress={() => {
            setMenuOpen(false);
            Alert.alert(
              'Sign out? / लॉग आउट?',
              'Make sure you have synced before signing out. / लॉग आउट से पहले सिंक करें।',
              [
                { text: 'Cancel / रद्द', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: signOut },
              ]
            );
          }} />
        </View>
      </TouchableOpacity>
    </Modal>
    </>
  );
}

function MenuItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={styles.menuLabel}>{label}</Text>
    </TouchableOpacity>
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
  syncBar: { borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 20 },
  syncPending: { backgroundColor: '#e08e0b' },
  syncClean: { backgroundColor: '#1b9c66' },
  syncError: { backgroundColor: '#c0392b' },
  syncText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  syncSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '48%', borderRadius: 16, padding: 16, alignItems: 'center' },
  tileIcon: { fontSize: 32, marginBottom: 8 },
  tileEn: { color: '#fff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  tileHi: { color: '#fff', opacity: 0.8, fontSize: 12, marginTop: 4 },
  hint: { textAlign: 'center', color: '#8a97a5', fontSize: 12, marginTop: 20 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.12)' },
  menuCard: { position: 'absolute', top: 96, right: 10, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 6, minWidth: 220, elevation: 8, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18 },
  menuIcon: { fontSize: 20, marginRight: 14 },
  menuLabel: { fontSize: 16, fontWeight: '700', color: '#0d1b2a' },
  menuDivider: { height: 1, backgroundColor: '#eef1f4', marginVertical: 2 },
});
