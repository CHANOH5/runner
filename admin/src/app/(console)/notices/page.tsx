import { ComingSoon } from '@/components/ui';

/** A-008 공지·푸시 — 관리자 API가 아직 없어 자리만 둔다 */
export default function NoticesPage() {
  return (
    <>
      <div className="page-head">
        <h1>공지·푸시</h1>
      </div>
      <div className="card">
        <p>
          <ComingSoon what="공지 작성 · 수동 푸시 (관리자 API 추가 후 연결)" />
        </p>
        <p className="muted">
          대회 취소·연기·일정 변경 알림(N-06)은 대회 수정 화면에서 저장할 때 보내요.
        </p>
      </div>
    </>
  );
}
