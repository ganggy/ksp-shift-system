const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeToCeDate, getMonthInfo, expandDateRange } = require('../src/dateUtils');
const {
  resolveRateForPerson,
  calculatePersonCompensation,
  analyzeRosterConflictsAndFatigue,
  generateAutoSchedule,
} = require('../src/compensationEngine');

const SAMPLE_RATES = [
  {
    rate_key: 'doctor',
    group_name: 'แพทย์',
    match_keywords: 'นายแพทย์|แพทย์หญิง',
    afternoon_rate: 800,
    night_rate: 1200,
    ot_weekday_hourly: 250,
    ot_holiday_hourly: 300,
    oncall_rate: 1000,
    refer_rate: 1200,
    sort_order: 1,
  },
  {
    rate_key: 'nurse',
    group_name: 'พยาบาลวิชาชีพ',
    match_keywords: 'พยาบาลวิชาชีพ',
    afternoon_rate: 360,
    night_rate: 360,
    ot_weekday_hourly: 100,
    ot_holiday_hourly: 120,
    oncall_rate: 300,
    refer_rate: 600,
    sort_order: 4,
  },
  {
    rate_key: 'support_staff',
    group_name: 'สายสนับสนุน / ทั่วไป',
    match_keywords: 'พนักงานบริการ|พนักงานขับรถยนต์',
    afternoon_rate: 240,
    night_rate: 240,
    ot_weekday_hourly: 75,
    ot_holiday_hourly: 90,
    oncall_rate: 200,
    refer_rate: 300,
    sort_order: 9,
  },
];

test('normalizeToCeDate converts Buddhist Era dates (>2400) to CE YYYY-MM-DD', () => {
  assert.equal(normalizeToCeDate('2569-11-26'), '2026-11-26');
  assert.equal(normalizeToCeDate('2567-06-26T17:00:00.000Z'), '2024-06-26');
  assert.equal(normalizeToCeDate('2026-11-05'), '2026-11-05');
  assert.equal(normalizeToCeDate(null), null);
});

test('getMonthInfo provides CE and BE bounds for dual-era queries', () => {
  const info = getMonthInfo('2026-11');
  assert.equal(info.daysInMonth, 30);
  assert.equal(info.startDate, '2026-11-01');
  assert.equal(info.beStartDate, '2569-11-01');
  assert.equal(info.thaiMonthLabel, 'พฤศจิกายน 2569');
});

test('expandDateRange expands BE ranges clamped to CE month window', () => {
  const dates = expandDateRange('2569-11-02', '2569-11-04', '2026-11-01', '2026-11-30');
  assert.deepEqual(dates, ['2026-11-02', '2026-11-03', '2026-11-04']);
});

test('resolveRateForPerson selects matching profession group or fallback', () => {
  assert.equal(resolveRateForPerson('พยาบาลวิชาชีพชำนาญการ', SAMPLE_RATES).rate_key, 'nurse');
  assert.equal(resolveRateForPerson('นายแพทย์ปฏิบัติการ', SAMPLE_RATES).rate_key, 'doctor');
  assert.equal(resolveRateForPerson('นักกายภาพบำบัด', SAMPLE_RATES).rate_key, 'support_staff');
});

test('calculatePersonCompensation computes shift pay, weekday/holiday OT, and allowances', () => {
  const nurseRate = resolveRateForPerson('พยาบาลวิชาชีพ', SAMPLE_RATES);
  const shiftTypesMap = {
    M: { default_hours: 8 },
    A: { default_hours: 8 },
    N: { default_hours: 8 },
    OT: { default_hours: 8 },
    OC: { default_hours: 8 },
    REF: { default_hours: 4 },
  };
  const monthInfo = getMonthInfo('2026-11');
  const daysMap = Object.fromEntries(monthInfo.days.map((d) => [d.date, d]));
  const holidaysSet = new Set(['2026-11-05']); // custom weekday holiday

  const result = calculatePersonCompensation({
    person: { person_id: 101, fullName: 'นางสาวทดสอบ ระบบ', position_name: 'พยาบาลวิชาชีพ' },
    assignments: [
      { work_date: '2026-11-02', shift_code: 'M', hours: 8 }, // Mon regular -> 0
      { work_date: '2026-11-03', shift_code: 'A', hours: 8 }, // +360
      { work_date: '2026-11-04', shift_code: 'N', hours: 8 }, // +360
      { work_date: '2026-11-04', shift_code: 'OT', hours: 4, is_holiday: 0 }, // 4 * 100 = 400
      { work_date: '2026-11-05', shift_code: 'OT', hours: 8 }, // custom holiday: 8 * 120 = 960
      { work_date: '2026-11-07', shift_code: 'OC', hours: 8 }, // +300
    ],
    rate: nurseRate,
    shiftTypesMap,
    holidaysSet,
    daysMap,
    adjustment: { pts_amount: 1500, p4p_amount: 2000, non_practice_amount: 0, other_amount: 0 },
  });

  assert.equal(result.breakdown.afternoonPay, 360);
  assert.equal(result.breakdown.nightPay, 360);
  assert.equal(result.breakdown.otWeekdayPay, 400);
  assert.equal(result.breakdown.otHolidayPay, 960);
  assert.equal(result.breakdown.onCallPay, 300);
  assert.equal(result.shiftTotal, 2380);
  assert.equal(result.allowanceTotal, 3500);
  assert.equal(result.grandTotal, 5880);
});

test('analyzeRosterConflictsAndFatigue detects leave conflicts, travel conflicts, and N->M double-back', () => {
  const monthInfo = getMonthInfo('2026-11');
  const people = [{ person_id: 1, fullName: 'นาย ก ทดสอบ' }];
  const assignments = [
    { person_id: 1, work_date: '2026-11-02', shift_code: 'N' },
    { person_id: 1, work_date: '2026-11-03', shift_code: 'M' }, // double-back + leave conflict
    { person_id: 1, work_date: '2026-11-05', shift_code: 'A' }, // travel conflict
  ];
  const leaveMap = { '1:2026-11-03': [{ leave_type_name: 'ลาพักผ่อน' }] };
  const travelMap = { '1:2026-11-05': [{ subject: 'ประชุม สสจ.' }] };

  const analysis = analyzeRosterConflictsAndFatigue({
    people,
    assignments,
    leaveMap,
    travelMap,
    days: monthInfo.days,
  });

  assert.equal(analysis.conflicts.length, 2);
  assert.equal(analysis.conflicts[0].type, 'leave');
  assert.equal(analysis.conflicts[1].type, 'travel');
  assert.equal(analysis.fatigueWarnings.some((w) => w.type === 'double_back'), true);
});

test('generateAutoSchedule skips leave/travel dates and avoids N->M double-back', () => {
  const monthInfo = getMonthInfo('2026-11');
  const days = monthInfo.days.slice(0, 5);
  const people = [
    { person_id: 1, fullName: 'พย. 1' },
    { person_id: 2, fullName: 'พย. 2' },
    { person_id: 3, fullName: 'พย. 3' },
    { person_id: 4, fullName: 'พย. 4' },
  ];
  const leaveMap = { '1:2026-11-01': [{ leave_type_name: 'ลาป่วย' }] };
  const generated = generateAutoSchedule({
    people,
    days,
    existingAssignments: [],
    leaveMap,
    travelMap: {},
    holidaysSet: new Set(),
    template: { morning: 1, afternoon: 1, night: 1 },
  });

  assert.equal(generated.some((g) => g.person_id === 1 && g.work_date === '2026-11-01'), false);
  assert.ok(generated.length >= 12);
});
