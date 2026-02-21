import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SenseTheme, ThemeMode } from '../lib/theme';

interface JoinScreenProps {
  displayName: string;
  roomId: string;
  error: string | null;
  loading: boolean;
  theme: SenseTheme;
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  onThemeModeChange: (mode: ThemeMode) => void;
  onDisplayNameChange: (value: string) => void;
  onRoomIdChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
}

export const JoinScreen = ({
  displayName,
  roomId,
  error,
  loading,
  theme,
  themeMode,
  resolvedTheme,
  onThemeModeChange,
  onDisplayNameChange,
  onRoomIdChange,
  onCreateRoom,
  onJoinRoom,
}: JoinScreenProps) => {
  return (
    <View style={[styles.page, { backgroundColor: theme.colors.appBg }]}>
      <View style={[styles.heroBadge, { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panelMuted }]}>
        <Text style={[styles.heroBadgeText, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>
          Theme: {resolvedTheme.toUpperCase()}
        </Text>
        <View style={[styles.modeSwitcher, { borderColor: theme.colors.buttonBorder, backgroundColor: theme.colors.buttonBg }]}>
          <ModeChip label="Auto" value="auto" active={themeMode === 'auto'} theme={theme} onPress={onThemeModeChange} />
          <ModeChip label="Light" value="light" active={themeMode === 'light'} theme={theme} onPress={onThemeModeChange} />
          <ModeChip label="Dark" value="dark" active={themeMode === 'dark'} theme={theme} onPress={onThemeModeChange} />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.panel, borderColor: theme.colors.panelBorder }]}>
        <Text style={[styles.brand, { color: theme.colors.textPrimary, fontFamily: theme.fonts.heading }]}>SenseBoard</Text>
        <Text style={[styles.tagline, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>Your hang, illustrated live.</Text>

        <Text style={[styles.label, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={onDisplayNameChange}
          placeholder="Alex"
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            {
              borderColor: theme.colors.inputBorder,
              backgroundColor: theme.colors.inputBg,
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.body,
            },
          ]}
        />

        <Text style={[styles.label, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>Room code</Text>
        <TextInput
          value={roomId}
          onChangeText={(value) => onRoomIdChange(value.toUpperCase())}
          placeholder="ABC123"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="characters"
          style={[
            styles.input,
            {
              borderColor: theme.colors.inputBorder,
              backgroundColor: theme.colors.inputBg,
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.body,
            },
          ]}
        />

        {error ? <Text style={[styles.error, { color: theme.colors.danger, fontFamily: theme.fonts.body }]}>{error}</Text> : null}
        {loading ? <Text style={[styles.info, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>Contacting SenseBoard server...</Text> : null}

        <View style={styles.buttonRow}>
          <Pressable
            onPress={onCreateRoom}
            disabled={loading}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.colors.accent },
              pressed && styles.buttonPressed,
              loading && styles.buttonDisabled,
            ]}>
            <Text style={[styles.primaryButtonText, { color: theme.colors.accentText, fontFamily: theme.fonts.heading }]}>
              {loading ? 'Working...' : 'Create room'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onJoinRoom}
            disabled={loading}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: theme.colors.buttonBorder,
                backgroundColor: theme.colors.buttonBg,
              },
              pressed && styles.buttonPressed,
              loading && styles.buttonDisabled,
            ]}>
            <Text style={[styles.secondaryButtonText, { color: theme.colors.buttonText, fontFamily: theme.fonts.heading }]}>Join room</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const ModeChip = ({
  label,
  value,
  active,
  theme,
  onPress,
}: {
  label: string;
  value: ThemeMode;
  active: boolean;
  theme: SenseTheme;
  onPress: (mode: ThemeMode) => void;
}) => (
  <Pressable
    onPress={() => onPress(value)}
    style={({ pressed }) => [
      styles.modeChip,
      {
        borderColor: theme.colors.buttonBorder,
        backgroundColor: active ? theme.colors.accent : theme.colors.buttonBg,
      },
      pressed && styles.buttonPressed,
    ]}>
    <Text style={[styles.modeChipText, { color: active ? theme.colors.accentText : theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 14,
  },
  heroBadge: {
    width: '100%',
    maxWidth: 760,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0A2238',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  heroBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modeSwitcher: {
    borderWidth: 1,
    borderRadius: 999,
    padding: 3,
    flexDirection: 'row',
    gap: 4,
  },
  modeChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 56,
    alignItems: 'center',
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    width: '100%',
    maxWidth: 760,
    borderRadius: 24,
    borderWidth: 1,
    padding: 28,
    gap: 12,
    shadowColor: '#0A2238',
    shadowOpacity: 0.18,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
  },
  brand: {
    fontSize: 54,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  tagline: {
    fontSize: 19,
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  error: {
    fontSize: 14,
    marginTop: 4,
  },
  info: {
    fontSize: 13,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  buttonPressed: {
    opacity: 0.84,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
