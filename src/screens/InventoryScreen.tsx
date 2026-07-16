import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { inventoryTotals } from '../lib/db';
import { showHelp } from '../lib/help';

export default function InventoryScreen({ navigation }: any) {
  const [inv, setInv] = useState({ collected: 0, unionSold: 0, localSold: 0, remaining: 0 });

  const load = useCallback(async () => {
    setInv(await inventoryTotals());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>बचा हुआ दूध · Milk Remaining</Text>
        <Text style={styles.heroValue}>{inv.remaining.toFixed(1)} <Text style={styles.heroUnit}>L</Text></Text>
      </View>

      <View style={styles.rows}>
        <Row icon="🥛" hi="कुल संग्रह" en="Collected" value={`+${inv.collected.toFixed(1)}`} />
        <Row icon="🏪" hi="स्थानीय बिक्री" en="Local Sale" value={`-${inv.localSold.toFixed(1)}`} />
        <Row icon="🏭" hi="यूनियन बिक्री" en="Union Sale" value={`-${inv.unionSold.toFixed(1)}`} />
        <Row icon="📦" hi="बचा हुआ" en="Remaining" value={inv.remaining.toFixed(1)} strong />
      </View>

      {/* Always shown — MilkCollection refuses the write itself when locked. */}
      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => navigation.navigate('MilkCollection', { prefillCode: '9999' })}
        onLongPress={() => showHelp('Add Stock', 'स्टॉक जोड़ें', 'बाहर से आया दूध भंडार में जोड़ें।', 'Add outside/opening milk to your inventory.')}
      >
        <Text style={styles.addText}>➕  स्टॉक जोड़ें · Add Stock</Text>
      </TouchableOpacity>
    </View>
  );
}

function Row({ icon, hi, en, value, strong }: { icon: string; hi: string; en: string; value: string; strong?: boolean }) {
  return (
    <View style={[styles.row, strong && styles.rowStrong]}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowHi, strong && styles.rowStrongText]}>{hi}</Text>
        <Text style={styles.rowEn}>{en}</Text>
      </View>
      <Text style={[styles.rowVal, strong && styles.rowStrongText]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7', padding: 16 },
  hero: { backgroundColor: '#0d7a86', borderRadius: 18, padding: 24, alignItems: 'center', marginBottom: 20 },
  heroLabel: { color: '#d5eef1', fontSize: 15, fontWeight: '700' },
  heroValue: { color: '#fff', fontSize: 56, fontWeight: '900', marginTop: 6 },
  heroUnit: { fontSize: 26, fontWeight: '800' },
  rows: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eef1f4' },
  rowStrong: { borderBottomWidth: 0 },
  rowIcon: { fontSize: 28, marginRight: 14 },
  rowHi: { fontSize: 18, fontWeight: '700', color: '#0d1b2a' },
  rowEn: { fontSize: 13, color: '#67788a', marginTop: 1 },
  rowVal: { fontSize: 22, fontWeight: '800', color: '#0d1b2a' },
  rowStrongText: { color: '#0d7a86' },
  addBtn: { backgroundColor: '#2a6fdb', borderRadius: 16, paddingVertical: 20, alignItems: 'center', marginTop: 24 },
  addText: { color: '#fff', fontSize: 18, fontWeight: '800' },
});
