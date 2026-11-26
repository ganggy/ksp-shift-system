import React, { useEffect, useState } from 'react';
import { Search, Users, CalendarOff, Plane } from 'lucide-react';
import { api } from '../api';
import type { LeaveRecord, StaffMember, SubDepartment, TravelRecord } from '../types';

interface Props {
  yearMonth: string;
  subDepartments: SubDepartment[];
  defaultDeptSubId: number;
}

export const StaffLeaveSync: React.FC<Props> = ({ yearMonth, subDepartments, defaultDeptSubId }) => {
  const [deptSubId, setDeptSubId] = useState<number>(defaultDeptSubId);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'staff' | 'leaves' | 'travels'>('staff');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [travels, setTravels] = useState<TravelRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .staff({ yearMonth, departmentSubId: deptSubId || undefined, q: q || undefined })
      .then((res) => {
        if (!active) return;
        setStaff(res.staff || []);
        setLeaves(res.leaves || []);
        setTravels(res.travels || []);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [yearMonth, deptSubId, q]);

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <div className="panel-title">ทะเบียนบุคลากร วันลา และไปราชการ (เชื่อมโยงสดจาก db_hrd & ksp_travel)</div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>
            อ่านข้อมูลแบบ Read-only เพื่อตรวจสอบความพร้อมก่อนจัดเวรในแต่ละเดือน
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="control-group">
            <Search size={15} color="#64748b" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ / ตำแหน่ง..."
              style={{ width: 170 }}
            />
          </div>
          <div className="control-group">
            <select value={deptSubId} onChange={(e) => setDeptSubId(Number(e.target.value))}>
              <option value={0}>ทุกหน่วยงานทั้งโรงพยาบาล</option>
              {subDepartments.map((d) => (
                <option key={d.department_sub_id} value={d.department_sub_id}>
                  {d.department_sub_name} ({d.active_staff_count})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="brush-bar">
        <button className={`brush-pill ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>
          <Users size={14} color="#0f766e" /> รายชื่อบุคลากร ({staff.length})
        </button>
        <button className={`brush-pill ${tab === 'leaves' ? 'active' : ''}`} onClick={() => setTab('leaves')}>
          <CalendarOff size={14} color="#c2410c" /> วันลาเดือนนี้ ({leaves.length})
        </button>
        <button className={`brush-pill ${tab === 'travels' ? 'active' : ''}`} onClick={() => setTab('travels')}>
          <Plane size={14} color="#3730a3" /> ไปราชการ/อบรม ({travels.length})
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        {loading ? (
          <div className="panel-body">กำลังดึงข้อมูลจาก db_hrd...</div>
        ) : tab === 'staff' ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ชื่อ - สกุล</th>
                <th>ตำแหน่ง</th>
                <th>ระดับ / ประเภทบุคลากร</th>
                <th>หน่วยงาน</th>
                <th>กลุ่มงาน</th>
                <th className="text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s, i) => (
                <tr key={s.person_id}>
                  <td className="num">{i + 1}</td>
                  <td style={{ fontWeight: 700 }}>{s.fullName}</td>
                  <td>{s.position_name}</td>
                  <td style={{ fontSize: 12.5 }}>{s.level_type_name || '-'} • {s.person_type_name}</td>
                  <td>{s.department_sub_name}</td>
                  <td style={{ color: '#64748b', fontSize: 12.5 }}>{s.department_name}</td>
                  <td className="text-center">
                    <span className="status-badge status-approved">{s.person_status_name}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'leaves' ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>ชื่อ - สกุล</th>
                <th>หน่วยงาน</th>
                <th>ประเภทการลา</th>
                <th>วันที่เริ่ม</th>
                <th>ถึงวันที่</th>
                <th className="text-center">จำนวนวัน</th>
              </tr>
            </thead>
            <tbody>
              {leaves.length === 0 ? (
                <tr><td colSpan={6} className="text-center" style={{ padding: 24, color: '#64748b' }}>ไม่พบรายการลาในเดือนนี้</td></tr>
              ) : (
                leaves.map((l) => (
                  <tr key={l.hrd_leave_id}>
                    <td style={{ fontWeight: 700 }}>{l.fullName}</td>
                    <td>{l.department_sub_name}</td>
                    <td>
                      <span className="status-badge" style={{ background: '#ffedd5', color: '#9a3412' }}>
                        {l.leave_type_name} ({l.day_type_name})
                      </span>
                    </td>
                    <td className="num">{l.start_date}</td>
                    <td className="num">{l.end_date}</td>
                    <td className="text-center num">{l.leave_day}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ชื่อ - สกุล</th>
                <th>หน่วยงาน</th>
                <th>เรื่อง / ภารกิจ</th>
                <th>สถานที่</th>
                <th>วันที่เริ่ม</th>
                <th>ถึงวันที่</th>
                <th>แหล่งข้อมูล</th>
              </tr>
            </thead>
            <tbody>
              {travels.length === 0 ? (
                <tr><td colSpan={7} className="text-center" style={{ padding: 24, color: '#64748b' }}>ไม่พบรายการไปราชการ/อบรมในเดือนนี้</td></tr>
              ) : (
                travels.map((t, idx) => (
                  <tr key={`${t.source}-${t.travel_id}-${t.person_id}-${idx}`}>
                    <td style={{ fontWeight: 700 }}>{t.fullName}</td>
                    <td>{t.department_sub_name}</td>
                    <td>{t.subject}</td>
                    <td>{t.destination || '-'}</td>
                    <td className="num">{t.start_date}</td>
                    <td className="num">{t.end_date}</td>
                    <td><span className="status-badge status-locked">{t.source}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
