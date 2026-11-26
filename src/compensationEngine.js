const { normalizeToCeDate } = require('./dateUtils');

const DEFAULT_RATE = {
  rate_key: 'support_staff',
  group_name: 'สายสนับสนุน / บริการ / ทั่วไป',
  afternoon_rate: 240,
  night_rate: 240,
  ot_weekday_hourly: 75,
  ot_holiday_hourly: 90,
  oncall_rate: 200,
  refer_rate: 300,
};

function resolveRateForPerson(positionName, rates = []) {
  const pos = String(positionName || '').trim();
  const sorted = [...rates].sort((a, b) => Number(a.sort_order || 99) - Number(b.sort_order || 99));
  for (const r of sorted) {
    const keywords = String(r.match_keywords || '')
      .split(/[|,]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (!keywords.length) continue;
    if (keywords.some((kw) => pos.includes(kw))) {
      return r;
    }
  }
  return sorted.find((r) => r.rate_key === 'support_staff') || DEFAULT_RATE;
}

function isNonWorkingShift(shiftCode) {
  return String(shiftCode || '').toUpperCase() === 'OFF';
}

function calculateAssignmentPay(assignment, rate, shiftType, isHoliday) {
  const code = String(assignment.shift_code || '').toUpperCase();
  const custom = assignment.custom_rate != null ? Number(assignment.custom_rate) : null;
  if (custom != null && !Number.isNaN(custom)) {
    return custom;
  }
  const hours = Number(assignment.hours || shiftType?.default_hours || 8);
  const holidayFlag = assignment.is_holiday != null ? Boolean(assignment.is_holiday) : Boolean(isHoliday);

  switch (code) {
    case 'A':
      return Number(rate.afternoon_rate || 0);
    case 'N':
      return Number(rate.night_rate || 0);
    case 'OT':
      return Math.round(hours * Number(holidayFlag ? rate.ot_holiday_hourly : rate.ot_weekday_hourly));
    case 'OC':
      return Number(rate.oncall_rate || 0);
    case 'REF':
      return Number(rate.refer_rate || 0);
    case 'M':
    case 'OFF':
    default:
      return 0;
  }
}

function calculatePersonCompensation({
  person,
  assignments = [],
  rate,
  shiftTypesMap = {},
  holidaysSet = new Set(),
  daysMap = {},
  adjustment = null,
}) {
  const effectiveRate = rate || DEFAULT_RATE;
  const counts = { M: 0, A: 0, N: 0, OT_WD: 0, OT_HD: 0, OC: 0, REF: 0, OFF: 0 };
  let afternoonPay = 0;
  let nightPay = 0;
  let otWeekdayPay = 0;
  let otHolidayPay = 0;
  let onCallPay = 0;
  let referPay = 0;
  let customPay = 0;
  let totalHours = 0;
  let otHours = 0;

  for (const a of assignments) {
    const code = String(a.shift_code || '').toUpperCase();
    const dateStr = normalizeToCeDate(a.work_date) || String(a.work_date || '').slice(0, 10);
    const dayMeta = daysMap[dateStr];
    const isHoliday = Boolean(a.is_holiday) || Boolean(dayMeta?.isWeekend) || holidaysSet.has(dateStr);
    const shiftType = shiftTypesMap[code];
    const hours = Number(a.hours || shiftType?.default_hours || 8);
    const pay = calculateAssignmentPay(a, effectiveRate, shiftType, isHoliday);

    if (code !== 'OFF') {
      totalHours += hours;
    }

    if (code === 'M') {
      counts.M += 1;
      customPay += pay;
    } else if (code === 'A') {
      counts.A += 1;
      afternoonPay += pay;
    } else if (code === 'N') {
      counts.N += 1;
      nightPay += pay;
    } else if (code === 'OT') {
      otHours += hours;
      if (isHoliday) {
        counts.OT_HD += 1;
        otHolidayPay += pay;
      } else {
        counts.OT_WD += 1;
        otWeekdayPay += pay;
      }
    } else if (code === 'OC') {
      counts.OC += 1;
      onCallPay += pay;
    } else if (code === 'REF') {
      counts.REF += 1;
      referPay += pay;
    } else if (code === 'OFF') {
      counts.OFF += 1;
    }
  }

  const ptsAmount = Number(adjustment?.pts_amount || 0);
  const p4pAmount = Number(adjustment?.p4p_amount || 0);
  const nonPracticeAmount = Number(adjustment?.non_practice_amount || 0);
  const otherAmount = Number(adjustment?.other_amount || 0);

  const shiftTotal = afternoonPay + nightPay + otWeekdayPay + otHolidayPay + onCallPay + referPay + customPay;
  const allowanceTotal = ptsAmount + p4pAmount + nonPracticeAmount + otherAmount;

  return {
    person_id: person.person_id,
    fullName: person.fullName,
    position_name: person.position_name,
    person_type_name: person.person_type_name,
    department_sub_name: person.department_sub_name,
    rate_group: effectiveRate.group_name,
    rate_key: effectiveRate.rate_key,
    counts,
    totalShifts: counts.M + counts.A + counts.N + counts.OT_WD + counts.OT_HD + counts.OC + counts.REF,
    totalHours,
    otHours,
    breakdown: {
      afternoonPay,
      nightPay,
      otWeekdayPay,
      otHolidayPay,
      onCallPay,
      referPay,
      customPay,
      ptsAmount,
      p4pAmount,
      nonPracticeAmount,
      otherAmount,
    },
    shiftTotal,
    allowanceTotal,
    grandTotal: shiftTotal + allowanceTotal,
    remark: adjustment?.remark || '',
  };
}

function analyzeRosterConflictsAndFatigue({
  people = [],
  assignments = [],
  leaveMap = {},
  travelMap = {},
  days = [],
}) {
  const byPersonDate = new Map();
  for (const a of assignments) {
    const d = normalizeToCeDate(a.work_date) || String(a.work_date || '').slice(0, 10);
    const key = `${a.person_id}:${d}`;
    if (!byPersonDate.has(key)) byPersonDate.set(key, []);
    byPersonDate.get(key).push(String(a.shift_code || '').toUpperCase());
  }

  const conflicts = [];
  const fatigueWarnings = [];
  const nightCounts = [];

  for (const p of people) {
    let consecutiveWork = 0;
    let maxConsecutive = 0;
    let personNightCount = 0;

    for (let idx = 0; idx < days.length; idx++) {
      const date = days[idx].date;
      const codes = byPersonDate.get(`${p.person_id}:${date}`) || [];
      const activeCodes = codes.filter((c) => !isNonWorkingShift(c));

      if (activeCodes.length > 0) {
        consecutiveWork += 1;
        if (consecutiveWork > maxConsecutive) maxConsecutive = consecutiveWork;
      } else {
        consecutiveWork = 0;
      }

      if (activeCodes.includes('N')) {
        personNightCount += 1;
        // Check double-back N -> M next day
        if (idx + 1 < days.length) {
          const nextDate = days[idx + 1].date;
          const nextCodes = byPersonDate.get(`${p.person_id}:${nextDate}`) || [];
          if (nextCodes.includes('M')) {
            fatigueWarnings.push({
              type: 'double_back',
              severity: 'high',
              person_id: p.person_id,
              fullName: p.fullName,
              date,
              nextDate,
              message: `${p.fullName} ลงเวรดึก (${date}) ต่อเวรเช้า (${nextDate})`,
            });
          }
        }
      }

      const leaves = leaveMap[`${p.person_id}:${date}`] || [];
      if (activeCodes.length > 0 && leaves.length > 0) {
        conflicts.push({
          type: 'leave',
          severity: 'critical',
          person_id: p.person_id,
          fullName: p.fullName,
          date,
          shifts: activeCodes,
          reason: leaves.map((l) => l.leave_type_name).join(', '),
          message: `${p.fullName} มีเวร [${activeCodes.join('+')}] ชนวันลา (${leaves.map((l) => l.leave_type_name).join(', ')}) วันที่ ${date}`,
        });
      }

      const travels = travelMap[`${p.person_id}:${date}`] || [];
      if (activeCodes.length > 0 && travels.length > 0) {
        conflicts.push({
          type: 'travel',
          severity: 'warning',
          person_id: p.person_id,
          fullName: p.fullName,
          date,
          shifts: activeCodes,
          reason: travels.map((t) => t.subject).join(', '),
          message: `${p.fullName} มีเวร [${activeCodes.join('+')}] ชนวันไปราชการ (${travels[0].subject}) วันที่ ${date}`,
        });
      }
    }

    if (maxConsecutive > 7) {
      fatigueWarnings.push({
        type: 'consecutive_streak',
        severity: 'medium',
        person_id: p.person_id,
        fullName: p.fullName,
        streak: maxConsecutive,
        message: `${p.fullName} ทำงานต่อเนื่อง ${maxConsecutive} วันติดกัน (เกิน 7 วัน)`,
      });
    }

    if (personNightCount > 10) {
      fatigueWarnings.push({
        type: 'excessive_night',
        severity: 'medium',
        person_id: p.person_id,
        fullName: p.fullName,
        nightCount: personNightCount,
        message: `${p.fullName} มีเวรดึก ${personNightCount} เวรในเดือนนี้ (เกิน 10 เวร)`,
      });
    }

    nightCounts.push({ person_id: p.person_id, fullName: p.fullName, nightCount: personNightCount });
  }

  const nightVals = nightCounts.map((n) => n.nightCount);
  const minNight = nightVals.length ? Math.min(...nightVals) : 0;
  const maxNight = nightVals.length ? Math.max(...nightVals) : 0;

  return {
    conflicts,
    fatigueWarnings,
    fairness: {
      minNight,
      maxNight,
      spread: maxNight - minNight,
      nightCounts,
    },
  };
}

function generateAutoSchedule({
  people = [],
  days = [],
  existingAssignments = [],
  leaveMap = {},
  travelMap = {},
  holidaysSet = new Set(),
  template = { morning: 2, afternoon: 2, night: 2 },
}) {
  if (!people.length || !days.length) return [];

  const existingByKey = new Map();
  const nightCount = new Map();
  const afternoonCount = new Map();
  const totalCount = new Map();

  for (const p of people) {
    nightCount.set(p.person_id, 0);
    afternoonCount.set(p.person_id, 0);
    totalCount.set(p.person_id, 0);
  }

  for (const a of existingAssignments) {
    const d = normalizeToCeDate(a.work_date) || String(a.work_date || '').slice(0, 10);
    const code = String(a.shift_code || '').toUpperCase();
    const key = `${a.person_id}:${d}`;
    if (!existingByKey.has(key)) existingByKey.set(key, new Set());
    existingByKey.get(key).add(code);
    if (code === 'N') nightCount.set(a.person_id, (nightCount.get(a.person_id) || 0) + 1);
    if (code === 'A') afternoonCount.set(a.person_id, (afternoonCount.get(a.person_id) || 0) + 1);
    if (code !== 'OFF') totalCount.set(a.person_id, (totalCount.get(a.person_id) || 0) + 1);
  }

  const generated = [];
  const prevDayShift = new Map();

  for (const dayObj of days) {
    const date = dayObj.date;
    const isHoliday = Boolean(dayObj.isWeekend) || holidaysSet.has(date);

    const isUnavailable = (personId) => {
      const k = `${personId}:${date}`;
      if ((leaveMap[k] || []).length > 0) return true;
      if ((travelMap[k] || []).length > 0) return true;
      const existing = existingByKey.get(k);
      if (existing && existing.size > 0) return true;
      return false;
    };

    const assignedToday = new Set();
    for (const p of people) {
      const existing = existingByKey.get(`${p.person_id}:${date}`);
      if (existing && existing.size > 0) {
        assignedToday.add(p.person_id);
      }
    }

    const pickCandidates = (shiftCode, needed) => {
      let existingForShift = 0;
      for (const p of people) {
        const existing = existingByKey.get(`${p.person_id}:${date}`);
        if (existing && existing.has(shiftCode)) existingForShift += 1;
      }
      const remaining = Math.max(0, Number(needed || 0) - existingForShift);
      if (remaining === 0) return;

      const eligible = people
        .filter((p) => {
          if (assignedToday.has(p.person_id) || isUnavailable(p.person_id)) return false;
          // Avoid N -> M double-back
          if (shiftCode === 'M' && prevDayShift.get(p.person_id) === 'N') return false;
          return true;
        })
        .sort((a, b) => {
          if (shiftCode === 'N') {
            const diff = (nightCount.get(a.person_id) || 0) - (nightCount.get(b.person_id) || 0);
            if (diff !== 0) return diff;
          } else if (shiftCode === 'A') {
            const diff = (afternoonCount.get(a.person_id) || 0) - (afternoonCount.get(b.person_id) || 0);
            if (diff !== 0) return diff;
          }
          return (totalCount.get(a.person_id) || 0) - (totalCount.get(b.person_id) || 0);
        });

      for (let i = 0; i < Math.min(remaining, eligible.length); i++) {
        const chosen = eligible[i];
        assignedToday.add(chosen.person_id);
        totalCount.set(chosen.person_id, (totalCount.get(chosen.person_id) || 0) + 1);
        if (shiftCode === 'N') nightCount.set(chosen.person_id, (nightCount.get(chosen.person_id) || 0) + 1);
        if (shiftCode === 'A') afternoonCount.set(chosen.person_id, (afternoonCount.get(chosen.person_id) || 0) + 1);
        prevDayShift.set(chosen.person_id, shiftCode);

        generated.push({
          person_id: chosen.person_id,
          work_date: date,
          shift_code: shiftCode,
          hours: 8,
          is_holiday: isHoliday ? 1 : 0,
        });
      }
    };

    pickCandidates('N', template.night || 0);
    pickCandidates('A', template.afternoon || 0);
    pickCandidates('M', template.morning || 0);

    for (const p of people) {
      if (!assignedToday.has(p.person_id)) {
        const existing = existingByKey.get(`${p.person_id}:${date}`);
        if (existing && existing.has('N')) prevDayShift.set(p.person_id, 'N');
        else if (existing && existing.has('A')) prevDayShift.set(p.person_id, 'A');
        else if (existing && existing.has('M')) prevDayShift.set(p.person_id, 'M');
        else prevDayShift.delete(p.person_id);
      }
    }
  }

  return generated;
}

module.exports = {
  DEFAULT_RATE,
  resolveRateForPerson,
  calculateAssignmentPay,
  calculatePersonCompensation,
  analyzeRosterConflictsAndFatigue,
  generateAutoSchedule,
};
