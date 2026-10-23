'use client';

import { REGION_CODES, type RegionCode } from '@berun/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { RaceForm } from '@/components/race-form';
import { useSession } from '@/components/session';

const RACE_TYPES = ['road', 'trail', 'ultra', 'track', 'virtual'] as const;

/** A-003 새 대회. ⌘Enter(저장하고 새 대회)로 오면 지역·종류를 유지한다 (PRD 8.4.1) */
function NewRace() {
  const router = useRouter();
  const params = useSearchParams();
  const { admin } = useSession();
  const region = params.get('region');
  const raceType = params.get('raceType');
  const keep = {
    ...(region &&
      (REGION_CODES as readonly string[]).includes(region) && { regionCode: region as RegionCode }),
    ...(raceType &&
      (RACE_TYPES as readonly string[]).includes(raceType) && {
        raceType: raceType as (typeof RACE_TYPES)[number],
      }),
  };
  return (
    <RaceForm
      key={params.toString() + (params.get('n') ?? '')}
      race={null}
      role={admin.role}
      keep={keep}
      onSaved={(r) => router.replace(`/races/${r.id}`)}
      onSavedAndNew={(k) => {
        const p = new URLSearchParams({ n: String(Date.now()) });
        if (k.regionCode) p.set('region', k.regionCode);
        if (k.raceType) p.set('raceType', k.raceType);
        router.push(`/races/new?${p.toString()}`);
      }}
    />
  );
}

export default function NewRacePage() {
  return (
    <Suspense>
      <NewRace />
    </Suspense>
  );
}
