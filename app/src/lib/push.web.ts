/**
 * 웹 대체 구현 (로컬 확인용). 브라우저 푸시는 쓰지 않는다 — 권한은 항상 '미결정'으로 보고
 * S-006·관심 등록 바텀시트 흐름만 확인할 수 있게 한다. 기기 등록(PUT /me/device)은 하지 않는다.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined';

export const getPushPermission = (): Promise<PushPermission> => Promise.resolve('undetermined');
export const requestPushPermission = (): Promise<PushPermission> => Promise.resolve('undetermined');
export const deviceRegistration = () => Promise.resolve(null);
