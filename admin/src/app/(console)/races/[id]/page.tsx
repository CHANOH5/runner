'use client';

import { AdminRace } from '@berun/shared';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { cloneAndOpen } from '@/components/clone';
import { RaceForm } from '@/components/race-form';
import { useSession } from '@/components/session';
import { ErrorAlert } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/messages';

/** A-003 대회 수정. 복제 직후면 원본 이름·강조 칸을 쿼리로 받는다 */
function EditRace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { admin } = useSession();
  const [race, setRace] = useState<AdminRace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRace(null);
    setError(null);
    api('GET', `/races/${id}`, { schema: AdminRace })
      .then(setRace)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [id]);

  if (error) return <ErrorAlert message={error} />;
  if (!race) return <div className="skeleton" style={{ height: 320 }} />;
  const shifted = params.get('shifted')?.split(',').filter(Boolean) ?? [];
  return (
    <RaceForm
      key={race.id}
      race={race}
      role={admin.role}
      clonedFrom={params.get('clonedFrom')}
      shifted={shifted}
      onSaved={setRace}
      onSavedAndNew={(k) => {
        const p = new URLSearchParams();
        if (k.regionCode) p.set('region', k.regionCode);
        if (k.raceType) p.set('raceType', k.raceType);
        router.push(`/races/new?${p.toString()}`);
      }}
      onClone={() =>
        void cloneAndOpen(race.id, race.name, (u) => router.push(u)).catch((err: unknown) =>
          setError(errorMessage(err)),
        )
      }
      onDeleted={() => router.replace('/races')}
    />
  );
}

export default function EditRacePage() {
  return (
    <Suspense>
      <EditRace />
    </Suspense>
  );
}
