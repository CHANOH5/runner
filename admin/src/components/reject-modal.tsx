'use client';

import { REJECT_REASON_TEXT } from '@berun/shared';
import { useState } from 'react';
import { Modal } from './ui';

export type RejectReason = keyof typeof REJECT_REASON_TEXT | 'other';

/** 반려 사유 템플릿 (PRD 8.5). 기타는 직접 입력 1~100자 */
export function RejectModal({
  count,
  onClose,
  onSubmit,
}: {
  count: number;
  onClose: () => void;
  onSubmit: (reason: RejectReason, text?: string) => void;
}) {
  const [reason, setReason] = useState<RejectReason>('same_as_official');
  const [text, setText] = useState('');
  const invalid = reason === 'other' && !text.trim();
  return (
    <Modal
      title={count > 1 ? `제보 ${count}건 반려` : '제보 반려'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={invalid}
            onClick={() => onSubmit(reason, reason === 'other' ? text.trim() : undefined)}
          >
            반려
          </button>
        </>
      }
    >
      <p className="muted">제보자에게 앱 알림(N-07b)으로 사유가 전해져요.</p>
      {(Object.entries(REJECT_REASON_TEXT) as [RejectReason, string][]).map(([k, v]) => (
        <label key={k} className="check" style={{ display: 'flex', marginBottom: 6 }}>
          <input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} />
          {v}
        </label>
      ))}
      <label className="check" style={{ display: 'flex', marginBottom: 6 }}>
        <input
          type="radio"
          name="reason"
          checked={reason === 'other'}
          onChange={() => setReason('other')}
        />
        기타 (직접 입력)
      </label>
      {reason === 'other' && (
        <input
          aria-label="반려 사유"
          maxLength={100}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: '100%' }}
          autoFocus
        />
      )}
    </Modal>
  );
}
