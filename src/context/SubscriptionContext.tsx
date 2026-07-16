import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { refreshLock } from '../lib/subscription';

type SubscriptionState = {
  locked: boolean;
  refresh: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionState | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const appState = useRef(AppState.currentState);

  const refresh = useCallback(async () => {
    setLocked(await refreshLock());
  }, []);

  useEffect(() => {
    refresh();
    // A renewal lands via sync while the app is backgrounded, so re-check on
    // foreground rather than only at startup.
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') refresh();
      appState.current = next;
    });
    return () => sub.remove();
  }, [refresh]);

  return (
    <SubscriptionContext.Provider value={{ locked, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

/**
 * `guard()` returns false and explains why when the subscription has lapsed.
 * Call it at the top of any handler that changes business data:
 *
 *   if (!guard()) return;
 */
export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  const navigation = useNavigation<any>();

  const guard = useCallback((): boolean => {
    if (!ctx.locked) return true;
    Alert.alert(
      'Subscription expired 🔒',
      'सदस्यता समाप्त हो गई है। आप सब कुछ देख सकते हैं, पर नया डेटा नहीं जोड़ सकते।\n\n' +
        'Your subscription has expired. You can still view everything, but adding or changing data is locked until you renew.',
      [
        { text: 'Later · बाद में', style: 'cancel' },
        { text: 'Renew · नवीनीकरण', onPress: () => navigation.navigate('Subscription') },
      ]
    );
    return false;
  }, [ctx.locked, navigation]);

  return { locked: ctx.locked, refresh: ctx.refresh, guard };
}
