require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const {
  hrdPool,
  appPool,
  md5,
  initDatabase,
  getOrgInfo,
  getDepartments,
  getStaffList,
  getLeavesForMonth,
  getTravelForMonth,
  logAudit,
} = require('./src/db');
const { getMonthInfo, getPrevYearMonth, normalizeToCeDate } = require('./src/dateUtils');
const {
  resolveRateForPerson,
  calculatePersonCompensation,
  analyzeRosterConflictsAndFatigue,
  generateAutoSchedule,
} = require('./src/compensationEngine');
const { generateRosterAndPayrollPdf } = require('./src/pdfExport');
const { generateRosterAndPayrollExcel } = require('./src/excelExport');

const app = express();
const PORT = Number(process.env.PORT || 3536);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'ksp-shift-ot-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

const STATUS_LABELS = {
  draft: 'ฉบับร่าง',
  submitted: 'รอหัวหน้า/การเงินตรวจ',
  approved: 'อนุมัติแล้ว',
  locked: 'ล็อกงวดเบิกจ่าย',
};

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.user?.isAdmin) {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบหรือเจ้าหน้าที่ธุรการ/การเงินเท่านั้น' });
  }
  next();
}

function requireAdminOrHead(req, res, next) {
  if (!req.session?.user || (!req.session.user.isAdmin && !req.session.user.isHead)) {
    return res.status(403).json({ error: 'เฉพาะหัวหน้าหน่วยงานหรือผู้ดูแลระบบเท่านั้น' });
  }
  next();
}

async function getReferenceConfig() {
  const [shiftTypes] = await appPool.query('SELECT * FROM shift_types ORDER BY sort_order, code');
  const [rates] = await appPool.query('SELECT * FROM compensation_rates ORDER BY sort_order, rate_key');
  const [holidays] = await appPool.query('SELECT holiday_date, title, holiday_type FROM public_holidays ORDER BY holiday_date');
  return { shiftTypes, rates, holidays };
}

async function ensureRoster(yearMonth, departmentSubId, actorName = 'System') {
  const [existing] = await appPool.query(
    'SELECT * FROM shift_rosters WHERE roster_month = ? AND department_sub_id = ? LIMIT 1',
    [yearMonth, Number(departmentSubId)]
  );
  if (existing.length) return { ...existing[0], year_month: existing[0].roster_month };

  await appPool.query(
    `INSERT IGNORE INTO shift_rosters (roster_month, department_sub_id, status, created_by)
     VALUES (?, ?, 'draft', ?)`,
    [yearMonth, Number(departmentSubId), actorName]
  );
  const [rows] = await appPool.query(
    'SELECT * FROM shift_rosters WHERE roster_month = ? AND department_sub_id = ? LIMIT 1',
    [yearMonth, Number(departmentSubId)]
  );
  return { ...rows[0], year_month: rows[0].roster_month };
}

async function buildFullRosterPayload(yearMonth, departmentSubId) {
  const monthInfo = getMonthInfo(yearMonth);
  const deptIdNum = Number(departmentSubId);

  const [{ shiftTypes, rates, holidays }, { subDepartments }, people] = await Promise.all([
    getReferenceConfig(),
    getDepartments(),
    getStaffList({ departmentSubId: deptIdNum }),
  ]);

  const deptMeta = subDepartments.find((d) => Number(d.department_sub_id) === deptIdNum) || null;
  const roster = await ensureRoster(monthInfo.yearMonth, deptIdNum);

  const personIds = people.map((p) => p.person_id);
  const [{ leaves, leaveMap }, { travels, travelMap }, [assignments], [adjustments]] = await Promise.all([
    getLeavesForMonth(monthInfo, personIds),
    getTravelForMonth(monthInfo, personIds),
    appPool.query(
      'SELECT * FROM shift_assignments WHERE roster_id = ? ORDER BY work_date, person_id, shift_code',
      [roster.id]
    ),
    appPool.query(
      'SELECT * FROM compensation_adjustments WHERE roster_month = ? AND department_sub_id = ?',
      [monthInfo.yearMonth, deptIdNum]
    ),
  ]);

  const shiftTypesMap = Object.fromEntries(shiftTypes.map((s) => [s.code, s]));
  const holidaysSet = new Set(holidays.map((h) => normalizeToCeDate(h.holiday_date)).filter(Boolean));
  const holidayTitleMap = Object.fromEntries(
    holidays.map((h) => [normalizeToCeDate(h.holiday_date), h.title])
  );
  const days = monthInfo.days.map((d) => ({
    ...d,
    isPublicHoliday: holidaysSet.has(d.date),
    holidayTitle: holidayTitleMap[d.date] || null,
    isHoliday: d.isWeekend || holidaysSet.has(d.date),
  }));
  const daysMap = Object.fromEntries(days.map((d) => [d.date, d]));
  const adjMap = new Map(adjustments.map((a) => [Number(a.person_id), a]));

  const assignByPerson = new Map();
  for (const a of assignments) {
    const pid = Number(a.person_id);
    if (!assignByPerson.has(pid)) assignByPerson.set(pid, []);
    assignByPerson.get(pid).push(a);
  }

  const payrollRows = people.map((person) => {
    const rate = resolveRateForPerson(person.position_name, rates);
    return calculatePersonCompensation({
      person,
      assignments: assignByPerson.get(person.person_id) || [],
      rate,
      shiftTypesMap,
      holidaysSet,
      daysMap,
      adjustment: adjMap.get(person.person_id) || null,
    });
  });

  const totals = payrollRows.reduce(
    (acc, r) => {
      acc.afternoonPay += r.breakdown.afternoonPay;
      acc.nightPay += r.breakdown.nightPay;
      acc.otWeekdayPay += r.breakdown.otWeekdayPay;
      acc.otHolidayPay += r.breakdown.otHolidayPay;
      acc.onCallPay += r.breakdown.onCallPay;
      acc.referPay += r.breakdown.referPay;
      acc.ptsAmount += r.breakdown.ptsAmount;
      acc.p4pAmount += r.breakdown.p4pAmount;
      acc.nonPracticeAmount += r.breakdown.nonPracticeAmount;
      acc.otherAmount += r.breakdown.otherAmount;
      acc.shiftTotal += r.shiftTotal;
      acc.allowanceTotal += r.allowanceTotal;
      acc.grandTotal += r.grandTotal;
      acc.totalHours += r.totalHours;
      return acc;
    },
    {
      afternoonPay: 0,
      nightPay: 0,
      otWeekdayPay: 0,
      otHolidayPay: 0,
      onCallPay: 0,
      referPay: 0,
      ptsAmount: 0,
      p4pAmount: 0,
      nonPracticeAmount: 0,
      otherAmount: 0,
      shiftTotal: 0,
      allowanceTotal: 0,
      grandTotal: 0,
      totalHours: 0,
    }
  );

  const analysis = analyzeRosterConflictsAndFatigue({
    people,
    assignments,
    leaveMap,
    travelMap,
    days,
  });

  const dailyCoverage = days.map((d) => {
    const counts = { M: 0, A: 0, N: 0, OT: 0, OC: 0, REF: 0 };
    for (const a of assignments) {
      if (String(a.work_date).slice(0, 10) === d.date && counts[a.shift_code] != null) {
        counts[a.shift_code] += 1;
      }
    }
    return { date: d.date, day: d.day, ...counts };
  });

  return {
    monthInfo,
    department: deptMeta,
    roster: {
      ...roster,
      statusLabel: STATUS_LABELS[roster.status] || roster.status,
    },
    days,
    people,
    assignments,
    leaves,
    leaveMap,
    travels,
    travelMap,
    shiftTypes,
    rates,
    payrollRows,
    totals,
    analysis,
    dailyCoverage,
  };
}

// ==================== HEALTH ====================
app.get('/api/health', async (_req, res) => {
  try {
    await hrdPool.query('SELECT 1');
    await appPool.query('SELECT 1');
    res.json({
      ok: true,
      status: 'ok',
      hrdDb: 'connected',
      appDb: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, status: 'degraded', error: err.message });
  }
});

// ==================== AUTH ====================
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session?.user || null });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้ (หรือเลขบัตรประชาชน) และรหัสผ่าน' });
    }
    const u = String(username).trim();
    const rawPass = String(password).trim();
    const pHash = md5(rawPass);

    const [rows] = await hrdPool.query(
      `SELECT p.person_id, p.fname, p.lname, p.username, p.user_groups_id,
              p.department_id, p.department_sub_id, p.position_id, p.person_type_id,
              pn.prename_name, pos.position_name, d.department_name, ds.department_sub_name,
              d.head_department, ds.department_head, ug.user_groups_th, pt.person_type_name
       FROM hrd_person p
       LEFT JOIN hrd_prename pn ON pn.prename_id = p.prename_id
       LEFT JOIN hrd_position pos ON pos.position_id = p.position_id
       LEFT JOIN hrd_department d ON d.department_id = p.department_id
       LEFT JOIN hrd_department_sub ds ON ds.department_sub_id = p.department_sub_id
       LEFT JOIN hrd_user_groups ug ON ug.user_groups_id = p.user_groups_id
       LEFT JOIN hrd_person_type pt ON pt.person_type_id = p.person_type_id
       WHERE (p.username = ? OR p.cid = ?) AND (p.password = ? OR p.password = ?)
       LIMIT 1`,
      [u, u, pHash, rawPass]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = rows[0];
    const [headCheck] = await hrdPool.query(
      `SELECT 1 FROM hrd_department WHERE head_department = ?
       UNION
       SELECT 1 FROM hrd_department_sub WHERE department_head = ? LIMIT 1`,
      [user.person_id, user.person_id]
    );

    const fullName = `${user.prename_name || ''}${String(user.fname || '').trim()} ${String(user.lname || '').trim()}`.trim();
    const isAdmin = [1, 2].includes(Number(user.user_groups_id));
    const isHead = isAdmin || headCheck.length > 0;

    req.session.user = {
      person_id: user.person_id,
      username: user.username,
      fullName,
      department_id: user.department_id,
      department_name: user.department_name || '',
      department_sub_id: user.department_sub_id,
      department_sub_name: user.department_sub_name || '',
      position_name: user.position_name || '',
      person_type_name: user.person_type_name || '',
      user_groups_id: Number(user.user_groups_id || 3),
      userGroupLabel: user.user_groups_th || 'ผู้ใช้งานทั่วไป',
      isAdmin,
      isHead,
    };

    res.json({ user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'ไม่สามารถเชื่อมต่อฐานข้อมูลบุคลากรได้' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ==================== META ====================
app.get('/api/meta', async (_req, res) => {
  try {
    const [orgInfo, deptData, ref] = await Promise.all([
      getOrgInfo(),
      getDepartments(),
      getReferenceConfig(),
    ]);
    res.json({
      orgInfo,
      departments: deptData.departments,
      subDepartments: deptData.subDepartments,
      shiftTypes: ref.shiftTypes,
      rates: ref.rates,
      holidays: ref.holidays,
    });
  } catch (err) {
    console.error('Meta error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== EXECUTIVE OVERVIEW ====================
app.get('/api/overview', async (req, res) => {
  try {
    const monthInfo = getMonthInfo(req.query.yearMonth);
    const [{ subDepartments }, ref, [rosters], [assignments], [adjustments], [pendingSwaps], allStaff] =
      await Promise.all([
        getDepartments(),
        getReferenceConfig(),
        appPool.query('SELECT * FROM shift_rosters WHERE roster_month = ?', [monthInfo.yearMonth]),
        appPool.query(
          `SELECT a.*, r.department_sub_id
           FROM shift_assignments a
           JOIN shift_rosters r ON r.id = a.roster_id
           WHERE r.roster_month = ?`,
          [monthInfo.yearMonth]
        ),
        appPool.query('SELECT * FROM compensation_adjustments WHERE roster_month = ?', [monthInfo.yearMonth]),
        appPool.query(
          `SELECT COUNT(*) AS cnt FROM shift_swaps WHERE roster_month = ? AND status = 'pending'`,
          [monthInfo.yearMonth]
        ),
        getStaffList({}),
      ]);

    const shiftTypesMap = Object.fromEntries(ref.shiftTypes.map((s) => [s.code, s]));
    const holidaysSet = new Set(ref.holidays.map((h) => normalizeToCeDate(h.holiday_date)).filter(Boolean));
    const daysMap = Object.fromEntries(monthInfo.days.map((d) => [d.date, d]));

    const staffMap = new Map(allStaff.map((p) => [Number(p.person_id), p]));
    const rosterByDept = new Map(rosters.map((r) => [Number(r.department_sub_id), r]));
    const assignByDeptPerson = new Map();
    const shiftDistribution = { M: 0, A: 0, N: 0, OT: 0, OC: 0, REF: 0 };

    for (const a of assignments) {
      if (shiftDistribution[a.shift_code] != null) shiftDistribution[a.shift_code] += 1;
      const key = `${a.department_sub_id}:${a.person_id}`;
      if (!assignByDeptPerson.has(key)) assignByDeptPerson.set(key, []);
      assignByDeptPerson.get(key).push(a);
    }

    const adjMap = new Map(adjustments.map((a) => [`${a.department_sub_id}:${a.person_id}`, a]));

    let grandTotal = 0;
    let totalShifts = 0;
    let totalHours = 0;
    const deptSummaries = [];

    for (const dept of subDepartments) {
      const deptStaff = allStaff.filter((p) => Number(p.department_sub_id) === Number(dept.department_sub_id));
      let deptPay = 0;
      let deptShifts = 0;
      let deptHours = 0;

      for (const p of deptStaff) {
        const key = `${dept.department_sub_id}:${p.person_id}`;
        const pAssign = assignByDeptPerson.get(key) || [];
        const adj = adjMap.get(key) || null;
        if (!pAssign.length && !adj) continue;
        const rate = resolveRateForPerson(p.position_name, ref.rates);
        const calc = calculatePersonCompensation({
          person: p,
          assignments: pAssign,
          rate,
          shiftTypesMap,
          holidaysSet,
          daysMap,
          adjustment: adj,
        });
        deptPay += calc.grandTotal;
        deptShifts += calc.totalShifts;
        deptHours += calc.totalHours;
      }

      const roster = rosterByDept.get(Number(dept.department_sub_id));
      grandTotal += deptPay;
      totalShifts += deptShifts;
      totalHours += deptHours;

      deptSummaries.push({
        department_sub_id: dept.department_sub_id,
        department_sub_name: dept.department_sub_name,
        department_name: dept.department_name,
        active_staff_count: Number(dept.active_staff_count || 0),
        status: roster?.status || 'unstarted',
        statusLabel: roster ? STATUS_LABELS[roster.status] : 'ยังไม่เริ่มจัดเวร',
        budget_cap: Number(roster?.budget_cap || 0),
        total_pay: deptPay,
        total_shifts: deptShifts,
        total_hours: deptHours,
      });
    }

    // Leave count for this month
    const { leaves } = await getLeavesForMonth(monthInfo);

    res.json({
      monthInfo,
      kpi: {
        activeStaffCount: allStaff.length,
        activeUnitsCount: subDepartments.filter((d) => Number(d.active_staff_count) > 0).length,
        rostersStarted: rosters.length,
        rostersApproved: rosters.filter((r) => r.status === 'approved' || r.status === 'locked').length,
        totalShifts,
        totalHours,
        grandTotal,
        pendingSwaps: Number(pendingSwaps[0]?.cnt || 0),
        leavesThisMonth: leaves.length,
      },
      shiftDistribution,
      deptSummaries,
      staffSampleCount: staffMap.size,
    });
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROSTER ====================
app.get('/api/roster', async (req, res) => {
  try {
    const yearMonth = req.query.yearMonth;
    let departmentSubId = Number(req.query.departmentSubId || 0);
    if (!departmentSubId) {
      const { subDepartments } = await getDepartments();
      departmentSubId = Number(subDepartments[0]?.department_sub_id || 19);
    }
    const payload = await buildFullRosterPayload(yearMonth, departmentSubId);
    res.json(payload);
  } catch (err) {
    console.error('Get roster error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roster/cell', requireAuth, async (req, res) => {
  try {
    const { yearMonth, departmentSubId, person_id, work_date, shifts } = req.body || {};
    if (!yearMonth || !departmentSubId || !person_id || !work_date) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    }
    const roster = await ensureRoster(yearMonth, departmentSubId, req.session.user.fullName);
    if (roster.status === 'locked' && !req.session.user.isAdmin) {
      return res.status(403).json({ error: 'ตารางเวรถูกล็อกงวดแล้ว กรุณาติดต่อผู้ดูแลระบบ' });
    }

    const cleanDate = normalizeToCeDate(work_date);
    const conn = await appPool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        'DELETE FROM shift_assignments WHERE roster_id = ? AND person_id = ? AND work_date = ?',
        [roster.id, Number(person_id), cleanDate]
      );

      const list = Array.isArray(shifts) ? shifts : [];
      for (const s of list) {
        const code = String(s.shift_code || '').toUpperCase().trim();
        if (!code) continue;
        await conn.query(
          `INSERT INTO shift_assignments (roster_id, person_id, work_date, shift_code, hours, is_holiday, custom_rate, note, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            roster.id,
            Number(person_id),
            cleanDate,
            code,
            Number(s.hours ?? 8),
            s.is_holiday ? 1 : 0,
            s.custom_rate != null && s.custom_rate !== '' ? Number(s.custom_rate) : null,
            s.note ? String(s.note).slice(0, 255) : null,
            req.session.user.fullName,
          ]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAudit(req.session.user, 'UPDATE_CELL', 'shift_assignments', `${roster.id}:${person_id}:${cleanDate}`, {
      shifts,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Update cell error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roster/batch', requireAuth, async (req, res) => {
  try {
    const { yearMonth, departmentSubId, items, mode = 'replace' } = req.body || {};
    if (!yearMonth || !departmentSubId || !Array.isArray(items)) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    }
    const roster = await ensureRoster(yearMonth, departmentSubId, req.session.user.fullName);
    if (roster.status === 'locked' && !req.session.user.isAdmin) {
      return res.status(403).json({ error: 'ตารางเวรถูกล็อกงวดแล้ว' });
    }

    const conn = await appPool.getConnection();
    try {
      await conn.beginTransaction();
      if (mode === 'clear_all') {
        await conn.query('DELETE FROM shift_assignments WHERE roster_id = ?', [roster.id]);
      }
      for (const item of items) {
        const cleanDate = normalizeToCeDate(item.work_date);
        if (!cleanDate || !item.person_id) continue;
        if (mode === 'replace') {
          await conn.query(
            'DELETE FROM shift_assignments WHERE roster_id = ? AND person_id = ? AND work_date = ?',
            [roster.id, Number(item.person_id), cleanDate]
          );
        }
        const code = String(item.shift_code || '').toUpperCase().trim();
        if (!code) continue;
        await conn.query(
          `INSERT INTO shift_assignments (roster_id, person_id, work_date, shift_code, hours, is_holiday, custom_rate, note, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE hours = VALUES(hours), is_holiday = VALUES(is_holiday), updated_by = VALUES(updated_by)`,
          [
            roster.id,
            Number(item.person_id),
            cleanDate,
            code,
            Number(item.hours ?? 8),
            item.is_holiday ? 1 : 0,
            item.custom_rate != null ? Number(item.custom_rate) : null,
            item.note || null,
            req.session.user.fullName,
          ]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAudit(req.session.user, 'BATCH_UPDATE', 'shift_rosters', roster.id, {
      mode,
      count: items.length,
    });
    res.json({ ok: true, count: items.length });
  } catch (err) {
    console.error('Batch update error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roster/auto-generate', requireAuth, async (req, res) => {
  try {
    const { yearMonth, departmentSubId, template, overwrite = false } = req.body || {};
    const payload = await buildFullRosterPayload(yearMonth, departmentSubId);
    if (payload.roster.status === 'locked' && !req.session.user.isAdmin) {
      return res.status(403).json({ error: 'ตารางเวรถูกล็อกงวดแล้ว' });
    }

    const holidaysSet = new Set(payload.days.filter((d) => d.isPublicHoliday).map((d) => d.date));
    const existing = overwrite ? [] : payload.assignments;
    const generated = generateAutoSchedule({
      people: payload.people,
      days: payload.days,
      existingAssignments: existing,
      leaveMap: payload.leaveMap,
      travelMap: payload.travelMap,
      holidaysSet,
      template: template || { morning: 2, afternoon: 2, night: 2 },
    });

    const conn = await appPool.getConnection();
    try {
      await conn.beginTransaction();
      if (overwrite) {
        await conn.query('DELETE FROM shift_assignments WHERE roster_id = ?', [payload.roster.id]);
      }
      for (const g of generated) {
        await conn.query(
          `INSERT IGNORE INTO shift_assignments (roster_id, person_id, work_date, shift_code, hours, is_holiday, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [payload.roster.id, g.person_id, g.work_date, g.shift_code, g.hours, g.is_holiday, req.session.user.fullName]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAudit(req.session.user, 'AUTO_GENERATE', 'shift_rosters', payload.roster.id, {
      generatedCount: generated.length,
      overwrite,
      template,
    });
    res.json({ ok: true, generatedCount: generated.length });
  } catch (err) {
    console.error('Auto generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roster/copy-previous', requireAuth, async (req, res) => {
  try {
    const { yearMonth, departmentSubId } = req.body || {};
    const targetInfo = getMonthInfo(yearMonth);
    const prevYm = getPrevYearMonth(targetInfo.yearMonth);
    const deptIdNum = Number(departmentSubId);

    const targetRoster = await ensureRoster(targetInfo.yearMonth, deptIdNum, req.session.user.fullName);
    if (targetRoster.status === 'locked' && !req.session.user.isAdmin) {
      return res.status(403).json({ error: 'ตารางเวรถูกล็อกงวดแล้ว' });
    }

    const [prevRosters] = await appPool.query(
      'SELECT * FROM shift_rosters WHERE roster_month = ? AND department_sub_id = ? LIMIT 1',
      [prevYm, deptIdNum]
    );
    if (!prevRosters.length) {
      return res.status(404).json({ error: `ไม่พบตารางเวรเดือนก่อนหน้า (${prevYm})` });
    }

    const [prevAssignments] = await appPool.query(
      'SELECT * FROM shift_assignments WHERE roster_id = ?',
      [prevRosters[0].id]
    );
    if (!prevAssignments.length) {
      return res.status(404).json({ error: `เดือนก่อนหน้า (${prevYm}) ยังไม่มีข้อมูลเวร` });
    }

    const targetDaysMap = Object.fromEntries(targetInfo.days.map((d) => [d.day, d]));
    const [{ holidays }, people] = await Promise.all([
      getReferenceConfig(),
      getStaffList({ departmentSubId: deptIdNum }),
    ]);
    const holidaysSet = new Set(holidays.map((h) => normalizeToCeDate(h.holiday_date)).filter(Boolean));
    const personIds = people.map((p) => p.person_id);
    const [{ leaveMap }, { travelMap }] = await Promise.all([
      getLeavesForMonth(targetInfo, personIds),
      getTravelForMonth(targetInfo, personIds),
    ]);

    let copied = 0;
    let skippedConflicts = 0;
    for (const a of prevAssignments) {
      const prevDayNum = Number(String(a.work_date).slice(8, 10));
      const targetDay = targetDaysMap[prevDayNum];
      if (!targetDay) continue;
      const conflictKey = `${a.person_id}:${targetDay.date}`;
      if ((leaveMap[conflictKey] || []).length || (travelMap[conflictKey] || []).length) {
        skippedConflicts += 1;
        continue;
      }
      const isHol = targetDay.isWeekend || holidaysSet.has(targetDay.date) ? 1 : 0;
      await appPool.query(
        `INSERT IGNORE INTO shift_assignments (roster_id, person_id, work_date, shift_code, hours, is_holiday, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [targetRoster.id, a.person_id, targetDay.date, a.shift_code, a.hours, isHol, req.session.user.fullName]
      );
      copied += 1;
    }

    await logAudit(req.session.user, 'COPY_PREV_MONTH', 'shift_rosters', targetRoster.id, {
      from: prevYm,
      copied,
      skippedConflicts,
    });
    res.json({ ok: true, copied, skippedConflicts });
  } catch (err) {
    console.error('Copy previous error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roster/status', requireAuth, async (req, res) => {
  try {
    const { yearMonth, departmentSubId, status, note } = req.body || {};
    if (!['draft', 'submitted', 'approved', 'locked'].includes(status)) {
      return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
    }
    if ((status === 'approved' || status === 'locked' || status === 'draft') && !req.session.user.isAdmin && !req.session.user.isHead) {
      if (status !== 'submitted') {
        return res.status(403).json({ error: 'เฉพาะหัวหน้าหน่วยงานหรือผู้ดูแลระบบเท่านั้น' });
      }
    }

    const roster = await ensureRoster(yearMonth, departmentSubId, req.session.user.fullName);
    const updates = ['status = ?'];
    const params = [status];

    if (note !== undefined) {
      updates.push('note = ?');
      params.push(note);
    }
    if (status === 'submitted') {
      updates.push('submitted_by = ?, submitted_at = NOW()');
      params.push(req.session.user.fullName);
    } else if (status === 'approved' || status === 'locked') {
      updates.push('approved_by = ?, approved_at = NOW()');
      params.push(req.session.user.fullName);
    }

    params.push(roster.id);
    await appPool.query(`UPDATE shift_rosters SET ${updates.join(', ')} WHERE id = ?`, params);
    await logAudit(req.session.user, 'STATUS_CHANGE', 'shift_rosters', roster.id, { status });
    res.json({ ok: true, status, statusLabel: STATUS_LABELS[status] });
  } catch (err) {
    console.error('Status update error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roster/budget', requireAdminOrHead, async (req, res) => {
  try {
    const { yearMonth, departmentSubId, budget_cap, note } = req.body || {};
    const roster = await ensureRoster(yearMonth, departmentSubId, req.session.user.fullName);
    await appPool.query('UPDATE shift_rosters SET budget_cap = ?, note = ? WHERE id = ?', [
      Number(budget_cap || 0),
      note || null,
      roster.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== COMPENSATION ====================
app.get('/api/compensation', async (req, res) => {
  try {
    const payload = await buildFullRosterPayload(req.query.yearMonth, req.query.departmentSubId || 19);
    res.json({
      monthInfo: payload.monthInfo,
      department: payload.department,
      roster: payload.roster,
      rates: payload.rates,
      payrollRows: payload.payrollRows,
      totals: payload.totals,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/compensation/adjustment', requireAuth, async (req, res) => {
  try {
    const {
      yearMonth,
      departmentSubId,
      person_id,
      pts_amount = 0,
      p4p_amount = 0,
      non_practice_amount = 0,
      other_amount = 0,
      remark = '',
    } = req.body || {};

    const monthInfo = getMonthInfo(yearMonth);
    await appPool.query(
      `INSERT INTO compensation_adjustments
         (roster_month, department_sub_id, person_id, pts_amount, p4p_amount, non_practice_amount, other_amount, remark, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         pts_amount = VALUES(pts_amount),
         p4p_amount = VALUES(p4p_amount),
         non_practice_amount = VALUES(non_practice_amount),
         other_amount = VALUES(other_amount),
         remark = VALUES(remark),
         updated_by = VALUES(updated_by)`,
      [
        monthInfo.yearMonth,
        Number(departmentSubId),
        Number(person_id),
        Number(pts_amount || 0),
        Number(p4p_amount || 0),
        Number(non_practice_amount || 0),
        Number(other_amount || 0),
        String(remark || '').slice(0, 255),
        req.session.user.fullName,
      ]
    );
    await logAudit(req.session.user, 'UPDATE_ALLOWANCE', 'compensation_adjustments', `${monthInfo.yearMonth}:${person_id}`, {
      pts_amount,
      p4p_amount,
      non_practice_amount,
      other_amount,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SWAPS ====================
app.get('/api/swaps', async (req, res) => {
  try {
    const monthInfo = getMonthInfo(req.query.yearMonth);
    const deptId = req.query.departmentSubId ? Number(req.query.departmentSubId) : null;
    const where = ['roster_month = ?'];
    const params = [monthInfo.yearMonth];
    if (deptId) {
      where.push('department_sub_id = ?');
      params.push(deptId);
    }
    const [rows] = await appPool.query(
      `SELECT * FROM shift_swaps WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 100`,
      params
    );
    res.json({ swaps: rows.map((r) => ({ ...r, year_month: r.roster_month })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/swaps', requireAuth, async (req, res) => {
  try {
    const {
      yearMonth,
      departmentSubId,
      requester_person_id,
      requester_name,
      target_person_id,
      target_name,
      work_date,
      shift_code,
      swap_type = 'cover',
      reason = '',
    } = req.body || {};
    const monthInfo = getMonthInfo(yearMonth);
    const roster = await ensureRoster(monthInfo.yearMonth, departmentSubId, req.session.user.fullName);
    const cleanDate = normalizeToCeDate(work_date);
    if (!cleanDate || !shift_code) {
      return res.status(400).json({ error: 'กรุณาระบุวันที่และเวรที่ต้องการแลก/แทน' });
    }

    const reqPid = Number(requester_person_id || req.session.user.person_id);
    const reqName = requester_name || req.session.user.fullName;

    const [result] = await appPool.query(
      `INSERT INTO shift_swaps
         (roster_id, roster_month, department_sub_id, requester_person_id, requester_name,
          target_person_id, target_name, work_date, shift_code, swap_type, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        roster.id,
        monthInfo.yearMonth,
        Number(departmentSubId),
        reqPid,
        reqName,
        target_person_id ? Number(target_person_id) : null,
        target_name || null,
        cleanDate,
        String(shift_code).toUpperCase(),
        swap_type === 'swap' ? 'swap' : 'cover',
        String(reason || '').slice(0, 255),
      ]
    );
    await logAudit(req.session.user, 'CREATE_SWAP', 'shift_swaps', result.insertId, {
      work_date: cleanDate,
      shift_code,
      target_person_id,
    });
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/swaps/:id/review', requireAdminOrHead, async (req, res) => {
  try {
    const swapId = Number(req.params.id);
    const { decision, review_note = '' } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'ผลการพิจารณาต้องเป็น approved หรือ rejected' });
    }

    const [rows] = await appPool.query('SELECT * FROM shift_swaps WHERE id = ? LIMIT 1', [swapId]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบคำขอแลกเวร' });
    const swap = rows[0];
    if (swap.status !== 'pending') {
      return res.status(400).json({ error: 'คำขอนี้ถูกพิจารณาแล้ว' });
    }

    const conn = await appPool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE shift_swaps SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?`,
        [decision, req.session.user.fullName, String(review_note).slice(0, 255), swapId]
      );

      if (decision === 'approved' && swap.target_person_id) {
        await conn.query(
          `DELETE FROM shift_assignments WHERE roster_id = ? AND person_id = ? AND work_date = ? AND shift_code = ?`,
          [swap.roster_id, swap.requester_person_id, swap.work_date, swap.shift_code]
        );
        await conn.query(
          `INSERT IGNORE INTO shift_assignments (roster_id, person_id, work_date, shift_code, hours, note, updated_by)
           VALUES (?, ?, ?, ?, 8, ?, ?)`,
          [
            swap.roster_id,
            swap.target_person_id,
            swap.work_date,
            swap.shift_code,
            `แทนเวรจาก ${swap.requester_name}`,
            req.session.user.fullName,
          ]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAudit(req.session.user, `SWAP_${decision.toUpperCase()}`, 'shift_swaps', swapId, { review_note });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== STAFF & HRD SYNC ====================
app.get('/api/staff', async (req, res) => {
  try {
    const monthInfo = getMonthInfo(req.query.yearMonth);
    const staff = await getStaffList({
      departmentSubId: req.query.departmentSubId,
      departmentId: req.query.departmentId,
      q: req.query.q,
      includeInactive: req.query.includeInactive === 'true',
    });
    const personIds = staff.map((s) => s.person_id);
    const [{ leaves }, { travels }] = await Promise.all([
      getLeavesForMonth(monthInfo, personIds),
      getTravelForMonth(monthInfo, personIds),
    ]);

    const staffNameMap = new Map(staff.map((s) => [Number(s.person_id), s]));
    const enrichedLeaves = leaves.map((l) => ({
      ...l,
      fullName: staffNameMap.get(Number(l.person_id))?.fullName || `ID ${l.person_id}`,
      department_sub_name: staffNameMap.get(Number(l.person_id))?.department_sub_name || '-',
    }));
    const enrichedTravels = travels.map((t) => ({
      ...t,
      fullName: staffNameMap.get(Number(t.person_id))?.fullName || `ID ${t.person_id}`,
      department_sub_name: staffNameMap.get(Number(t.person_id))?.department_sub_name || '-',
    }));

    res.json({
      monthInfo,
      staff,
      leaves: enrichedLeaves,
      travels: enrichedTravels,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SETTINGS & AUDIT ====================
app.put('/api/settings/rates/:rateKey', requireAdmin, async (req, res) => {
  try {
    const { rateKey } = req.params;
    const {
      group_name,
      match_keywords,
      afternoon_rate,
      night_rate,
      ot_weekday_hourly,
      ot_holiday_hourly,
      oncall_rate,
      refer_rate,
    } = req.body || {};

    await appPool.query(
      `UPDATE compensation_rates
       SET group_name = ?, match_keywords = ?, afternoon_rate = ?, night_rate = ?,
           ot_weekday_hourly = ?, ot_holiday_hourly = ?, oncall_rate = ?, refer_rate = ?
       WHERE rate_key = ?`,
      [
        group_name,
        match_keywords,
        Number(afternoon_rate || 0),
        Number(night_rate || 0),
        Number(ot_weekday_hourly || 0),
        Number(ot_holiday_hourly || 0),
        Number(oncall_rate || 0),
        Number(refer_rate || 0),
        rateKey,
      ]
    );
    await logAudit(req.session.user, 'UPDATE_RATE', 'compensation_rates', rateKey, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/holidays', requireAdmin, async (req, res) => {
  try {
    const { holiday_date, title, holiday_type = 'national' } = req.body || {};
    const cleanDate = normalizeToCeDate(holiday_date);
    if (!cleanDate || !title) {
      return res.status(400).json({ error: 'กรุณาระบุวันที่และชื่อวันหยุด' });
    }
    await appPool.query(
      `INSERT INTO public_holidays (holiday_date, title, holiday_type)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), holiday_type = VALUES(holiday_type)`,
      [cleanDate, String(title).trim(), holiday_type]
    );
    await logAudit(req.session.user, 'UPSERT_HOLIDAY', 'public_holidays', cleanDate, { title });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/settings/holidays/:date', requireAdmin, async (req, res) => {
  try {
    const cleanDate = normalizeToCeDate(req.params.date);
    await appPool.query('DELETE FROM public_holidays WHERE holiday_date = ?', [cleanDate]);
    await logAudit(req.session.user, 'DELETE_HOLIDAY', 'public_holidays', cleanDate, null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit-logs', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 50)));
    const [logs] = await appPool.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EXPORTS (PDF & EXCEL) ====================
app.get('/api/export/pdf', async (req, res) => {
  try {
    const [orgInfo, payload] = await Promise.all([
      getOrgInfo(),
      buildFullRosterPayload(req.query.yearMonth, req.query.departmentSubId || 19),
    ]);
    const pdfBuf = await generateRosterAndPayrollPdf({
      orgInfo,
      monthInfo: payload.monthInfo,
      departmentSubName: payload.department?.department_sub_name || '-',
      departmentName: payload.department?.department_name || '-',
      roster: payload.roster,
      people: payload.people,
      days: payload.days,
      assignments: payload.assignments,
      payrollRows: payload.payrollRows,
      totals: payload.totals,
      headName: payload.roster?.submitted_by || 'หัวหน้าหน่วยงาน',
    });
    const filename = `shift-payroll-${payload.monthInfo.yearMonth}-dept${payload.department?.department_sub_id || '0'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuf);
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/excel', async (req, res) => {
  try {
    const payload = await buildFullRosterPayload(req.query.yearMonth, req.query.departmentSubId || 19);
    const xlsxBuf = generateRosterAndPayrollExcel({
      monthInfo: payload.monthInfo,
      departmentSubName: payload.department?.department_sub_name || '-',
      departmentName: payload.department?.department_name || '-',
      people: payload.people,
      days: payload.days,
      assignments: payload.assignments,
      payrollRows: payload.payrollRows,
      totals: payload.totals,
    });
    const filename = `shift-payroll-${payload.monthInfo.yearMonth}-dept${payload.department?.department_sub_id || '0'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xlsxBuf);
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// SPA Fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KSP Smart Shift & Compensation System listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
