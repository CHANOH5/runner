import type { RegionCode } from '@berun/shared';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '../api';
import { isApiError } from '../api/client';
import { errorMessage } from '../api/messages';
import {
  Button,
  Dialog,
  Field,
  Input,
  PickerSheet,
  Progress,
  Screen,
  Segmented,
  SelectBox,
  T,
  TopBar,
} from '../components/ui';
import { useNicknameCheck } from '../components/useNicknameCheck';
import { setUnderageBlock, startSession } from '../features/auth';
import {
  ageGate,
  birthYearOptions,
  regionOptions,
  runningSinceError,
  runningSinceOptions,
} from '../features/profile';
import { formatDotDate, REGION_LABELS, todayKst } from '../lib/format';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { goBack } from '../lib/nav';

type Gender = 'male' | 'female' | 'none';

/** S-004 프로필 설정 (PRD 4.3, 6.4) */
export default function ProfileSetup() {
  const router = useRouter();
  const signup = useSession((s) => s.signup);
  const setSignup = useSession((s) => s.setSignup);
  const thisYear = Number(todayKst().slice(0, 4));

  const [nickname, setNickname] = useState('');
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [region, setRegion] = useState<RegionCode | null>(null);
  const [gender, setGender] = useState<Gender>('none');
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [picker, setPicker] = useState<'birth' | 'region' | 'running' | null>(null);
  const [askBirthday, setAskBirthday] = useState(false);
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useNicknameCheck(nickname, { signupToken: signup?.token });

  const runningError = runningSinceError(runningSince, birthYear);
  const valid =
    check.state === 'available' && birthYear !== null && region !== null && !runningError;

  const stopUnderage = async () => {
    if (signup) await api.signupAbort(signup.token).catch(() => undefined);
    await setUnderageBlock();
    setSignup(null);
    router.replace('/underage');
  };

  const submit = async (birthdayPassedThisYear?: boolean) => {
    if (!signup || birthYear === null || region === null) return;
    setSaving(true);
    try {
      const res = await api.signup(signup.token, {
        agreedTermIds: signup.agreedTermIds,
        profile: {
          nickname: nickname.trim(),
          birthYear,
          ...(birthdayPassedThisYear !== undefined && { birthdayPassedThisYear }),
          regionCode: region,
          gender: gender === 'none' ? null : gender,
          runningSince,
        },
      });
      setSignup(null);
      await startSession(res.tokens);
      if (res.marketingAgreedAt) {
        toast(`${formatDotDate(res.marketingAgreedAt)} 마케팅 정보 수신에 동의했어요`);
      }
      router.replace({ pathname: '/onboarding/records', params: { nickname: res.user.nickname } });
    } catch (e) {
      if (!isApiError(e)) return toast(errorMessage(e));
      if (e.code === 'NICKNAME_TAKEN' || e.code === 'NICKNAME_FORBIDDEN') {
        setCheck({ state: 'error', message: errorMessage(e) });
      } else if (e.code === 'UNDERAGE') {
        await setUnderageBlock();
        setSignup(null);
        router.replace('/underage');
      } else if (e.code === 'SIGNUP_TOKEN_EXPIRED') {
        setSignup(null);
        toast(errorMessage(e));
        router.replace('/login');
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const onDone = () => {
    if (birthYear === null) return;
    const gate = ageGate(birthYear, thisYear);
    if (gate === 'underage') void stopUnderage();
    else if (gate === 'ask') setAskBirthday(true);
    else void submit();
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar title="프로필 설정" onBack={() => goBack()} />
      <Screen
        footer={
          <Button
            testID="profile-done"
            label="완료"
            disabled={!valid}
            loading={saving}
            onPress={onDone}
          />
        }
      >
        <Progress step={1} total={3} />
        <Field
          label="닉네임"
          error={check.state === 'error' ? check.message : null}
          success={check.state === 'available' ? '사용할 수 있어요' : null}
          hint={check.state === 'checking' ? '확인 중…' : '2~12자, 한글·영문·숫자·_·.'}
        >
          <Input
            testID="profile-nickname"
            value={nickname}
            onChangeText={setNickname}
            maxLength={12}
            autoCapitalize="none"
            autoCorrect={false}
            invalid={check.state === 'error'}
          />
        </Field>
        <Field label="출생연도" hint="만 14세 이상 확인용이며 다른 사람에게 보이지 않아요">
          <SelectBox
            testID="profile-birth"
            label={birthYear ? `${birthYear}년` : null}
            placeholder="선택"
            onPress={() => setPicker('birth')}
          />
        </Field>
        <Field label="지역">
          <SelectBox
            testID="profile-region"
            label={region ? REGION_LABELS[region] : null}
            placeholder="시·도 선택"
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
            testID="profile-running"
            label={runningSince ? `${runningSince}년` : null}
            placeholder="선택 안 함"
            onPress={() => setPicker('running')}
          />
        </Field>
        <T variant="small" muted>
          프로필 사진·자기소개는 없어요. 다른 사용자에게 내 프로필이 보이지 않아요.
        </T>
      </Screen>

      <PickerSheet
        visible={picker === 'birth'}
        title="출생연도"
        options={birthYearOptions(thisYear)}
        value={birthYear ?? undefined}
        onSelect={setBirthYear}
        onClose={() => setPicker(null)}
        columns={3}
      />
      <PickerSheet
        visible={picker === 'region'}
        title="지역"
        options={regionOptions}
        value={region ?? undefined}
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
      <Dialog
        visible={askBirthday}
        message="올해 생일이 지났나요?"
        confirmLabel="지났어요"
        cancelLabel="아직이에요"
        onConfirm={() => {
          setAskBirthday(false);
          void submit(true);
        }}
        onCancel={() => {
          setAskBirthday(false);
          void stopUnderage();
        }}
      />
    </>
  );
}
