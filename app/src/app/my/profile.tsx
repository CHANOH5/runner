import type { Me, RegionCode } from '@berun/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '../../api';
import { isApiError } from '../../api/client';
import { errorMessage, saveErrorMessage, screenErrorMessage } from '../../api/messages';
import {
  Button,
  ErrorState,
  Field,
  Input,
  PickerSheet,
  Screen,
  Segmented,
  SelectBox,
  SkeletonCards,
  TopBar,
} from '../../components/ui';
import { useConfirm } from '../../components/useConfirm';
import { useNicknameCheck } from '../../components/useNicknameCheck';
import { regionOptions, runningSinceError, runningSinceOptions } from '../../features/profile';
import { formatKoreanMonthDay, REGION_LABELS, todayKst } from '../../lib/format';
import { toast } from '../../stores/toast';
import { goBack } from '../../lib/nav';

type Gender = 'male' | 'female' | 'none';

/** S-062 프로필 수정 (PRD 4.3, 6.20) */
export default function ProfileEdit() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  if (me.isPending) return <SkeletonCards count={4} />;
  if (me.isError)
    return <ErrorState message={screenErrorMessage(me.error)} onRetry={() => void me.refetch()} />;
  return <Editor me={me.data} />;
}

function Editor({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();
  const thisYear = Number(todayKst().slice(0, 4));
  const [nickname, setNickname] = useState(me.nickname);
  const [region, setRegion] = useState<RegionCode>(me.regionCode);
  const [gender, setGender] = useState<Gender>(me.gender ?? 'none');
  const [runningSince, setRunningSince] = useState<number | null>(me.runningSince);
  const [picker, setPicker] = useState<'region' | 'running' | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, confirm] = useConfirm();

  const nicknameChanged = nickname.trim() !== me.nickname;
  const cooldown = me.nicknameChangeAvailableAt;
  const [check, setCheck] = useNicknameCheck(nickname, { skip: !nicknameChanged });
  const runningError = runningSinceError(runningSince, me.birthYear);
  const changed =
    nicknameChanged ||
    region !== me.regionCode ||
    (gender === 'none' ? null : gender) !== me.gender ||
    runningSince !== me.runningSince;
  const valid = changed && !runningError && (!nicknameChanged || check.state === 'available');

  const back = async () => {
    if (
      changed &&
      !(await confirm({ message: '작성 중인 내용이 사라져요', confirmLabel: '나가기' }))
    )
      return;
    goBack();
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateProfile({
        ...(nicknameChanged && { nickname: nickname.trim() }),
        ...(region !== me.regionCode && { regionCode: region }),
        ...((gender === 'none' ? null : gender) !== me.gender && {
          gender: gender === 'none' ? null : gender,
        }),
        ...(runningSince !== me.runningSince && { runningSince }),
      });
      qc.setQueryData(['me'], updated);
      void qc.invalidateQueries({ queryKey: ['home'] });
      goBack();
      toast('저장했어요');
    } catch (e) {
      if (
        isApiError(e) &&
        ['NICKNAME_TAKEN', 'NICKNAME_FORBIDDEN', 'NICKNAME_CHANGE_COOLDOWN'].includes(e.code)
      ) {
        setCheck({ state: 'error', message: errorMessage(e) });
      } else toast(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar title="프로필 수정" onBack={() => void back()} />
      <Screen
        footer={
          <Button
            testID="profile-save"
            label="저장"
            disabled={!valid}
            loading={saving}
            onPress={() => void save()}
          />
        }
      >
        <Field
          label="닉네임"
          error={check.state === 'error' ? check.message : null}
          success={check.state === 'available' ? '사용할 수 있어요' : null}
          hint={cooldown ? `${formatKoreanMonthDay(cooldown)}부터 바꿀 수 있어요` : null}
        >
          <Input
            value={nickname}
            onChangeText={setNickname}
            maxLength={12}
            editable={!cooldown}
            autoCapitalize="none"
          />
        </Field>
        <Field
          label="출생연도"
          hint="출생연도는 바꿀 수 없어요. 잘못 입력했다면 고객센터로 문의해주세요"
        >
          <SelectBox
            label={`${me.birthYear}년`}
            placeholder=""
            disabled
            onPress={() => undefined}
          />
        </Field>
        <Field label="지역">
          <SelectBox
            label={REGION_LABELS[region]}
            placeholder=""
            onPress={() => setPicker('region')}
          />
        </Field>
        <Field label="성별 (선택)">
          <Segmented<Gender>
            options={[
              { value: 'male', label: '남성' },
              { value: 'female', label: '여성' },
              { value: 'none', label: '선택 안 함' },
            ]}
            value={gender}
            onChange={setGender}
          />
        </Field>
        <Field label="러닝 시작 연도 (선택)" error={runningError}>
          <SelectBox
            label={runningSince ? `${runningSince}년` : null}
            placeholder="선택 안 함"
            onPress={() => setPicker('running')}
          />
        </Field>
      </Screen>
      <PickerSheet
        visible={picker === 'region'}
        title="지역"
        options={regionOptions}
        value={region}
        onSelect={setRegion}
        onClose={() => setPicker(null)}
        columns={3}
      />
      <PickerSheet
        visible={picker === 'running'}
        title="러닝 시작 연도"
        options={runningSinceOptions(thisYear)}
        value={runningSince}
        onSelect={setRunningSince}
        onClose={() => setPicker(null)}
        columns={3}
      />
      {dialog}
    </>
  );
}
