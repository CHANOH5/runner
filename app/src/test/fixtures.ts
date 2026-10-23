import type { Prediction, RaceDetail, Registration } from '@berun/shared';

export const RACE_ID = '0199f000-0000-7000-8000-000000000101';
export const EVENT_10K = '0199f000-0000-7000-8000-000000000201';
export const EVENT_HALF = '0199f000-0000-7000-8000-000000000202';
export const REG_ID = '0199f000-0000-7000-8000-000000000301';

export const race = (over: Partial<RaceDetail> = {}): RaceDetail => ({
  id: RACE_ID,
  name: '2026 서울 하프',
  raceDate: '2026-11-08',
  regionCode: 'seoul',
  categories: ['10k', 'half'],
  status: 'scheduled',
  registrationState: 'open',
  registrationOpensAt: '2026-08-01T10:00:00+09:00',
  registrationOpensTimeKnown: true,
  registrationClosesAt: '2026-08-31T23:59:00+09:00',
  registrationMethod: 'first_come',
  dDay: 18,
  organizer: null,
  venue: {
    name: '여의도 한강공원',
    address: '서울 영등포구 여의동로 330',
    lat: 37.52,
    lng: 126.93,
  },
  earliestStartAt: '2026-11-08T08:00:00+09:00',
  officialUrl: 'https://example.test',
  registrationUrl: 'https://example.test/apply',
  courseUrl: null,
  events: [
    {
      id: EVENT_10K,
      name: '10K',
      category: '10k',
      distanceM: 10000,
      startAt: '2026-11-08T08:10:00+09:00',
      timeLimitMin: 90,
      feeKrw: 40000,
      capacity: 5000,
      registrationOpensAt: null,
      registrationClosesAt: null,
    },
    {
      id: EVENT_HALF,
      name: '하프코스',
      category: 'half',
      distanceM: 21097,
      startAt: '2026-11-08T08:00:00+09:00',
      timeLimitMin: null,
      feeKrw: 50000,
      capacity: 3000,
      registrationOpensAt: null,
      registrationClosesAt: null,
    },
  ],
  source: { name: '공식 홈페이지', url: 'https://example.test' },
  lastVerifiedAt: '2026-10-15T10:00:00+09:00',
  my: { interested: false, registration: null },
  ...over,
});

export const registration = (over: Partial<Registration> = {}): Registration => ({
  id: REG_ID,
  raceId: RACE_ID,
  raceEventId: EVENT_HALF,
  eventName: '하프코스',
  eventDistanceM: 21097,
  goalTimeSec: 7080,
  goalPaceSecPerKm: 336,
  goalSource: 'manual',
  entryStatus: 'not_registered',
  entryStatusUpdatedAt: null,
  predictionId: null,
  predictionSupported: true,
  interestAutoEnabled: false,
  showOfficialRegistrationNotice: false,
  warnings: [],
  createdAt: '2026-10-20T10:00:00+09:00',
  ...over,
});

const splits = [
  { atM: 5000, cumulativeSec: 1754, segmentPaceSecPerKm: 351 },
  { atM: 21097, cumulativeSec: 7402, segmentPaceSecPerKm: 351 },
];

export const prediction = (over: Partial<Prediction> = {}): Prediction => ({
  id: '0199f000-0000-7000-8000-000000000501',
  modelVersion: 'riegel-1.06-v1',
  targetDistanceM: 21097,
  predictedSec: 7402,
  rangeMinSec: 7200,
  rangeMaxSec: 7680,
  rangeDisplayUnit: 'minute',
  avgPaceSecPerKm: 351,
  confidence: 'high',
  confidenceReason: 'high',
  firstFullSuggestionSec: null,
  timeLimitWarning: false,
  usedRecords: [],
  splits: { even: splits, negative: splits },
  raceRegistrationId: REG_ID,
  race: {
    id: RACE_ID,
    name: '2026 서울 하프',
    eventName: '하프코스',
    startAt: '2026-11-08T08:00:00+09:00',
  },
  recordsChangedSince: false,
  createdAt: '2026-10-20T10:00:00+09:00',
  ...over,
});
