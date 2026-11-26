import React from 'react';
import {
  Users,
  CalendarClock,
  Wallet,
  ArrowLeftRight,
  Building2,
  CheckCircle2,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import type { OrgInfo, OverviewPayload, ShiftType } from '../types';

interface Props {
  data: OverviewPayload | null;
  orgInfo: OrgInfo | null;
  shiftTypes: ShiftType[];
  loading: boolean;
  onSelectUnit: (deptSubId: number) => void;
  onGoToRoster: () => void;
}

const fmtMoney = (n: number) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const OverviewDashboard: React.FC<Props> = ({
  data,
  orgInfo,
  shiftTypes,
  loading,
  onSelectUnit,
  onGoToRoster,
}) => {
  if (loading && !data) {
    return <div className="panel-card"><div className="panel-body">กำลังโหลดภาพรวมจากฐานข้อมูล db_hrd...</div></div>;
  }
  if (!data) return null;

  const { kpi, shiftDistribution, deptSummaries, monthInfo } = data;
  const totalDist = Object.values(shiftDistribution).reduce((s, v) => s + v, 0) || 1;
  const activeDepts = deptSummaries.filter((d) => d.active_staff_count > 0 || d.total_shifts > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="hero-banner">
        <div>
          <div className="hero-badge">
            <Sparkles size={13} /> เชื่อมโยงข้อมูลบุคลากรและวันลาแบบ Real-time (db_hrd + ksp_travel)
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            ศูนย์บริหารตารางเวรและค่าตอบแทน • {orgInfo?.org_name || 'โรงพยาบาลโคกศรีสุพรรณ'}
          </h1>
          <div style={{ fontSize: 14, color: '#cbd5e1' }}>
            งวดประจำเดือน <strong style={{ color: '#ffffff' }}>{monthInfo.thaiMonthLabel}</strong> • ครอบคลุม {kpi.activeUnitsCount} หน่วยงาน และบุคลากรปฏิบัติงาน {fmtMoney(kpi.activeStaffCount)} คน
          </div>
        </div>
        <button className="btn btn-secondary" style={{ background: '#ffffff', color: '#0f766e', border: 'none' }} onClick={onGoToRoster}>
          เปิดจัดตารางเวรหน่วยงาน <ArrowRight size={16} />
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div>
            <div className="kpi-label">บุคลากรปฏิบัติงานจริง (db_hrd)</div>
            <div className="kpi-value num">{fmtMoney(kpi.activeStaffCount)} <span style={{ fontSize: 14, fontWeight: 500 }}>คน</span></div>
            <div className="kpi-sub">กระจายใน {kpi.activeUnitsCount} หน่วยงานที่เปิดบริการ</div>
          </div>
          <div className="kpi-icon-wrap" style={{ background: '#e0f2fe', color: '#0369a1' }}>
            <Users size={22} />
          </div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="kpi-label">เวรที่จัดแล้วทั้งโรงพยาบาล</div>
            <div className="kpi-value num">{fmtMoney(kpi.totalShifts)} <span style={{ fontSize: 14, fontWeight: 500 }}>เวร</span></div>
            <div className="kpi-sub num">รวม {fmtMoney(kpi.totalHours)} ชั่วโมง • อนุมัติแล้ว {kpi.rostersApproved}/{kpi.rostersStarted} ตาราง</div>
          </div>
          <div className="kpi-icon-wrap" style={{ background: '#ccfbf1', color: '#0f766e' }}>
            <CalendarClock size={22} />
          </div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="kpi-label">ประมาณการค่าตอบแทนรวมเดือนนี้</div>
            <div className="kpi-value num" style={{ color: '#0f766e' }}>฿{fmtMoney(kpi.grandTotal)}</div>
            <div className="kpi-sub">ค่าเวร + OT + พ.ต.ส./P4P ตามกลุ่มวิชาชีพ</div>
          </div>
          <div className="kpi-icon-wrap" style={{ background: '#dcfce7', color: '#15803d' }}>
            <Wallet size={22} />
          </div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="kpi-label">วันลา & คำขอแลกเวรเดือนนี้</div>
            <div className="kpi-value num">{fmtMoney(kpi.leavesThisMonth)} <span style={{ fontSize: 14, fontWeight: 500 }}>รายการลา</span></div>
            <div className="kpi-sub">คำขอแลกเวรรอพิจารณา {kpi.pendingSwaps} รายการ</div>
          </div>
          <div className="kpi-icon-wrap" style={{ background: '#fef3c7', color: '#b45309' }}>
            <ArrowLeftRight size={22} />
          </div>
        </div>
      </div>

      {/* Shift Distribution Bar */}
      <div className="panel-card">
        <div className="panel-header">
          <div className="panel-title">สัดส่วนประเภทเวรประจำเดือน {monthInfo.thaiMonthLabel}</div>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', background: '#f1f5f9', marginBottom: 14 }}>
            {shiftTypes
              .filter((s) => s.code !== 'OFF')
              .map((s) => {
                const count = shiftDistribution[s.code] || 0;
                const pct = (count / totalDist) * 100;
                if (!pct) return null;
                return (
                  <div
                    key={s.code}
                    title={`${s.label}: ${count} เวร (${pct.toFixed(1)}%)`}
                    style={{ width: `${pct}%`, background: s.color }}
                  />
                );
              })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {shiftTypes
              .filter((s) => s.code !== 'OFF')
              .map((s) => {
                const count = shiftDistribution[s.code] || 0;
                return (
                  <div
                    key={s.code}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: s.bg_color,
                      border: '1px solid rgba(15,23,42,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.code} • {s.label.split(' ')[0]}</div>
                      <div style={{ fontSize: 11, color: '#475569' }}>{s.time_range}</div>
                    </div>
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, color: s.color, flexShrink: 0 }}>{fmtMoney(count)}</div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Department Summary Table */}
      <div className="panel-card">
        <div className="panel-header">
          <div className="panel-title">
            <Building2 size={18} color="#0f766e" /> สถานะตารางเวรและงบประมาณรายหน่วยงาน
          </div>
          <span style={{ fontSize: 12.5, color: '#64748b' }}>คลิกที่หน่วยงานเพื่อเปิดหน้าจัดเวร 31 วันทันที</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>หน่วยงาน / หอผู้ป่วย</th>
                <th>กลุ่มงาน</th>
                <th className="text-center">บุคลากร</th>
                <th className="text-center">สถานะตารางเวร</th>
                <th className="text-right">จำนวนเวร</th>
                <th className="text-right">ชั่วโมงรวม</th>
                <th className="text-right">ค่าตอบแทนรวม (บาท)</th>
                <th className="text-center">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {activeDepts.map((d) => (
                <tr key={d.department_sub_id} style={{ cursor: 'pointer' }} onClick={() => onSelectUnit(d.department_sub_id)}>
                  <td style={{ fontWeight: 600 }}>{d.department_sub_name}</td>
                  <td style={{ color: '#64748b', fontSize: 12.5 }}>{d.department_name}</td>
                  <td className="text-center num">{d.active_staff_count}</td>
                  <td className="text-center">
                    <span className={`status-badge status-${d.status}`}>
                      {d.status === 'approved' || d.status === 'locked' ? <CheckCircle2 size={12} /> : null}
                      {d.statusLabel}
                    </span>
                  </td>
                  <td className="text-right num">{fmtMoney(d.total_shifts)}</td>
                  <td className="text-right num">{fmtMoney(d.total_hours)}</td>
                  <td className="text-right num" style={{ fontWeight: 700, color: '#0f766e' }}>
                    {d.total_pay > 0 ? `฿${fmtMoney(d.total_pay)}` : '-'}
                  </td>
                  <td className="text-center">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectUnit(d.department_sub_id);
                      }}
                    >
                      จัดตารางเวร
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
