import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { todayLocalSaleTotals, routineDayTotals, todayIST } from '../lib/db';

/**
 * The Local Sale button now leads here, because there are two different jobs
 * behind it: selling to whoever walks up, and delivering to the same customers
 * every morning. They need different screens but they are the same money.
 */
export default function LocalSaleHubScreen({ navigation }: any) {
  const [walkIn, setWalkIn] = useState({ quantity: 0, amount: 0, count: 0 });
  const [routine, setRoutine] = useState({ quantity: 0, amount: 0, count: 0 });

  useFocusEffect(useCallback(() => {
    todayLocalSaleTotals().then(setWalkIn);
    routineDayTotals(todayIST()).then(setRoutine);
  }, []));

  const totalLitres = walkIn.quantity + routine.quantity;
  const totalAmount = walkIn.amount + routine.amount;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.statsRow}>
        <View style={styles.stat}><Text style={styles.statVal}>{totalLitres.toFixed(1)}</Text><Text style={styles.statLbl}>Litres today</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>₹{totalAmount.toFixed(0)}</Text><Text style={styles.statLbl}>Amount today</Text></View>
      </View>

      <TouchableOpacity style={[styles.tile, { backgroundColor: '#d63031' }]} onPress={() => navigation.navigate('LocalSales')}>
        <Text style={styles.tileIcon}>🏪</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.tileEn}>Local Sale</Text>
          <Text style={styles.tileHi}>स्थानीय बिक्री</Text>
          <Text style={styles.tileDesc}>Sell to anyone who comes — cash now.</Text>
        </View>
        <View style={styles.tileStat}>
          <Text style={styles.tileStatVal}>{walkIn.count}</Text>
          <Text style={styles.tileStatLbl}>today</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.tile, { backgroundColor: '#00897b' }]} onPress={() => navigation.navigate('RoutineSale')}>
        <Text style={styles.tileIcon}>📋</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.tileEn}>Routine Sale</Text>
          <Text style={styles.tileHi}>रोज़ की बिक्री</Text>
          <Text style={styles.tileDesc}>Daily delivery to known customers — pay monthly.</Text>
        </View>
        <View style={styles.tileStat}>
          <Text style={styles.tileStatVal}>{routine.count}</Text>
          <Text style={styles.tileStatLbl}>today</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('RoutineCustomers')}>
        <Text style={styles.linkText}>👥 Routine customers & accounts</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('LocalSaleRate')}>
        <Text style={styles.linkText}>📋 Edit sale rates</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '800', color: '#d63031' },
  statLbl: { color: '#67788a', marginTop: 4, fontSize: 11 },
  tile: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, padding: 18, marginBottom: 14, gap: 14 },
  tileIcon: { fontSize: 40 },
  tileEn: { color: '#fff', fontWeight: '800', fontSize: 20 },
  tileHi: { color: '#fff', fontWeight: '700', fontSize: 15, opacity: 0.9, marginTop: 1 },
  tileDesc: { color: '#fff', fontSize: 12, opacity: 0.8, marginTop: 6, lineHeight: 16 },
  tileStat: { alignItems: 'center' },
  tileStatVal: { color: '#fff', fontWeight: '800', fontSize: 24 },
  tileStatLbl: { color: '#fff', fontSize: 10, opacity: 0.8 },
  link: { alignItems: 'center', marginTop: 12 },
  linkText: { color: '#2a6fdb', fontWeight: '700', fontSize: 14 },
});
