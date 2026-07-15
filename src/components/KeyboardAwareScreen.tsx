import React from 'react';
import { ScrollView, ScrollViewProps } from 'react-native';

/**
 * Drop-in replacement for <ScrollView> on data-entry screens that keeps the
 * focused TextInput visible when the keyboard opens — so villagers always see
 * the field they are typing in.
 *
 * - iOS: `automaticallyAdjustKeyboardInsets` insets the content and scrolls the
 *   focused input into view.
 * - Android: app.json `android.softwareKeyboardLayoutMode: "resize"` shrinks the
 *   window, so this ScrollView scrolls the focused input into view.
 *
 * Any props passed (style, contentContainerStyle, refreshControl, children, …)
 * are forwarded, and can override the keyboard defaults below.
 */
export default function KeyboardAwareScreen(props: ScrollViewProps) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      {...props}
    />
  );
}
