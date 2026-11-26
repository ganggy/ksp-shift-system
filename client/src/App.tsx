import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Wallet,
  ArrowLeftRight,
  Users,
  Settings,
  LogIn,
  LogOut,
  Calendar,
  Building2,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { api } from './api';
import type {
  AuthUser,
  CompensationRate,
  OrgInfo,
  OverviewPayload,
  PublicHoliday,
  RosterPayload,
  ShiftSwap,
  ShiftType,
  SubDepartment,
} from './types';
import { OverviewDashboard } from './components/OverviewDashboard';
import { ShiftRosterMatrix } from './components/ShiftRosterMatrix';
import { CompensationPayroll } from './components/CompensationPayroll';
import { ShiftSwapCenter } from './components/ShiftSwapCenter';
import { StaffLeaveSync } from './components/StaffLeaveSync';
import { AdminSettings } from './components/AdminSettings';
import { LoginModal } from './components/LoginModal';

type NavTab = 'overview' | 'roster' | 'payroll' | 'swaps' | 'staff' | 'settings';

function getInitialYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function App() {
  const [tab, setTab] = useState<NavTab>('overview');
  const [yearMonth, setYearMonth] = useState<string>(getInitialYearMonth());
  const [departmentSubId, setDepartmentSubId] = useState<number>(19); // ER default

  const [user, setUser] = useState<AuthUser | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [rates, setRates] = useState<CompensationRate[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);

  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [rosterData, setRosterData] = useState<RosterPayload | null>(null);
  const [swaps, setSwaps] = useState<ShiftSwap[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null);

  const showToast = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3600);
  }, []);

  const loadMeta = useCallback(async () => {
    const [meRes, metaRes] = await Promise.all([api.me(), api.meta()]);
    setUser(meRes.user || null);
    setOrgInfo(metaRes.orgInfo || null);
    const depts: SubDepartment[] = metaRes.subDepartments || [];
    setSubDepartments(depts);
    setShiftTypes(metaRes.shiftTypes || []);
    setRates(metaRes.rates || []);
    setHolidays(metaRes.holidays || []);

    if (depts.length && !depts.some((d) => Number(d.department_sub_id) === departmentSubId)) {
      setDepartmentSubId(Number(depts[0].department_sub_id));
    }
  }, [departmentSubId]);

  const loadViewData = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, ros, sw] = await Promise.all([
        api.overview(yearMonth),
        api.roster(yearMonth, departmentSubId),
        api.swaps(yearMonth, departmentSubId),
      ]);
      setOverview(ov);
      setRosterData(ros);
      setSwaps(sw.swaps || []);
    } catch (err: any) {
      showToast(err.message || 'โหลดข้อมูลไม่สำเร็จ', true);
    } finally {
      setLoading(false);
    }
  }, [yearMonth, departmentSubId, showToast]);

  useEffect(() => {
    loadMeta().catch((err) => showToast(err.message, true));
  }, [loadMeta, showToast]);

  useEffect(() => {
    loadViewData();
  }, [loadViewData]);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    showToast('ออกจากระบบแล้ว');
  };

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'ภาพรวมผู้บริหาร', icon: <LayoutDashboard size={18} /> },
    { id: 'roster', label: 'จัดตารางเวร 31 วัน', icon: <CalendarDays size={18} /> },
    { id: 'payroll', label: 'คำนวณค่าตอบแทน', icon: <Wallet size={18} /> },
    { id: 'swaps', label: 'แลกเวร / แทนเวร', icon: <ArrowLeftRight size={18} /> },
    { id: 'staff', label: 'บุคลากร & วันลา (HRD)', icon: <Users size={18} /> },
    { id: 'settings', label: 'ตั้งค่าอัตรา & วันหยุด', icon: <Settings size={18} /> },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-icon">
            <CalendarDays size={22} />
          </div>
          <div>
            <div className="brand-title">KSP Smart Shift</div>
            <div className="brand-sub">ระบบจัดเวร & ค่าตอบแทน</div>
          </div>
        </div>

        <div className="nav-section-label">เมนูการทำงานหลัก</div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-btn ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sync-pill">
            <span className="dot-live" /> เชื่อมต่อ db_hrd สด
          </div>
          <div style={{ marginTop: 8, color: '#94a3b8', lineHeight: 1.4 }}>
            {orgInfo?.org_name || 'โรงพยาบาลโคกศรีสุพรรณ'}
            <br />
            พอร์ต 3536 • KSP Hub
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
              {navItems.find((n) => n.id === tab)?.label}
            </h2>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {rosterData?.monthInfo?.thaiMonthLabel || yearMonth} • {rosterData?.department?.department_sub_name || 'ทุกหน่วยงาน'}
            </div>
          </div>

          <div className="topbar-controls">
            <div className="control-group" title="เลือกเดือน/ปี">
              <Calendar size={15} color="#0f766e" />
              <input
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
              />
            </div>

            <div className="control-group" title="เลือกหน่วยงาน">
              <Building2 size={15} color="#0f766e" />
              <select
                value={departmentSubId}
                onChange={(e) => setDepartmentSubId(Number(e.target.value))}
                style={{ maxWidth: 230 }}
              >
                {subDepartments.map((d) => (
                  <option key={d.department_sub_id} value={d.department_sub_id}>
                    {d.department_sub_name} ({d.active_staff_count} คน)
                  </option>
                ))}
              </select>
            </div>

            <button type="button" className="btn btn-secondary btn-sm" onClick={loadViewData} title="รีเฟรชข้อมูล">
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>

            {user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="status-badge status-approved" style={{ padding: '6px 12px' }}>
                  <ShieldCheck size={14} /> {user.fullName}
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>
                  <LogOut size={14} /> ออก
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowLogin(true)}>
                <LogIn size={14} /> เข้าสู่ระบบเพื่อแก้ไข
              </button>
            )}
          </div>
        </header>

        <main className="page-content">
          {tab === 'overview' && (
            <OverviewDashboard
              data={overview}
              orgInfo={orgInfo}
              shiftTypes={shiftTypes}
              loading={loading}
              onSelectUnit={(deptId) => {
                setDepartmentSubId(deptId);
                setTab('roster');
              }}
              onGoToRoster={() => setTab('roster')}
            />
          )}

          {tab === 'roster' && (
            <ShiftRosterMatrix
              data={rosterData}
              loading={loading}
              user={user}
              yearMonth={yearMonth}
              departmentSubId={departmentSubId}
              onRefresh={loadViewData}
              onRequireLogin={() => setShowLogin(true)}
              onToast={showToast}
            />
          )}

          {tab === 'payroll' && (
            <CompensationPayroll
              data={rosterData}
              loading={loading}
              user={user}
              yearMonth={yearMonth}
              departmentSubId={departmentSubId}
              onRefresh={loadViewData}
              onRequireLogin={() => setShowLogin(true)}
              onToast={showToast}
            />
          )}

          {tab === 'swaps' && (
            <ShiftSwapCenter
              swaps={swaps}
              people={rosterData?.people || []}
              shiftTypes={shiftTypes}
              user={user}
              yearMonth={yearMonth}
              departmentSubId={departmentSubId}
              onRefresh={loadViewData}
              onRequireLogin={() => setShowLogin(true)}
              onToast={showToast}
            />
          )}

          {tab === 'staff' && (
            <StaffLeaveSync
              yearMonth={yearMonth}
              subDepartments={subDepartments}
              defaultDeptSubId={departmentSubId}
            />
          )}

          {tab === 'settings' && (
            <AdminSettings
              rates={rates}
              holidays={holidays}
              user={user}
              onRefreshMeta={loadMeta}
              onRequireLogin={() => setShowLogin(true)}
              onToast={showToast}
            />
          )}
        </main>
      </div>

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={(u) => {
            setUser(u);
            setShowLogin(false);
            showToast(`ยินดีต้อนรับ ${u.fullName}`);
          }}
        />
      )}

      {toast && (
        <div className={`toast ${toast.isError ? 'error' : ''}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export default App;
