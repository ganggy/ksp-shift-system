export interface AuthUser {
  person_id: number;
  username: string;
  fullName: string;
  department_id: number;
  department_name: string;
  department_sub_id: number;
  department_sub_name: string;
  position_name: string;
  person_type_name: string;
  user_groups_id: number;
  userGroupLabel: string;
  isAdmin: boolean;
  isHead: boolean;
}

export interface OrgInfo {
  org_code: string;
  org_name: string;
  hospcode: string;
  org_leader_name: string;
  org_position_leader: string;
  org_nurse: string;
}

export interface Department {
  department_id: number;
  department_name: string;
}

export interface SubDepartment {
  department_sub_id: number;
  department_id: number;
  department_sub_name: string;
  department_name: string;
  active_staff_count: number;
}

export interface ShiftType {
  code: string;
  label: string;
  short_label: string;
  time_range: string;
  default_hours: number;
  color: string;
  bg_color: string;
  is_working: number;
  sort_order: number;
}

export interface CompensationRate {
  rate_key: string;
  group_name: string;
  match_keywords: string;
  afternoon_rate: number;
  night_rate: number;
  ot_weekday_hourly: number;
  ot_holiday_hourly: number;
  oncall_rate: number;
  refer_rate: number;
  sort_order: number;
}

export interface PublicHoliday {
  holiday_date: string;
  title: string;
  holiday_type: string;
}

export interface MonthDay {
  day: number;
  date: string;
  dow: number;
  thaiDow: string;
  isWeekend: boolean;
  isPublicHoliday?: boolean;
  holidayTitle?: string | null;
  isHoliday?: boolean;
}

export interface MonthInfo {
  year: number;
  month: number;
  beYear: number;
  yearMonth: string;
  daysInMonth: number;
  startDate: string;
  endDate: string;
  thaiMonthLabel: string;
  thaiShortMonthLabel: string;
  days: MonthDay[];
}

export interface StaffMember {
  person_id: number;
  fullName: string;
  nickname: string;
  department_id: number;
  department_name: string;
  department_sub_id: number;
  department_sub_name: string;
  position_id: number;
  position_name: string;
  position_groups_name: string;
  person_type_id: number;
  person_type_name: string;
  person_status_id: number;
  person_status_name: string;
  level_type_name: string;
}

export interface ShiftAssignment {
  id?: number;
  roster_id?: number;
  person_id: number;
  work_date: string;
  shift_code: string;
  hours: number;
  is_holiday: number;
  custom_rate?: number | null;
  note?: string | null;
}

export interface LeaveRecord {
  hrd_leave_id: number;
  person_id: number;
  fullName?: string;
  department_sub_name?: string;
  leave_type_id: number;
  leave_type_name: string;
  day_type_name: string;
  leave_day: number;
  color: string;
  start_date: string;
  end_date: string;
  dates: string[];
}

export interface TravelRecord {
  source: string;
  travel_id: number;
  person_id: number;
  fullName?: string;
  department_sub_name?: string;
  doc_no: string;
  subject: string;
  destination: string;
  start_date: string;
  end_date: string;
  dates: string[];
}

export interface PayrollRow {
  person_id: number;
  fullName: string;
  position_name: string;
  person_type_name: string;
  department_sub_name: string;
  rate_group: string;
  rate_key: string;
  counts: {
    M: number;
    A: number;
    N: number;
    OT_WD: number;
    OT_HD: number;
    OC: number;
    REF: number;
    OFF: number;
  };
  totalShifts: number;
  totalHours: number;
  otHours: number;
  breakdown: {
    afternoonPay: number;
    nightPay: number;
    otWeekdayPay: number;
    otHolidayPay: number;
    onCallPay: number;
    referPay: number;
    customPay: number;
    ptsAmount: number;
    p4pAmount: number;
    nonPracticeAmount: number;
    otherAmount: number;
  };
  shiftTotal: number;
  allowanceTotal: number;
  grandTotal: number;
  remark: string;
}

export interface RosterPayload {
  monthInfo: MonthInfo;
  department: SubDepartment | null;
  roster: {
    id: number;
    year_month: string;
    department_sub_id: number;
    status: 'draft' | 'submitted' | 'approved' | 'locked';
    statusLabel: string;
    budget_cap: number;
    note?: string | null;
    submitted_by?: string | null;
    approved_by?: string | null;
  };
  days: MonthDay[];
  people: StaffMember[];
  assignments: ShiftAssignment[];
  leaves: LeaveRecord[];
  leaveMap: Record<string, LeaveRecord[]>;
  travels: TravelRecord[];
  travelMap: Record<string, TravelRecord[]>;
  shiftTypes: ShiftType[];
  rates: CompensationRate[];
  payrollRows: PayrollRow[];
  totals: Record<string, number>;
  analysis: {
    conflicts: Array<{
      type: 'leave' | 'travel';
      severity: string;
      person_id: number;
      fullName: string;
      date: string;
      shifts: string[];
      reason: string;
      message: string;
    }>;
    fatigueWarnings: Array<{
      type: string;
      severity: string;
      person_id: number;
      fullName: string;
      message: string;
    }>;
    fairness: {
      minNight: number;
      maxNight: number;
      spread: number;
    };
  };
  dailyCoverage: Array<{
    date: string;
    day: number;
    M: number;
    A: number;
    N: number;
    OT: number;
    OC: number;
    REF: number;
  }>;
}

export interface OverviewPayload {
  monthInfo: MonthInfo;
  kpi: {
    activeStaffCount: number;
    activeUnitsCount: number;
    rostersStarted: number;
    rostersApproved: number;
    totalShifts: number;
    totalHours: number;
    grandTotal: number;
    pendingSwaps: number;
    leavesThisMonth: number;
  };
  shiftDistribution: Record<string, number>;
  deptSummaries: Array<{
    department_sub_id: number;
    department_sub_name: string;
    department_name: string;
    active_staff_count: number;
    status: string;
    statusLabel: string;
    budget_cap: number;
    total_pay: number;
    total_shifts: number;
    total_hours: number;
  }>;
}

export interface ShiftSwap {
  id: number;
  roster_id: number;
  year_month: string;
  department_sub_id: number;
  requester_person_id: number;
  requester_name: string;
  target_person_id: number | null;
  target_name: string | null;
  work_date: string;
  shift_code: string;
  swap_type: 'swap' | 'cover';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  detail_json: string | null;
  created_at: string;
}
