import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '../../stores/toast';
import { useTheme, type Palette } from '../../theme';

/* ---------- 텍스트 ---------- */

type TextVariant = 'display' | 'title' | 'h2' | 'body' | 'bodyStrong' | 'caption' | 'small';

const TEXT_SIZES: Record<TextVariant, TextStyle> = {
  display: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' },
  h2: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15 },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 13 },
  small: { fontSize: 12 },
};

export function T({
  children,
  variant = 'body',
  muted,
  color,
  style,
  numberOfLines,
  testID,
}: {
  children: ReactNode;
  variant?: TextVariant;
  muted?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      style={[TEXT_SIZES[variant], { color: color ?? (muted ? c.subtext : c.text) }, style]}
    >
      {children}
    </Text>
  );
}

/* ---------- 화면 ---------- */

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  padded = true,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  padded?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  const content = padded ? { padding: 16, gap: 16 } : undefined;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} testID={testID}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[content, { paddingBottom: 32 }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, content]}>{children}</View>
      )}
      {footer ? <FixedBar>{footer}</FixedBar> : null}
    </View>
  );
}

export function FixedBar({ children }: { children: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        backgroundColor: c.bg,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom, 12),
        gap: 6,
      }}
    >
      {children}
    </View>
  );
}

export function Row({
  children,
  gap = 8,
  style,
  wrap,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap },
        wrap && { flexWrap: 'wrap' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Section({
  title,
  right,
  children,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      {title ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="h2">{title}</T>
          {right}
        </Row>
      ) : null}
      {children}
    </View>
  );
}

export function Card({
  children,
  onPress,
  style,
  testID,
  tone = 'surface',
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  tone?: 'surface' | 'outline' | 'muted';
}) {
  const c = useTheme();
  const base: ViewStyle = {
    borderRadius: 14,
    padding: 14,
    gap: 6,
    backgroundColor: tone === 'outline' ? c.bg : c.surface,
    borderWidth: tone === 'outline' ? 1 : 0,
    borderColor: c.border,
    opacity: tone === 'muted' ? 0.55 : 1,
  };
  if (!onPress) {
    return (
      <View style={[base, style]} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { opacity: 0.8 }, style]}
    >
      {children}
    </Pressable>
  );
}

export function Divider() {
  const c = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

/* ---------- 버튼 ---------- */

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  small,
  testID,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const colors: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.primary, fg: c.primaryText, border: c.primary },
    secondary: { bg: c.bg, fg: c.text, border: c.border },
    ghost: { bg: 'transparent', fg: c.primary, border: 'transparent' },
    danger: { bg: c.red, fg: '#FFFFFF', border: c.red },
  };
  const k = colors[kind];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: small ? 36 : 50,
          paddingHorizontal: small ? 12 : 18,
          borderRadius: small ? 10 : 12,
          backgroundColor: k.bg,
          borderWidth: 1,
          borderColor: k.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={k.fg} size="small" /> : null}
      <Text style={{ color: k.fg, fontSize: small ? 14 : 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function LinkText({
  label,
  onPress,
  testID,
  color,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  color?: string;
}) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} testID={testID} hitSlop={8}>
      <Text style={{ color: color ?? c.primary, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/* ---------- 배지·칩 ---------- */

export type Tone = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'primary';

const toneColors = (c: Palette, tone: Tone) =>
  ({
    gray: { bg: c.graySoft, fg: c.gray },
    blue: { bg: c.blueSoft, fg: c.blue },
    green: { bg: c.greenSoft, fg: c.green },
    yellow: { bg: c.yellowSoft, fg: c.yellow },
    red: { bg: c.redSoft, fg: c.red },
    primary: { bg: c.primarySoft, fg: c.primary },
  })[tone];

export function Badge({
  label,
  tone = 'gray',
  onPress,
  testID,
}: {
  label: string;
  tone?: Tone;
  onPress?: () => void;
  testID?: string;
}) {
  const c = useTheme();
  const t = toneColors(c, tone);
  const body = (
    <View
      style={{ backgroundColor: t.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}
    >
      <Text style={{ color: t.fg, fontSize: 12, fontWeight: '600' }}>
        {label}
        {onPress ? ' ▾' : ''}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} hitSlop={6}>
      {body}
    </Pressable>
  ) : (
    <View testID={testID}>{body}</View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? c.primary : c.border,
        backgroundColor: selected ? c.primarySoft : c.bg,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: selected ? c.primary : c.text, fontSize: 14, fontWeight: '500' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: { value: V; label: string }[];
  value: V | null;
  onChange: (v: V) => void;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: 10, padding: 3 }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: 8,
              alignItems: 'center',
              backgroundColor: on ? c.bg : 'transparent',
            }}
          >
            <Text style={{ color: on ? c.text : c.subtext, fontWeight: on ? '700' : '500' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CheckRow({
  label,
  checked,
  onToggle,
  right,
  strong,
  testID,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  right?: ReactNode;
  strong?: boolean;
  testID?: string;
  disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', opacity: disabled ? 0.5 : 1 }}>
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: !!disabled }}
        disabled={disabled}
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingVertical: 8 }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: checked ? c.primary : c.border,
            backgroundColor: checked ? c.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {checked ? (
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>✓</Text>
          ) : null}
        </View>
        <Text
          style={{
            color: c.text,
            fontSize: strong ? 17 : 15,
            fontWeight: strong ? '700' : '400',
            flex: 1,
          }}
        >
          {label}
        </Text>
      </Pressable>
      {right}
    </Row>
  );
}

export function RadioRow({
  label,
  sub,
  selected,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? c.primary : c.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? c.primary : c.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong">{label}</T>
        {sub ? (
          <T variant="caption" muted>
            {sub}
          </T>
        ) : null}
      </View>
    </Pressable>
  );
}

/* ---------- 입력 ---------- */

export function Field({
  label,
  error,
  hint,
  success,
  children,
}: {
  label?: string;
  error?: string | null;
  hint?: string | null;
  success?: string | null;
  children: ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <T variant="caption">{label}</T> : null}
      {children}
      {error ? (
        <T variant="caption" color={c.red}>
          {error}
        </T>
      ) : success ? (
        <T variant="caption" color={c.green}>
          {success}
        </T>
      ) : hint ? (
        <T variant="caption" muted>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export function Input(props: TextInputProps & { invalid?: boolean }) {
  const c = useTheme();
  const { invalid, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={c.subtext}
      {...rest}
      style={[
        {
          borderWidth: 1,
          borderColor: invalid ? c.red : c.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 11,
          fontSize: 16,
          color: c.text,
          backgroundColor: rest.editable === false ? c.surface : c.bg,
        },
        style,
      ]}
    />
  );
}

/** 시·분·초 3칸 (PRD 4.4) */
export function DurationInput({
  value,
  onChange,
  invalid,
  testID,
}: {
  value: { h: string; m: string; s: string };
  onChange: (v: { h: string; m: string; s: string }) => void;
  invalid?: boolean;
  testID?: string;
}) {
  const box = (key: 'h' | 'm' | 's', unit: string) => (
    <Row gap={4} style={{ flex: 1, minWidth: 0 }}>
      <Input
        testID={testID ? `${testID}-${key}` : undefined}
        value={value[key]}
        onChangeText={(t) => onChange({ ...value, [key]: t.replace(/\D/g, '').slice(0, 2) })}
        keyboardType="number-pad"
        maxLength={2}
        placeholder="0"
        invalid={invalid}
        style={{ flex: 1, minWidth: 0, width: '100%', textAlign: 'center' }}
        accessibilityLabel={unit}
      />
      <T muted>{unit}</T>
    </Row>
  );
  return (
    <Row gap={10}>
      {box('h', '시간')}
      {box('m', '분')}
      {box('s', '초')}
    </Row>
  );
}

/* ---------- 상태 ---------- */

export function Skeleton({
  height = 14,
  width = '100%',
}: {
  height?: number;
  width?: ViewStyle['width'];
}) {
  const c = useTheme();
  return (
    <View
      accessibilityLabel="불러오는 중"
      style={{ height, width, borderRadius: 6, backgroundColor: c.surfaceStrong }}
    />
  );
}

export function SkeletonCards({ count = 3, height = 88 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: 10 }} testID="skeleton">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  compact,
}: {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: compact ? 12 : 32,
        flex: compact ? undefined : 1,
      }}
    >
      <T muted style={{ textAlign: 'center' }}>
        {message}
      </T>
      {onRetry ? <Button small kind="secondary" label="다시 시도" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 32, paddingHorizontal: 16 }}>
      <T muted style={{ textAlign: 'center' }}>
        {message}
      </T>
      {action}
    </View>
  );
}

export function Notice({ children, tone = 'gray' }: { children: ReactNode; tone?: Tone }) {
  const c = useTheme();
  const t = toneColors(c, tone);
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: 10, padding: 12, gap: 4 }}>
      {typeof children === 'string' ? (
        <T variant="caption" color={tone === 'gray' ? c.subtext : t.fg}>
          {children}
        </T>
      ) : (
        children
      )}
    </View>
  );
}

/* ---------- 시트·다이얼로그 ---------- */

/**
 * 닫힘을 한 틱 늦춘다. react-native-web에서 누르고 있는 Pressable이 같은 이벤트 안에서 언마운트되면
 * 응답자(responder) 상태가 남아 다음 탭이 먹지 않는다 (시트 안 버튼으로 시트를 닫을 때).
 */
function useDeferredVisible(visible: boolean) {
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) {
      setShown(true);
      return;
    }
    const t = setTimeout(() => setShown(false), 0);
    return () => clearTimeout(t);
  }, [visible]);
  return visible || shown;
}

/** 바텀시트. 바깥 탭·뒤로 = onClose (웹에서도 동작하도록 RN Modal 사용) */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  testID?: string;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const shown = useDeferredVisible(visible);
  return (
    <Modal visible={shown} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="닫기"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' }}
      >
        <Pressable
          testID={testID}
          onPress={() => undefined}
          style={{
            backgroundColor: c.bg,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            paddingBottom: Math.max(insets.bottom, 20),
            gap: 14,
            maxHeight: '90%',
          }}
        >
          {title ? <T variant="h2">{title}</T> : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Dialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = '취소',
  onConfirm,
  onCancel,
  danger,
  loading,
}: {
  visible: boolean;
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  const c = useTheme();
  const shown = useDeferredVisible(visible);
  return (
    <Modal visible={shown} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: c.overlay,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <View
          accessibilityRole="alert"
          style={{
            backgroundColor: c.bg,
            borderRadius: 16,
            padding: 20,
            gap: 12,
            width: '100%',
            maxWidth: 360,
          }}
        >
          {title ? <T variant="h2">{title}</T> : null}
          <T>{message}</T>
          <Row style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <Button small kind="secondary" label={cancelLabel} onPress={onCancel} />
            <Button
              small
              kind={danger ? 'danger' : 'primary'}
              label={confirmLabel}
              onPress={onConfirm}
              loading={loading}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- 토스트 ---------- */

export function ToastHost() {
  const { message, seq, hide } = useToast();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(hide, 2600);
    return () => clearTimeout(t);
  }, [message, seq, hide]);
  const style = useMemo<ViewStyle>(
    () => ({
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: insets.bottom + 84,
      alignItems: 'center',
    }),
    [insets.bottom],
  );
  if (!message) return null;
  return (
    <View pointerEvents="none" style={style}>
      <View
        accessibilityLiveRegion="polite"
        style={{
          backgroundColor: 'rgba(17,24,39,0.92)',
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          maxWidth: 480,
        }}
      >
        <Text testID="toast" style={{ color: '#fff', fontSize: 14 }}>
          {message}
        </Text>
      </View>
    </View>
  );
}

/* ---------- 상단 바 (헤더를 직접 그리는 화면: 가입 흐름 등) ---------- */

export function TopBar({
  title,
  onBack,
  right,
}: {
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: c.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <Row style={{ height: 52, paddingHorizontal: 8 }}>
        <View style={{ width: 88 }}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="뒤로"
              onPress={onBack}
              hitSlop={10}
              style={{ padding: 8 }}
            >
              <Text style={{ color: c.text, fontSize: 22 }}>←</Text>
            </Pressable>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={{ flex: 1, textAlign: 'center', color: c.text, fontSize: 17, fontWeight: '600' }}
        >
          {title ?? ''}
        </Text>
        <View style={{ width: 88, alignItems: 'flex-end', paddingRight: 8 }}>{right}</View>
      </Row>
    </View>
  );
}

/** 진행 표시 "1/3" (가입 흐름, PRD 6.4~6.6) */
export function Progress({ step, total }: { step: number; total: number }) {
  const c = useTheme();
  return (
    <Row gap={6}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: i < step ? c.primary : c.surfaceStrong,
          }}
        />
      ))}
      <T variant="small" muted>
        {step}/{total}
      </T>
    </Row>
  );
}

/** 목록에서 하나 고르기 (연도 휠·지역 바텀시트 대용, 웹에서도 동작) */
export function PickerSheet<V extends string | number | null>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
  columns = 1,
}: {
  visible: boolean;
  title: string;
  options: { value: V; label: string }[];
  value: V | undefined;
  onSelect: (v: V) => void;
  onClose: () => void;
  columns?: number;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 420 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {options.map((o) => (
            <View
              key={String(o.value)}
              style={{ width: columns === 1 ? '100%' : `${100 / columns - 3}%` }}
            >
              <Chip
                label={o.label}
                selected={o.value === value}
                onPress={() => {
                  onSelect(o.value);
                  onClose();
                }}
                testID={`pick-${String(o.value)}`}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

/** 선택값을 보여주고 누르면 PickerSheet를 여는 입력 */
export function SelectBox({
  label,
  placeholder,
  onPress,
  disabled,
  testID,
}: {
  label: string | null;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 12,
        backgroundColor: disabled ? c.surface : c.bg,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ color: label ? (disabled ? c.subtext : c.text) : c.subtext, fontSize: 16 }}>
        {label ?? placeholder}
      </Text>
      {disabled ? null : <Text style={{ color: c.subtext }}>▾</Text>}
    </Pressable>
  );
}
