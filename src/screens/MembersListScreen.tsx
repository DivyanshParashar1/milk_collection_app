import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { membersWithBalances } from '../lib/db';

export default function MembersListScreen({ navigation }: any) {
  const [members, setMembers] = useState<any[]>([]);
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      membersWithBalances().then(setMembers);
    }, [])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = members.filter((m) => m.membercode !== 9999);
    if (!q) return visible;
    return visible.filter(
      (m) => String(m.membercode).startsWith(q) || (m.name ?? '').toLowerCase().includes(q)
    );
  }, [members, query]);

  return (
    <View style={styles.wrap}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.search}
          placeholder="Search by code or name…"
          placeholderTextColor="#9aa"
          value={query}
          onChangeText={setQuery}
        />
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('MemberForm')}>
          <Text style={styles.addText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(m) => String(m.membercode)}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={
          <Text style={styles.empty}>{members.length ? 'No match' : 'No farmers yet. Tap "+ Add".'}</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('MemberDetail', { membercode: item.membercode })}>
            <View style={styles.codeBadge}><Text style={styles.codeText}>{item.membercode}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              {!!item.mobile1 && <Text style={styles.mobile}>{item.mobile1}</Text>}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.balance, { color: Number(item.balance) >= 0 ? '#1b9c66' : '#c0392b' }]}>{Number(item.balance) >= 0 ? '' : '−'}₹{Math.abs(Number(item.balance)).toFixed(0)}</Text>
              <Text style={styles.balanceLbl}>{Number(item.balance) >= 0 ? 'to pay' : 'owes'}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  searchBar: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e9ee' },
  search: { flex: 1, backgroundColor: '#f3f5f7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: '#111' },
  addBtn: { backgroundColor: '#1b9c66', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  addText: { color: '#fff', fontWeight: '800' },
  empty: { textAlign: 'center', color: '#8a97a6', marginTop: 40, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8 },
  codeBadge: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#eef4ff', alignItems: 'center', justifyContent: 'center' },
  codeText: { color: '#2a6fdb', fontWeight: '800', fontSize: 16 },
  name: { fontSize: 17, fontWeight: '700', color: '#0d1b2a' },
  mobile: { color: '#67788a', marginTop: 2 },
  balance: { fontSize: 18, fontWeight: '800', color: '#1b9c66' },
  balanceLbl: { color: '#8a97a6', fontSize: 11 },
});
