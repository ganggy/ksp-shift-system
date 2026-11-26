import React, { useState } from 'react';
import { FileText, FileSpreadsheet, Wallet, Edit3, X } from 'lucide-react';
import { api } from '../api';
import type { AuthUser, PayrollRow, RosterPayload } from '../types';

interface Props {
  data: RosterPayload | null;
  loading: boolean;
  user: AuthUser | null;
  yearMonth: string;
  departmentSubId: number;
  onRefresh: () => void;
  onRequireLogin: () => void;
  onToast: (msg: string, isError?: boolean) => void;
}

const fmt = (n: number) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CompensationPayroll: React.FC<Props> = ({
  data,
  loading,
  user,
  yearMonth,
  departmentSubId,
  onRefresh,
  onRequireLogin,
  onToast,
}) => {
  const [editing, setEditing] = useState<PayrollRow | null>(null);
  const [form, setForm] = useState({ pts: 0, p4p: 0, nonPractice: 0, other: 0, remark: '' });
  const [saving, setSaving] = useState(false);

  if (loading && !data) {
    return <div className="panel-card"><div className="panel-body">กำลังคำนวณค่าตอบแทน...</div></div>;
  }
  if (!data) return null;

  const openEdit = (row: PayrollRow) => {
    if (!user) return onRequireLogin();
    setEditing(row);
    setForm({
      pts: row.breakdown.ptsAmount,
      p4p: row.breakdown.p4pAmount,
      nonPractice: row.breakdown.nonPracticeAmount,
      other: row.breakdown.otherAmount,
      remark: row.remark || '',
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await api.saveAllowance({
        yearMonth,
        departmentSubId,
        person_id: editing.person_id,
        pts_amount: form.pts,
        p4p_amount: form.p4p,
        non_practice_amount: form.nonPractice,
        other_amount: form.other,
        remark: form.remark,
      });
      setEditing(null);
      onToast('บันทึกเงินเพิ่ม / พ.ต.ส. / P4P เรียบร้อย');
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const { totals } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div>
            <div className="kpi-label">ค่าเวรบ่าย + เวรดึก</div>
            <div className="kpi-value num">฿{fmt((totals.afternoonPay || 0) + (totals.nightPay || 0))}</div>
            <div className="kpi-sub">บ่าย ฿{fmt(totals.afternoonPay)} • ดึก ฿{fmt(totals.nightPay)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">ค่า OT นอกเวลา (ธรรมดา + วันหยุด)</div>
            <div className="kpi-value num">฿{fmt((totals.otWeekdayPay || 0) + (totals.otHolidayPay || 0))}</div>
            <div className="kpi-sub">วันธรรมดา ฿{fmt(totals.otWeekdayPay)} • วันหยุด ฿{fmt(totals.otHolidayPay)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">On-Call / Refer + พ.ต.ส. / P4P</div>
            <div className="kpi-value num">฿{fmt((totals.onCallPay || 0) + (totals.referPay || 0) + (totals.allowanceTotal || 0))}</div>
            <div className="kpi-sub">เงินเพิ่ม/พ.ต.ส./P4P ฿{fmt(totals.allowanceTotal)}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderColor: '#0d9488', background: 'linear-gradient(135deg, #f0fdfa, #ffffff)' }}>
          <div>
            <div className="kpi-label" style={{ color: '#0f766e' }}>ยอดขอเบิกจ่ายสุทธิทั้งหน่วยงาน</div>
            <div className="kpi-value num" style={{ color: '#0f766e' }}>฿{fmt(totals.grandTotal)}</div>
            <div className="kpi-sub">{data.payrollRows.length} ราย • {data.monthInfo.thaiMonthLabel}</div>
          </div>
          <div className="kpi-icon-wrap" style={{ background: '#0d9488', color: '#ffffff' }}>
            <Wallet size={22} />
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-header">
          <div>
            <div className="panel-title">ตารางคำนวณค่าตอบแทนรายบุคคล • {data.department?.department_sub_name}</div>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>
              คำนวณอัตโนมัติจากตารางเวรและกลุ่มวิชาชีพ (สามารถแก้ไข พ.ต.ส. / P4P / เงินไม่ทำเวชฯ รายคนได้)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              className="btn btn-primary btn-sm"
              href={`/api/export/pdf?yearMonth=${encodeURIComponent(yearMonth)}&departmentSubId=${departmentSubId}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <FileText size={14} /> พิมพ์หลักฐาน PDF (A4)
            </a>
            <a
              className="btn btn-secondary btn-sm"
              href={`/api/export/excel?yearMonth=${encodeURIComponent(yearMonth)}&departmentSubId=${departmentSubId}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <FileSpreadsheet size={14} /> ส่งออก Excel (.xlsx)
            </a>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ชื่อ - สกุล</th>
                <th>ตำแหน่ง / กลุ่มอัตรา</th>
                <th className="text-center">ช / บ / ด</th>
                <th className="text-center">OT (ธ/ห)</th>
                <th className="text-right">บ่าย+ดึก</th>
                <th className="text-right">OT</th>
                <th className="text-right">OC/Refer</th>
                <th className="text-right">พ.ต.ส./P4P/เพิ่ม</th>
                <th className="text-right">รวมสุทธิ (บาท)</th>
                <th className="text-center">ปรับปรุง</th>
              </tr>
            </thead>
            <tbody>
              {data.payrollRows.map((r, idx) => (
                <tr key={r.person_id}>
                  <td className="num">{idx + 1}</td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{r.fullName}</div>
                    <div style={{ fontSize: 11.5, color: '#64748b' }}>{r.person_type_name}</div>
                  </td>
                  <td>
                    <div>{r.position_name}</div>
                    <div style={{ fontSize: 11, color: '#0f766e' }}>{r.rate_group}</div>
                  </td>
                  <td className="text-center num">{r.counts.M}/{r.counts.A}/{r.counts.N}</td>
                  <td className="text-center num">{r.counts.OT_WD}/{r.counts.OT_HD}</td>
                  <td className="text-right num">{fmt(r.breakdown.afternoonPay + r.breakdown.nightPay)}</td>
                  <td className="text-right num">{fmt(r.breakdown.otWeekdayPay + r.breakdown.otHolidayPay)}</td>
                  <td className="text-right num">{fmt(r.breakdown.onCallPay + r.breakdown.referPay)}</td>
                  <td className="text-right num">{fmt(r.allowanceTotal)}</td>
                  <td className="text-right num" style={{ fontWeight: 700, color: '#0f766e' }}>
                    {fmt(r.grandTotal)}
                  </td>
                  <td className="text-center">
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}>
                      <Edit3 size={13} /> เงินเพิ่ม
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f0fdfa', fontWeight: 700 }}>
                <td colSpan={5}>รวมทั้งสิ้น ({data.payrollRows.length} ราย)</td>
                <td className="text-right num">{fmt((totals.afternoonPay || 0) + (totals.nightPay || 0))}</td>
                <td className="text-right num">{fmt((totals.otWeekdayPay || 0) + (totals.otHolidayPay || 0))}</td>
                <td className="text-right num">{fmt((totals.onCallPay || 0) + (totals.referPay || 0))}</td>
                <td className="text-right num">{fmt(totals.allowanceTotal)}</td>
                <td className="text-right num" style={{ color: '#0f766e', fontSize: 15 }}>฿{fmt(totals.grandTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3 style={{ fontSize: 16 }}>ปรับปรุงเงินเพิ่มรายเดือน</h3>
                <div style={{ fontSize: 12, color: '#64748b' }}>{editing.fullName}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}><X size={16} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="field">
                    <label>ค่า พ.ต.ส. (บาท)</label>
                    <input type="number" step="0.01" value={form.pts} onChange={(e) => setForm({ ...form, pts: Number(e.target.value) })} />
                  </div>
                  <div className="field">
                    <label>ค่า P4P (บาท)</label>
                    <input type="number" step="0.01" value={form.p4p} onChange={(e) => setForm({ ...form, p4p: Number(e.target.value) })} />
                  </div>
                  <div className="field">
                    <label>ค่าไม่ทำเวชปฏิบัติ (บาท)</label>
                    <input type="number" step="0.01" value={form.nonPractice} onChange={(e) => setForm({ ...form, nonPractice: Number(e.target.value) })} />
                  </div>
                  <div className="field">
                    <label>เงินเพิ่มอื่นๆ (บาท)</label>
                    <input type="number" step="0.01" value={form.other} onChange={(e) => setForm({ ...form, other: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="field">
                  <label>หมายเหตุ</label>
                  <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="ระบุหมายเหตุการเบิกจ่าย..." />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>ยกเลิก</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>บันทึกยอด</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
