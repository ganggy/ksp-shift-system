import React, { useEffect, useState } from 'react';
import { Sliders, CalendarHeart, History, Save, Trash2, Plus } from 'lucide-react';
import { api } from '../api';
import type { AuditLog, AuthUser, CompensationRate, PublicHoliday } from '../types';

interface Props {
  rates: CompensationRate[];
  holidays: PublicHoliday[];
  user: AuthUser | null;
  onRefreshMeta: () => void;
  onRequireLogin: () => void;
  onToast: (msg: string, isError?: boolean) => void;
}

export const AdminSettings: React.FC<Props> = ({
  rates,
  holidays,
  user,
  onRefreshMeta,
  onRequireLogin,
  onToast,
}) => {
  const [tab, setTab] = useState<'rates' | 'holidays' | 'audit'>('rates');
  const [editRates, setEditRates] = useState<CompensationRate[]>(rates);
  const [newHolDate, setNewHolDate] = useState('');
  const [newHolTitle, setNewHolTitle] = useState('');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditRates(rates);
  }, [rates]);

  useEffect(() => {
    if (tab === 'audit') {
      api.auditLogs(60).then((r) => setLogs(r.logs || [])).catch(() => {});
    }
  }, [tab]);

  const handleSaveRate = async (rate: CompensationRate) => {
    if (!user) return onRequireLogin();
    setBusy(true);
    try {
      await api.updateRate(rate.rate_key, rate);
      onToast(`บันทึกอัตรา "${rate.group_name}" เรียบร้อย`);
      onRefreshMeta();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onRequireLogin();
    setBusy(true);
    try {
      await api.upsertHoliday({ holiday_date: newHolDate, title: newHolTitle, holiday_type: 'national' });
      setNewHolDate('');
      setNewHolTitle('');
      onToast('เพิ่มวันหยุดราชการแล้ว');
      onRefreshMeta();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteHoliday = async (date: string) => {
    if (!user) return onRequireLogin();
    setBusy(true);
    try {
      await api.deleteHoliday(String(date).slice(0, 10));
      onToast('ลบวันหยุดแล้ว');
      onRefreshMeta();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <div className="panel-title">ตั้งค่าอัตราค่าตอบแทน วันหยุดราชการ และบันทึกตรวจสอบ</div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>
            อัตราค่าตอบแทนเริ่มต้นอ้างอิงแนวทาง สธ. (สามารถปรับให้ตรงตามมติคณะกรรมการ/ระเบียบโรงพยาบาลได้)
          </div>
        </div>
      </div>

      <div className="brush-bar">
        <button className={`brush-pill ${tab === 'rates' ? 'active' : ''}`} onClick={() => setTab('rates')}>
          <Sliders size={14} color="#0f766e" /> อัตราค่าตอบแทนตามวิชาชีพ
        </button>
        <button className={`brush-pill ${tab === 'holidays' ? 'active' : ''}`} onClick={() => setTab('holidays')}>
          <CalendarHeart size={14} color="#be123c" /> ปฏิทินวันหยุดราชการ ({holidays.length})
        </button>
        <button className={`brush-pill ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>
          <History size={14} color="#4338ca" /> Audit Trail
        </button>
      </div>

      {tab === 'rates' && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>กลุ่มวิชาชีพ</th>
                <th>คำค้นตำแหน่ง (db_hrd)</th>
                <th className="text-right">เวรบ่าย</th>
                <th className="text-right">เวรดึก</th>
                <th className="text-right">OT ธรรมดา/ชม.</th>
                <th className="text-right">OT วันหยุด/ชม.</th>
                <th className="text-right">On-Call</th>
                <th className="text-right">Refer</th>
                <th className="text-center">บันทึก</th>
              </tr>
            </thead>
            <tbody>
              {editRates.map((r, idx) => (
                <tr key={r.rate_key}>
                  <td style={{ fontWeight: 700, minWidth: 180 }}>{r.group_name}</td>
                  <td>
                    <input
                      value={r.match_keywords}
                      onChange={(e) => {
                        const next = [...editRates];
                        next[idx] = { ...r, match_keywords: e.target.value };
                        setEditRates(next);
                      }}
                      style={{ width: 190, padding: '5px 8px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </td>
                  {(['afternoon_rate', 'night_rate', 'ot_weekday_hourly', 'ot_holiday_hourly', 'oncall_rate', 'refer_rate'] as const).map((field) => (
                    <td key={field} className="text-right">
                      <input
                        type="number"
                        value={r[field]}
                        onChange={(e) => {
                          const next = [...editRates];
                          next[idx] = { ...r, [field]: Number(e.target.value) };
                          setEditRates(next);
                        }}
                        className="num"
                        style={{ width: 72, padding: '5px 7px', borderRadius: 8, border: '1px solid #cbd5e1', textAlign: 'right' }}
                      />
                    </td>
                  ))}
                  <td className="text-center">
                    <button className="btn btn-primary btn-sm" onClick={() => handleSaveRate(r)} disabled={busy}>
                      <Save size={13} /> บันทึก
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'holidays' && (
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={handleAddHoliday}>
            <div className="field">
              <label>วันที่หยุด (ค.ศ.)</label>
              <input type="date" value={newHolDate} onChange={(e) => setNewHolDate(e.target.value)} required />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label>ชื่อวันหยุดนักขัตฤกษ์</label>
              <input value={newHolTitle} onChange={(e) => setNewHolTitle(e.target.value)} placeholder="เช่น วันหยุดชดเชย..." required />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Plus size={15} /> เพิ่มวันหยุด
            </button>
          </form>

          <table className="data-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ชื่อวันหยุด</th>
                <th>ประเภท</th>
                <th className="text-center">ลบ</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.holiday_date}>
                  <td className="num" style={{ fontWeight: 700 }}>{String(h.holiday_date).slice(0, 10)}</td>
                  <td>{h.title}</td>
                  <td><span className="status-badge status-draft">{h.holiday_type}</span></td>
                  <td className="text-center">
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteHoliday(h.holiday_date)} disabled={busy}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>ผู้ดำเนินการ</th>
                <th>กิจกรรม</th>
                <th>เป้าหมาย</th>
                <th>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="num" style={{ fontSize: 12 }}>{l.created_at}</td>
                  <td style={{ fontWeight: 600 }}>{l.actor_name}</td>
                  <td><span className="status-badge status-submitted">{l.action}</span></td>
                  <td className="num" style={{ fontSize: 12 }}>{l.entity_type} #{l.entity_id}</td>
                  <td style={{ fontSize: 12, color: '#64748b', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.detail_json || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
