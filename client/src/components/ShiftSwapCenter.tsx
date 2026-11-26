import React, { useState } from 'react';
import { ArrowLeftRight, Check, XCircle, Plus } from 'lucide-react';
import { api } from '../api';
import type { AuthUser, ShiftSwap, ShiftType, StaffMember } from '../types';

interface Props {
  swaps: ShiftSwap[];
  people: StaffMember[];
  shiftTypes: ShiftType[];
  user: AuthUser | null;
  yearMonth: string;
  departmentSubId: number;
  onRefresh: () => void;
  onRequireLogin: () => void;
  onToast: (msg: string, isError?: boolean) => void;
}

export const ShiftSwapCenter: React.FC<Props> = ({
  swaps,
  people,
  shiftTypes,
  user,
  yearMonth,
  departmentSubId,
  onRefresh,
  onRequireLogin,
  onToast,
}) => {
  const [reqPid, setReqPid] = useState<number>(people[0]?.person_id || 0);
  const [targetPid, setTargetPid] = useState<number>(people[1]?.person_id || 0);
  const [workDate, setWorkDate] = useState(`${yearMonth}-01`);
  const [shiftCode, setShiftCode] = useState('A');
  const [swapType, setSwapType] = useState<'cover' | 'swap'>('cover');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onRequireLogin();
    setBusy(true);
    try {
      const reqPerson = people.find((p) => p.person_id === reqPid);
      const tgtPerson = people.find((p) => p.person_id === targetPid);
      await api.createSwap({
        yearMonth,
        departmentSubId,
        requester_person_id: reqPid || user.person_id,
        requester_name: reqPerson?.fullName || user.fullName,
        target_person_id: targetPid || null,
        target_name: tgtPerson?.fullName || null,
        work_date: workDate,
        shift_code: shiftCode,
        swap_type: swapType,
        reason,
      });
      setReason('');
      onToast('ยื่นคำขอแลกเวร/แทนเวรเรียบร้อย');
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleReview = async (id: number, decision: 'approved' | 'rejected') => {
    if (!user) return onRequireLogin();
    setBusy(true);
    try {
      await api.reviewSwap(id, decision);
      onToast(decision === 'approved' ? 'อนุมัติและอัปเดตตารางเวรอัตโนมัติแล้ว' : 'ปฏิเสธคำขอแล้ว');
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 18, alignItems: 'start' }}>
      <div className="panel-card">
        <div className="panel-header">
          <div className="panel-title"><Plus size={18} color="#0f766e" /> ยื่นคำขอแลกเวร / แทนเวร</div>
        </div>
        <form className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={handleSubmit}>
          <div className="field">
            <label>ผู้ขอแลกเวร / มอบเวร</label>
            <select value={reqPid} onChange={(e) => setReqPid(Number(e.target.value))}>
              {people.map((p) => (
                <option key={p.person_id} value={p.person_id}>{p.fullName}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>ผู้รับเวรแทน</label>
            <select value={targetPid} onChange={(e) => setTargetPid(Number(e.target.value))}>
              <option value={0}>-- เลือกผู้รับเวรแทน --</option>
              {people.map((p) => (
                <option key={p.person_id} value={p.person_id}>{p.fullName}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>วันที่ปฏิบัติเวร</label>
              <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} required />
            </div>
            <div className="field">
              <label>เวรที่แลก</label>
              <select value={shiftCode} onChange={(e) => setShiftCode(e.target.value)}>
                {shiftTypes.filter((s) => s.code !== 'OFF').map((s) => (
                  <option key={s.code} value={s.code}>{s.code} ({s.label.split(' ')[0]})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>รูปแบบ</label>
            <select value={swapType} onChange={(e) => setSwapType(e.target.value as 'cover' | 'swap')}>
              <option value="cover">มอบหมายผู้รับเวรแทน</option>
              <option value="swap">แลกเวร</option>
            </select>
          </div>
          <div className="field">
            <label>เหตุผล / หมายเหตุ</label>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ระบุเหตุผลความจำเป็น..." />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            ส่งคำขอแลกเวร
          </button>
        </form>
      </div>

      <div className="panel-card">
        <div className="panel-header">
          <div className="panel-title"><ArrowLeftRight size={18} color="#0f766e" /> รายการคำขอแลกเวร / แทนเวร ({swaps.length})</div>
          <span style={{ fontSize: 12, color: '#64748b' }}>เมื่อหัวหน้าอนุมัติ ระบบจะสลับเวรในตารางให้อัตโนมัติ</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>วันที่เวร</th>
                <th>เวร</th>
                <th>ผู้ขอ</th>
                <th>ผู้รับแทน</th>
                <th>เหตุผล</th>
                <th className="text-center">สถานะ</th>
                <th className="text-center">พิจารณา</th>
              </tr>
            </thead>
            <tbody>
              {swaps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center" style={{ padding: 28, color: '#64748b' }}>
                    ยังไม่มีคำขอแลกเวรในเดือนนี้
                  </td>
                </tr>
              ) : (
                swaps.map((s) => (
                  <tr key={s.id}>
                    <td className="num">{String(s.work_date).slice(0, 10)}</td>
                    <td><span className="shift-chip" style={{ background: '#e0f2fe', color: '#0369a1' }}>{s.shift_code}</span></td>
                    <td style={{ fontWeight: 600 }}>{s.requester_name}</td>
                    <td>{s.target_name || '-'}</td>
                    <td style={{ color: '#475569', fontSize: 12.5 }}>{s.reason || '-'}</td>
                    <td className="text-center">
                      <span className={`status-badge ${s.status === 'approved' ? 'status-approved' : s.status === 'rejected' ? 'status-locked' : 'status-submitted'}`}>
                        {s.status === 'approved' ? 'อนุมัติแล้ว' : s.status === 'rejected' ? 'ไม่อนุมัติ' : 'รออนุมัติ'}
                      </span>
                    </td>
                    <td className="text-center">
                      {s.status === 'pending' ? (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleReview(s.id, 'approved')} disabled={busy}>
                            <Check size={13} /> อนุมัติ
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleReview(s.id, 'rejected')} disabled={busy}>
                            <XCircle size={13} /> ปฏิเสธ
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11.5, color: '#64748b' }}>{s.reviewed_by || '-'}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
