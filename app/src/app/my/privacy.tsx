import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Pressable, Switch, View } from 'react-native';
import { api } from '../../api';
import { saveErrorMessage, screenErrorMessage } from '../../api/messages';
import { TERMS_LABEL } from '../../components/terms';
import { usePrivacyPolicyUrl } from '../../components/usePrivacyPolicyUrl';
import { ErrorState, Row, Screen, SkeletonCards, T } from '../../components/ui';
import { marketingToast } from '../../features/consents';
import { openInAppBrowser } from '../../lib/external';
import { formatDotDate } from '../../lib/format';
import { toast } from '../../stores/toast';
import { useTheme } from '../../theme';

/** S-065 개인정보 · 약관 (PRD 6.23). 마케팅 토글은 S-064와 같은 값 */
export default function Privacy() {
  const qc = useQueryClient();
  const c = useTheme();
  const consents = useQuery({ queryKey: ['consents'], queryFn: api.consents });

  const toggleMarketing = async (value: boolean) => {
    try {
      const res = await api.updateNotificationSettings({ marketing: value });
      qc.setQueryData(['notification-settings'], res);
      toast(marketingToast(value, res.marketingChangedAt));
      await consents.refetch();
    } catch (e) {
      toast(saveErrorMessage(e));
    }
  };

  const privacyUrl = usePrivacyPolicyUrl(
    consents.data?.find((x) => x.kind === 'privacy')?.contentUrl,
  );

  return (
    <>
      <Stack.Screen options={{ title: '개인정보·약관' }} />
      <Screen>
        {consents.isPending ? (
          <SkeletonCards count={4} height={52} />
        ) : consents.isError ? (
          <ErrorState
            compact
            message={screenErrorMessage(consents.error)}
            onRetry={() => void consents.refetch()}
          />
        ) : (
          <>
            {consents.data.map((item) => (
              <Row
                key={item.kind}
                style={{
                  justifyContent: 'space-between',
                  borderBottomWidth: 1,
                  borderBottomColor: c.border,
                  paddingVertical: 12,
                }}
              >
                <Pressable
                  style={{ flex: 1, gap: 2 }}
                  onPress={() => void openInAppBrowser(item.contentUrl)}
                >
                  <T>{TERMS_LABEL[item.kind]}</T>
                  <T variant="caption" muted>
                    {item.agreed && item.agreedAt
                      ? `동의함 ${formatDotDate(item.agreedAt)}`
                      : '동의 안 함'}
                  </T>
                </Pressable>
                {item.kind === 'marketing' ? (
                  <Switch
                    testID="privacy-marketing"
                    value={item.agreed}
                    onValueChange={(v) => void toggleMarketing(v)}
                  />
                ) : null}
              </Row>
            ))}
            {privacyUrl ? (
              <Pressable
                onPress={() => void openInAppBrowser(privacyUrl)}
                style={{ paddingVertical: 12 }}
              >
                <T>개인정보 처리방침</T>
              </Pressable>
            ) : null}
            <View>
              <T variant="caption" muted>
                필수 동의를 철회하려면 회원 탈퇴를 해주세요
              </T>
            </View>
          </>
        )}
      </Screen>
    </>
  );
}
