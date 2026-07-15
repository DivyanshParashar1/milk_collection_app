import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { getRateChart, setRateChart } from './src/lib/db';
import ErrorBoundary from './src/components/ErrorBoundary';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import MemberFormScreen from './src/screens/MemberFormScreen';
import MembersListScreen from './src/screens/MembersListScreen';
import MemberDetailScreen from './src/screens/MemberDetailScreen';
import MilkCollectionScreen from './src/screens/MilkCollectionScreen';
import CollectionHistoryScreen from './src/screens/CollectionHistoryScreen';
import CollectionEditScreen from './src/screens/CollectionEditScreen';
import PayoutScreen from './src/screens/PayoutScreen';
import RateChartScreen from './src/screens/RateChartScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import MemberPassbookScreen from './src/screens/MemberPassbookScreen';
import LocalSalesScreen from './src/screens/LocalSalesScreen';
import LocalSaleRateScreen from './src/screens/LocalSaleRateScreen';
import KapatScreen from './src/screens/KapatScreen';
import DatewiseReportScreen from './src/screens/DatewiseReportScreen';
import UnionSaleScreen from './src/screens/UnionSaleScreen';
import PaymentReportScreen from './src/screens/PaymentReportScreen';
import SuperAdminScreen from './src/screens/SuperAdminScreen';
import InventoryScreen from './src/screens/InventoryScreen';

const Stack = createNativeStackNavigator();
const green = '#1b9c66';

// Seed a starter fat→rate chart on first run so the calculator works immediately.
// (Later this comes from the "Rate chart" screen / server sync.)
async function seedRateChart() {
  const existing = await getRateChart();
  if (existing.length > 0) return;
  const entries: { fat: number; rate: number }[] = [];
  for (let fat = 3.0; fat <= 9.0 + 1e-9; fat += 0.1) {
    const f = Math.round(fat * 10) / 10;
    entries.push({ fat: f, rate: Math.round(f * 8 * 100) / 100 }); // ~₹8 per fat point
  }
  await setRateChart(entries);
}

function Root() {
  const { session, loading } = useAuth();
  const appState = useRef(AppState.currentState);

  // P0.3 — silent background sync every time the app comes to foreground
  useEffect(() => {
    if (!session) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        import('./src/lib/sync').then(({ pushAll, pullAll }) => {
          pushAll().then(() => pullAll()).catch(() => {});
        });
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [session]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={green} /></View>;
  }
  
  const isSuperAdmin = session?.user?.email === '8824753192@milkapp.local';

  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: green }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '800' } }}>
      {!session ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : isSuperAdmin ? (
        <Stack.Screen name="SuperAdmin" component={SuperAdminScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: '🥛 Neerja Milk Collection' }} />
          <Stack.Screen name="MilkCollection" component={MilkCollectionScreen} options={{ title: 'Milk Collection · दूध' }} />
          <Stack.Screen name="CollectionHistory" component={CollectionHistoryScreen} options={{ title: 'Entries · edit' }} />
          <Stack.Screen name="CollectionEdit" component={CollectionEditScreen} options={{ title: 'Edit entry' }} />
          <Stack.Screen name="Payout" component={PayoutScreen} options={{ title: 'Pay Farmer · भुगतान' }} />
          <Stack.Screen name="MembersList" component={MembersListScreen} options={{ title: 'Farmers · किसान' }} />
          <Stack.Screen name="MemberDetail" component={MemberDetailScreen} options={{ title: 'Farmer' }} />
          <Stack.Screen name="MemberForm" component={MemberFormScreen} options={{ title: 'Add Farmer · किसान' }} />
          <Stack.Screen name="RateChart" component={RateChartScreen} options={{ title: 'Rate Chart · रेट' }} />
          <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports · रिपोर्ट' }} />
          <Stack.Screen name="Inventory" component={InventoryScreen} options={{ title: 'Inventory · भंडार' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings · सेटिंग' }} />
          <Stack.Screen name="Subscription" component={SubscriptionScreen} options={{ title: 'Subscription' }} />
          <Stack.Screen name="Ledger" component={LedgerScreen} options={{ title: 'Ledger · जमा/उधार' }} />
          <Stack.Screen name="MemberPassbook" component={MemberPassbookScreen} options={{ title: 'Passbook · खाता' }} />
          <Stack.Screen name="LocalSales" component={LocalSalesScreen} options={{ title: 'Local Sale · बिक्री' }} />
          <Stack.Screen name="LocalSaleRate" component={LocalSaleRateScreen} options={{ title: 'Sale Rates · दर' }} />
          <Stack.Screen name="Kapat" component={KapatScreen} options={{ title: 'Deductions · कपात' }} />
          <Stack.Screen name="DatewiseReport" component={DatewiseReportScreen} options={{ title: 'Datewise · तारीखवार' }} />
          <Stack.Screen name="UnionSale" component={UnionSaleScreen} options={{ title: 'Union Sale · यूनियन' }} />
          <Stack.Screen name="PaymentReport" component={PaymentReportScreen} options={{ title: 'Payment Report · बिल' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  useEffect(() => { seedRateChart().catch(() => {}); }, []);
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <NavigationContainer>
            <StatusBar style="light" />
            <Root />
          </NavigationContainer>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d1b2a' },
});
