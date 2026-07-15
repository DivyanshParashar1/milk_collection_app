import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { collectionHistory } from '../lib/db';

export default function CollectionHistoryScreen({ navigation }: any) {
  const [rows, setRows] = useState<any[]>([]);

  useFocusEffect(useCallback(() => { collectionHistory(150).then(setRows); }, []));

  return (
    <View style={styles.wrap}>
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.local_id)}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={<Text style={styles.empty}>No collections yet</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('CollectionEdit', { localId: item.local_id })}>
            <View style={styles.left}>
              <Text style={styles.name}>{item.name ?? `#${item.membercode}`}</Text>
              <Text style={styles.meta}>#{item.membercode} · {item.collect_date} · {item.session === 0 ? 'AM' : 'PM'}</Text>
            </View>
            <View style={styles.mid}><Text style={styles.midText}>{item.weight}L</Text><Text style={styles.midSub}>{item.fat}%</Text></View>
            <View style={styles.right}>
              <Text style={styles.amt}>₹{Number(item.price).toFixed(0)}</Text>
              <Text style={item.synced ? styles.dotOk : styles.dotPending}>{item.synced ? '● synced' : '● pending'}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  empty: { textAlign: 'center', color: '#8a97a6', marginTop: 40 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8 },
  left: { flex: 1.5 },
  name: { fontSize: 16, fontWeight: '700', color: '#0d1b2a' },
  meta: { color: '#8a97a6', fontSize: 12, marginTop: 2 },
  mid: { flex: 0.8, alignItems: 'center' },
  midText: { fontWeight: '700', color: '#2a6fdb' },
  midSub: { color: '#67788a', fontSize: 12 },
  right: { alignItems: 'flex-end', flex: 1 },
  amt: { fontWeight: '800', color: '#1b9c66', fontSize: 16 },
  dotOk: { color: '#1b9c66', fontSize: 11, marginTop: 2 },
  dotPending: { color: '#e08e0b', fontSize: 11, marginTop: 2 },
});
