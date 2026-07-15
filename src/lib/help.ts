import { Alert } from 'react-native';

/**
 * Show a bilingual "what does this button do?" popup.
 * Wired to onLongPress of the main buttons so low-literacy users can press and
 * hold any action to learn what it does, in Hindi and English.
 *
 * @param titleEn short English name (e.g. "Milk Collection")
 * @param titleHi short Hindi name  (e.g. "दूध संग्रह")
 * @param bodyHi  one-line Hindi explanation (shown first — the primary language)
 * @param bodyEn  one-line English explanation
 */
export function showHelp(titleEn: string, titleHi: string, bodyHi: string, bodyEn: string) {
  Alert.alert(`${titleHi} · ${titleEn}`, `${bodyHi}\n\n${bodyEn}`, [{ text: 'ठीक है · OK' }]);
}
