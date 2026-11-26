import React, { useMemo, useState } from 'react';
import {
  Wand2,
  Copy,
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Send,
  Lock,
  Unlock,
  Eraser,
  MousePointerClick,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { AuthUser, RosterPayload, ShiftAssignment } from '../types';

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

const fmtMoney = (n: number) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const ShiftRosterMatrix: React.FC<Props> = ({
  data,
  loading,
  user,
  yearMonth,
  departmentSubId,
  onRefresh,
  onRequireLogin,
  onToast,
}) => {
  // brush: 'INSPECT' | 'CLEAR' | shiftCode ('M','A','N','OT','OC','REF','OFF')
  const [brush, setBrush] = useState<string>('M');
  const [busy, setBusy] = useState(false);
  const [autoModal, setAutoModal] = useState(false);
  const [autoTpl, setAutoTpl] = useState({ morning: 2, afternoon: 2, night: 2, overwrite: false });
  const [cellEditor, setCellEditor] = useState<{
    personId: number;
    personName: string;
    date: string;
    isHoliday: boolean;
    shifts: Array<{ shift_code: string; hours: number; is_holiday: boolean; custom_rate: string; note: string }>;
  } | null>(null);

  const cellMap = useMemo(() => {
    const map = new Map<string, ShiftAssignment[]>();
    if (!data) return map;
    for (const a of data.assignments) {
      const d = String(a.work_date).slice(0, 10);
      const k = `${a.person_id}:${d}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return map;
  }, [data]);

  const conflictCellSet = useMemo(() => {
    const set = new Set<string>();
    if (!data) return set;
    for (const c of data.analysis.conflicts) {
      set.add(`${c.person_id}:${c.date}`);
    }
    return set;
  }, [data]);

  const payrollMap = useMemo(() => {
    if (!data) return new Map();
    return new Map(data.payrollRows.map((r) => [r.person_id, r]));
  }, [data]);

  const shiftTypeMap = useMemo(() => {
    if (!data) return new Map();
    return new Map(data.shiftTypes.map((s) => [s.code, s]));
  }, [data]);

  if (loading && !data) {
    return <div className="panel-card"><div className="panel-body">กำลังโหลดตารางเวรและข้อมูลวันลาจาก db_hrd...</div></div>;
  }
  if (!data) return null;

  const isLocked = data.roster.status === 'locked' && !user?.isAdmin;

  const openInspector = (personId: number, personName: string, date: string, isHoliday: boolean) => {
    const current = cellMap.get(`${personId}:${date}`) || [];
    setCellEditor({
      personId,
      personName,
      date,
      isHoliday,
      shifts: current.map((c) => ({
        shift_code: c.shift_code,
        hours: Number(c.hours || 8),
        is_holiday: Boolean(c.is_holiday ?? isHoliday),
        custom_rate: c.custom_rate != null ? String(c.custom_rate) : '',
        note: c.note || '',
      })),
    });
  };

  const handleCellClick = async (personId: number, personName: string, date: string, isHoliday: boolean) => {
    if (brush === 'INSPECT') {
      openInspector(personId, personName, date, isHoliday);
      return;
    }
    if (!user) {
      onRequireLogin();
      return;
    }
    if (isLocked) {
      onToast('ตารางเวรถูกล็อกงวดเบิกจ่ายแล้ว', true);
      return;
    }

    const current = cellMap.get(`${personId}:${date}`) || [];
    let nextShifts: any[] = [];

    if (brush === 'CLEAR') {
      nextShifts = [];
    } else {
      const hasCode = current.some((c) => c.shift_code === brush);
      if (hasCode) {
        nextShifts = current.filter((c) => c.shift_code !== brush);
      } else {
        const st = shiftTypeMap.get(brush);
        // If clicking OFF, replace working shifts; if clicking normal M/A/N, remove OFF
        const filtered = brush === 'OFF' ? [] : current.filter((c) => c.shift_code !== 'OFF');
        nextShifts = [
          ...filtered,
          {
            shift_code: brush,
            hours: Number(st?.default_hours ?? 8),
            is_holiday: isHoliday ? 1 : 0,
          },
        ];
      }
    }

    try {
      await api.saveCell({
        yearMonth,
        departmentSubId,
        person_id: personId,
        work_date: date,
        shifts: nextShifts,
      });
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    }
  };

  const handleSaveInspector = async () => {
    if (!cellEditor) return;
    if (!user) {
      onRequireLogin();
      return;
    }
    setBusy(true);
    try {
      await api.saveCell({
        yearMonth,
        departmentSubId,
        person_id: cellEditor.personId,
        work_date: cellEditor.date,
        shifts: cellEditor.shifts,
      });
      setCellEditor(null);
      onToast('บันทึกข้อมูลเวรเรียบร้อย');
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleAutoGenerate = async () => {
    if (!user) return onRequireLogin();
    setBusy(true);
    try {
      const res = await api.autoGenerate({
        yearMonth,
        departmentSubId,
        template: { morning: autoTpl.morning, afternoon: autoTpl.afternoon, night: autoTpl.night },
        overwrite: autoTpl.overwrite,
      });
      setAutoModal(false);
      onToast(`จัดเวรอัตโนมัติสำเร็จ ${res.generatedCount} รายการ (หลีกเลี่ยงวันลา/ไปราชการแล้ว)`);
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyPrev = async () => {
    if (!user) return onRequireLogin();
    setBusy(true);
    try {
      const res = await api.copyPrevious({ yearMonth, departmentSubId });
      onToast(`คัดลอกเวรเดือนก่อน ${res.copied} รายการ (ข้ามวันชนลา/ไปราชการ ${res.skippedConflicts} จุด)`);
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!user) return onRequireLogin();
    if (!window.confirm('ต้องการล้างข้อมูลเวรทั้งหมดของหน่วยงานในเดือนนี้ใช่หรือไม่?')) return;
    setBusy(true);
    try {
      await api.clearRoster(yearMonth, departmentSubId);
      onToast('ล้างตารางเวรเรียบร้อย');
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!user) return onRequireLogin();
    setBusy(true);
    try {
      const res = await api.changeStatus({ yearMonth, departmentSubId, status });
      onToast(`เปลี่ยนสถานะเป็น "${res.statusLabel}" แล้ว`);
      onRefresh();
    } catch (err: any) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header & Workflow Actions */}
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              ตารางเวรประจำเดือน {data.monthInfo.thaiMonthLabel} • {data.department?.department_sub_name}
              <span className={`status-badge status-${data.roster.status}`}>{data.roster.statusLabel}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 3 }}>
              บุคลากรในหน่วยงาน {data.people.length} คน • ยอดรวมค่าตอบแทนปัจจุบัน{' '}
              <strong style={{ color: '#0f766e' }} className="num">฿{fmtMoney(data.totals.grandTotal)}</strong> •
              สมดุลเวรดึก {data.analysis.fairness.minNight}–{data.analysis.fairness.maxNight} เวร/คน
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => (user ? setAutoModal(true) : onRequireLogin())} disabled={busy || isLocked}>
              <Wand2 size={14} /> จัดเวรอัตโนมัติ
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleCopyPrev} disabled={busy || isLocked}>
              <Copy size={14} /> คัดลอกเดือนก่อน
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleClearAll} disabled={busy || isLocked}>
              <Trash2 size={14} /> ล้างตาราง
            </button>

            <a
              className="btn btn-secondary btn-sm"
              href={`/api/export/pdf?yearMonth=${encodeURIComponent(yearMonth)}&departmentSubId=${departmentSubId}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <FileText size={14} /> PDF
            </a>
            <a
              className="btn btn-secondary btn-sm"
              href={`/api/export/excel?yearMonth=${encodeURIComponent(yearMonth)}&departmentSubId=${departmentSubId}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <FileSpreadsheet size={14} /> Excel
            </a>

            {data.roster.status === 'draft' && (
              <button className="btn btn-amber btn-sm" onClick={() => handleStatusChange('submitted')} disabled={busy}>
                <Send size={14} /> ส่งตรวจสอบ
              </button>
            )}
            {(data.roster.status === 'draft' || data.roster.status === 'submitted') && (
              <button className="btn btn-primary btn-sm" onClick={() => handleStatusChange('approved')} disabled={busy}>
                <CheckCircle2 size={14} /> อนุมัติตารางเวร
              </button>
            )}
            {data.roster.status === 'approved' && (
              <button className="btn btn-secondary btn-sm" onClick={() => handleStatusChange('locked')} disabled={busy}>
                <Lock size={14} /> ล็อกงวดจ่ายเงิน
              </button>
            )}
            {data.roster.status === 'locked' && user?.isAdmin && (
              <button className="btn btn-secondary btn-sm" onClick={() => handleStatusChange('draft')} disabled={busy}>
                <Unlock size={14} /> ปลดล็อก
              </button>
            )}
          </div>
        </div>

        {/* Paint-Brush Palette */}
        <div className="brush-bar">
          <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginRight: 4 }}>โหมดแต้มเวร:</span>
          {data.shiftTypes.map((st) => (
            <button
              key={st.code}
              type="button"
              className={`brush-pill ${brush === st.code ? 'active' : ''}`}
              onClick={() => setBrush(st.code)}
              title={st.label}
            >
              <span className="shift-chip" style={{ background: st.bg_color, color: st.color }}>{st.code}</span>
              <span>{st.label.split(' ')[0]}</span>
            </button>
          ))}
          <button
            type="button"
            className={`brush-pill ${brush === 'CLEAR' ? 'active' : ''}`}
            onClick={() => setBrush('CLEAR')}
          >
            <Eraser size={14} color="#be123c" /> ลบเวร
          </button>
          <button
            type="button"
            className={`brush-pill ${brush === 'INSPECT' ? 'active' : ''}`}
            onClick={() => setBrush('INSPECT')}
          >
            <MousePointerClick size={14} color="#0369a1" /> แก้ไขละเอียด (หลายเวร/ชม./หมายเหตุ)
          </button>
        </div>

        {/* Conflict & Fatigue Strip */}
        {(data.analysis.conflicts.length > 0 || data.analysis.fatigueWarnings.length > 0) && (
          <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8, background: '#fffaf5', borderBottom: '1px solid #fed7aa' }}>
            {data.analysis.conflicts.length > 0 && (
              <div className="alert-strip alert-danger" style={{ padding: '8px 12px' }}>
                <ShieldAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <strong>พบเวรชนวันลา / ไปราชการ {data.analysis.conflicts.length} จุด:</strong>{' '}
                  {data.analysis.conflicts.slice(0, 3).map((c) => c.message).join(' • ')}
                  {data.analysis.conflicts.length > 3 ? ` (+อีก ${data.analysis.conflicts.length - 3} จุด)` : ''}
                </div>
              </div>
            )}
            {data.analysis.fatigueWarnings.length > 0 && (
              <div className="alert-strip alert-warning" style={{ padding: '8px 12px' }}>
                <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <strong>คำเตือนความเหนื่อยล้า {data.analysis.fatigueWarnings.length} รายการ:</strong>{' '}
                  {data.analysis.fatigueWarnings.slice(0, 3).map((w) => w.message).join(' • ')}
                  {data.analysis.fatigueWarnings.length > 3 ? ` (+อีก ${data.analysis.fatigueWarnings.length - 3} รายการ)` : ''}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 31-day Matrix */}
        <div className="matrix-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th className="sticky-col">บุคลากรในหน่วยงาน ({data.people.length})</th>
                {data.days.map((d) => (
                  <th
                    key={d.date}
                    className={d.isPublicHoliday ? 'is-holiday' : d.isWeekend ? 'is-weekend' : ''}
                    title={d.holidayTitle || `${d.date} (${d.thaiDow})`}
                  >
                    <div style={{ fontSize: 12.5 }}>{d.day}</div>
                    <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>{d.thaiDow}</div>
                  </th>
                ))}
                <th style={{ minWidth: 88, background: '#f0fdfa', color: '#0f766e' }}>รวม (เวร / ฿)</th>
              </tr>
            </thead>
            <tbody>
              {data.people.length === 0 ? (
                <tr>
                  <td colSpan={data.days.length + 2} style={{ padding: 28, color: '#64748b' }}>
                    ไม่พบบุคลากรที่ปฏิบัติงานในหน่วยงานนี้ในฐานข้อมูล db_hrd
                  </td>
                </tr>
              ) : (
                data.people.map((p, idx) => {
                  const pr = payrollMap.get(p.person_id);
                  return (
                    <tr key={p.person_id}>
                      <td className="sticky-col">
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {idx + 1}. {p.fullName}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.position_name}
                        </div>
                      </td>

                      {data.days.map((d) => {
                        const key = `${p.person_id}:${d.date}`;
                        const items = cellMap.get(key) || [];
                        const leaves = data.leaveMap[key] || [];
                        const travels = data.travelMap[key] || [];
                        const hasConflict = conflictCellSet.has(key);

                        const cellClasses = [
                          'matrix-cell',
                          d.isPublicHoliday ? 'is-holiday' : d.isWeekend ? 'is-weekend' : '',
                          leaves.length ? 'has-leave' : travels.length ? 'has-travel' : '',
                          hasConflict ? 'has-conflict' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');

                        const tooltipParts = [
                          `${p.fullName} (${d.date})`,
                          ...items.map((i) => `${i.shift_code} (${i.hours} ชม.)`),
                          ...leaves.map((l) => `ลา: ${l.leave_type_name}`),
                          ...travels.map((t) => `ไปราชการ: ${t.subject}`),
                        ];

                        return (
                          <td
                            key={d.date}
                            className={cellClasses}
                            title={tooltipParts.join('\n')}
                            onClick={() => handleCellClick(p.person_id, p.fullName, d.date, Boolean(d.isHoliday))}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openInspector(p.person_id, p.fullName, d.date, Boolean(d.isHoliday));
                            }}
                          >
                            <div className="shift-stack">
                              {items.map((item) => {
                                const st = shiftTypeMap.get(item.shift_code);
                                return (
                                  <span
                                    key={item.shift_code}
                                    className="shift-chip"
                                    style={{
                                      background: st?.bg_color || '#f1f5f9',
                                      color: st?.color || '#334155',
                                    }}
                                  >
                                    {item.shift_code}
                                  </span>
                                );
                              })}
                              {!items.length && leaves.length > 0 && <span className="leave-mini-tag">ลา</span>}
                              {!items.length && !leaves.length && travels.length > 0 && <span className="travel-mini-tag">รช</span>}
                            </div>
                          </td>
                        );
                      })}

                      <td style={{ background: '#f8fafc', padding: '4px 6px' }} className="num">
                        <div style={{ fontWeight: 700, fontSize: 12.5, color: '#0f172a' }}>{pr?.totalShifts || 0} เวร</div>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0f766e' }}>
                          ฿{fmtMoney(pr?.grandTotal || 0)}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}

              {/* Daily Coverage Footer */}
              {(['M', 'A', 'N', 'OT'] as const).map((code) => {
                const st = shiftTypeMap.get(code);
                return (
                  <tr key={`cov-${code}`} style={{ background: '#f8fafc' }}>
                    <td className="sticky-col" style={{ background: '#f1f5f9', fontWeight: 700, fontSize: 12 }}>
                      อัตรากำลังรายวัน: <span style={{ color: st?.color }}>{st?.label.split(' ')[0] || code} ({code})</span>
                    </td>
                    {data.dailyCoverage.map((cov) => {
                      const val = cov[code];
                      return (
                        <td
                          key={cov.date}
                          className="num"
                          style={{
                            padding: '5px 2px',
                            fontWeight: 700,
                            fontSize: 11.5,
                            color: val === 0 ? '#94a3b8' : st?.color || '#0f172a',
                            background: val === 0 && code !== 'OT' ? '#fff1f2' : '#f8fafc',
                          }}
                        >
                          {val}
                        </td>
                      );
                    })}
                    <td style={{ background: '#f1f5f9', fontWeight: 700, fontSize: 11.5 }} className="num">
                      {data.dailyCoverage.reduce((s, c) => s + c[code], 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auto Schedule Modal */}
      {autoModal && (
        <div className="modal-backdrop" onClick={() => setAutoModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>จัดตารางเวรอัตโนมัติ (เกลี่ยเวรบ่าย-ดึก & หลีกเลี่ยงวันลา)</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setAutoModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="alert-strip alert-info">
                ระบบจะข้ามวันที่มีประวัติลาใน db_hrd หรือไปราชการใน ksp_travel และหลีกเลี่ยงการลงเวรดึกต่อเวรเช้าให้อัตโนมัติ
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label>เวรเช้า (คน/วัน)</label>
                  <input type="number" min={0} max={20} value={autoTpl.morning} onChange={(e) => setAutoTpl({ ...autoTpl, morning: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>เวรบ่าย (คน/วัน)</label>
                  <input type="number" min={0} max={20} value={autoTpl.afternoon} onChange={(e) => setAutoTpl({ ...autoTpl, afternoon: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>เวรดึก (คน/วัน)</label>
                  <input type="number" min={0} max={20} value={autoTpl.night} onChange={(e) => setAutoTpl({ ...autoTpl, night: Number(e.target.value) })} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoTpl.overwrite}
                  onChange={(e) => setAutoTpl({ ...autoTpl, overwrite: e.target.checked })}
                />
                เขียนทับตารางเวรเดิมทั้งเดือน (ถ้าไม่เลือก จะเติมเฉพาะช่องที่ยังว่าง)
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setAutoModal(false)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleAutoGenerate} disabled={busy}>
                {busy ? 'กำลังจัดเวร...' : 'เริ่มจัดตารางเวร'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Cell Inspector Modal */}
      {cellEditor && (
        <div className="modal-backdrop" onClick={() => setCellEditor(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3 style={{ fontSize: 15.5 }}>{cellEditor.personName}</h3>
                <div style={{ fontSize: 12, color: '#64748b' }}>วันที่ {cellEditor.date} {cellEditor.isHoliday ? '• วันหยุดราชการ/เสาร์-อาทิตย์' : ''}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setCellEditor(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              {cellEditor.shifts.map((s, idx) => (
                <div key={idx} style={{ padding: 10, borderRadius: 12, border: '1px solid #cbd5e1', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      value={s.shift_code}
                      onChange={(e) => {
                        const next = [...cellEditor.shifts];
                        next[idx].shift_code = e.target.value;
                        setCellEditor({ ...cellEditor, shifts: next });
                      }}
                      style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                    >
                      {data.shiftTypes.map((st) => (
                        <option key={st.code} value={st.code}>{st.code} - {st.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      max={24}
                      value={s.hours}
                      onChange={(e) => {
                        const next = [...cellEditor.shifts];
                        next[idx].hours = Number(e.target.value);
                        setCellEditor({ ...cellEditor, shifts: next });
                      }}
                      style={{ width: 72, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                      title="ชั่วโมง"
                    />
                    <span style={{ fontSize: 12 }}>ชม.</span>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => setCellEditor({ ...cellEditor, shifts: cellEditor.shifts.filter((_, i) => i !== idx) })}
                    >
                      ลบ
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={s.is_holiday}
                        onChange={(e) => {
                          const next = [...cellEditor.shifts];
                          next[idx].is_holiday = e.target.checked;
                          setCellEditor({ ...cellEditor, shifts: next });
                        }}
                      /> เรทวันหยุด
                    </label>
                    <input
                      type="number"
                      placeholder="กำหนดเรทเอง (บาท)"
                      value={s.custom_rate}
                      onChange={(e) => {
                        const next = [...cellEditor.shifts];
                        next[idx].custom_rate = e.target.value;
                        setCellEditor({ ...cellEditor, shifts: next });
                      }}
                      style={{ flex: 1, padding: '5px 8px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12.5 }}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setCellEditor({
                    ...cellEditor,
                    shifts: [
                      ...cellEditor.shifts,
                      { shift_code: 'OT', hours: 4, is_holiday: cellEditor.isHoliday, custom_rate: '', note: '' },
                    ],
                  })
                }
              >
                + เพิ่มเวร / OT ในวันเดียวกัน
              </button>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setCellEditor(null)}>ปิด</button>
              <button className="btn btn-primary" onClick={handleSaveInspector} disabled={busy}>บันทึกช่องนี้</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
