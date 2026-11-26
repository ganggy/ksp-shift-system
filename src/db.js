const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { normalizeToCeDate, expandDateRange } = require('./dateUtils');

const DB_HOST = process.env.DB_HOST || '192.168.2.254';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'opd';
const DB_PASSWORD = process.env.DB_PASSWORD || 'opd';
const HRD_DB = process.env.HRD_DB || 'db_hrd';
const TRAVEL_DB = process.env.TRAVEL_DB || 'ksp_travel';
const APP_DB = process.env.APP_DB || 'ksp_shift_ot';

const hrdPool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: HRD_DB,
  charset: 'utf8mb4',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const appPool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: APP_DB,
  charset: 'utf8mb4',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 12,
  queueLimit: 0,
});

function md5(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex');
}

const DEFAULT_SHIFT_TYPES = [
  ['M', 'เวรเช้า (08:30-16:30)', 'ช', '08:30-16:30', 8, '#0369a1', '#e0f2fe', 1, 1],
  ['A', 'เวรบ่าย (16:30-00:30)', 'บ', '16:30-00:30', 8, '#b45309', '#fef3c7', 1, 2],
  ['N', 'เวรดึก (00:30-08:30)', 'ด', '00:30-08:30', 8, '#6d28d9', '#ede9fe', 1, 3],
  ['OT', 'OT นอกเวลาราชการ', 'OT', 'นอกเวลา', 8, '#be123c', '#ffe4e6', 1, 4],
  ['OC', 'On-Call / เตรียมพร้อม', 'OC', '24 ชม.', 8, '#0f766e', '#ccfbf1', 1, 5],
  ['REF', 'เวร Refer / เฉพาะกิจ', 'RF', 'ตามภารกิจ', 4, '#4338ca', '#e0e7ff', 1, 6],
  ['OFF', 'วันหยุด / พักเวร', '-', '-', 0, '#64748b', '#f1f5f9', 0, 7],
];

// Configurable baseline rates inspired by MOPH (สธ. ฉ.11) — editable by Finance/Admin in UI
const DEFAULT_RATES = [
  ['doctor', 'แพทย์ (นายแพทย์ / แพทย์หญิง)', 'นายแพทย์|แพทย์หญิง|แพทย์ปฏิบัติการ', 1100, 1400, 300, 360, 1200, 1500, 1],
  ['dentist', 'ทันตแพทย์', 'ทันตแพทย์', 900, 1100, 250, 300, 900, 1000, 2],
  ['pharmacist', 'เภสัชกร', 'เภสัชกร', 600, 750, 160, 190, 500, 600, 3],
  ['nurse', 'พยาบาลวิชาชีพ', 'พยาบาลวิชาชีพ|พยาบาลเทคนิค', 360, 360, 100, 120, 300, 600, 4],
  ['allied_health', 'นักวิชาชีพ (เทคนิคการแพทย์ / รังสี / กายภาพ / แพทย์แผนไทย / นวก.)', 'เทคนิคการแพทย์|รังสี|กายภาพ|แพทย์แผนไทย|นักวิชาการสาธารณสุข|นักจิตวิทยา|นักโภชนาการ', 320, 320, 90, 110, 260, 450, 5],
  ['officer', 'เจ้าพนักงาน (เภสัช / ทันต / วิทยาศาสตร์ / เวชสถิติ / ธุรการ / การเงิน / พัสดุ)', 'เจ้าพนักงาน', 260, 260, 80, 95, 220, 350, 6],
  ['nurse_aide', 'ผู้ช่วยเหลือคนไข้ / พนักงานช่วยการพยาบาล', 'ช่วยเหลือคนไข้|ช่วยการพยาบาล|ผู้ช่วยทันต|ผู้ช่วยนักกายภาพ|ประจำห้องยา', 240, 240, 70, 85, 200, 300, 7],
  ['support_staff', 'สายสนับสนุน / พขร. / พนักงานบริการ / โภชนาการ / ช่าง / ไอที', 'ขับรถยนต์|บริการ|ยาม|โภชนาการ|ประกอบอาหาร|เปล|ซักฟอก|ธุรการ|คอมพิวเตอร์|เกษตร', 220, 220, 65, 80, 180, 300, 8],
];

const DEFAULT_HOLIDAYS = [
  ['2026-01-01', 'วันขึ้นปีใหม่', 'national'],
  ['2026-03-03', 'วันมาฆบูชา', 'religious'],
  ['2026-04-06', 'วันจักรี', 'royal'],
  ['2026-04-13', 'วันสงกรานต์', 'national'],
  ['2026-04-14', 'วันสงกรานต์', 'national'],
  ['2026-04-15', 'วันสงกรานต์', 'national'],
  ['2026-05-04', 'วันฉัตรมงคล', 'royal'],
  ['2026-05-31', 'วันวิสาขบูชา', 'religious'],
  ['2026-06-01', 'วันหยุดชดเชยวันวิสาขบูชา', 'substitute'],
  ['2026-06-03', 'วันเฉลิมพระชนมพรรษาพระราชินี', 'royal'],
  ['2026-07-28', 'วันเฉลิมพระชนมพรรษา ร.10', 'royal'],
  ['2026-07-29', 'วันอาสาฬหบูชา', 'religious'],
  ['2026-07-30', 'วันเข้าพรรษา', 'religious'],
  ['2026-08-12', 'วันแม่แห่งชาติ', 'royal'],
  ['2026-10-13', 'วันนวมินทรมหาราช', 'royal'],
  ['2026-10-23', 'วันปิยมหาราช', 'national'],
  ['2026-12-05', 'วันพ่อแห่งชาติ / วันชาติ', 'national'],
  ['2026-12-07', 'วันหยุดชดเชยวันพ่อแห่งชาติ', 'substitute'],
  ['2026-12-10', 'วันรัฐธรรมนูญ', 'national'],
  ['2026-12-31', 'วันสิ้นปี', 'national'],
  ['2027-01-01', 'วันขึ้นปีใหม่', 'national'],
];

async function initDatabase() {
  const bootstrap = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    charset: 'utf8mb4',
  });
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${APP_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await bootstrap.end();
  }

  await appPool.query(`
    CREATE TABLE IF NOT EXISTS shift_types (
      code VARCHAR(10) PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      short_label VARCHAR(12) NOT NULL,
      time_range VARCHAR(50) NOT NULL DEFAULT '',
      default_hours DECIMAL(5,2) NOT NULL DEFAULT 8.00,
      color VARCHAR(20) NOT NULL DEFAULT '#0f766e',
      bg_color VARCHAR(20) NOT NULL DEFAULT '#ccfbf1',
      is_working TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 99
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await appPool.query(`
    CREATE TABLE IF NOT EXISTS compensation_rates (
      rate_key VARCHAR(40) PRIMARY KEY,
      group_name VARCHAR(160) NOT NULL,
      match_keywords TEXT NOT NULL,
      afternoon_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      night_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      ot_weekday_hourly DECIMAL(10,2) NOT NULL DEFAULT 0,
      ot_holiday_hourly DECIMAL(10,2) NOT NULL DEFAULT 0,
      oncall_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      refer_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 99,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await appPool.query(`
    CREATE TABLE IF NOT EXISTS public_holidays (
      holiday_date DATE PRIMARY KEY,
      title VARCHAR(180) NOT NULL,
      holiday_type VARCHAR(30) NOT NULL DEFAULT 'national'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await appPool.query(`
    CREATE TABLE IF NOT EXISTS shift_rosters (
      id INT AUTO_INCREMENT PRIMARY KEY,
      roster_month VARCHAR(7) NOT NULL,
      department_sub_id INT NOT NULL,
      status ENUM('draft','submitted','approved','locked') NOT NULL DEFAULT 'draft',
      budget_cap DECIMAL(12,2) NOT NULL DEFAULT 0,
      note TEXT NULL,
      created_by VARCHAR(150) NULL,
      submitted_by VARCHAR(150) NULL,
      submitted_at DATETIME NULL,
      approved_by VARCHAR(150) NULL,
      approved_at DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_roster_month_dept (roster_month, department_sub_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await appPool.query(`
    CREATE TABLE IF NOT EXISTS shift_assignments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      roster_id INT NOT NULL,
      person_id INT NOT NULL,
      work_date DATE NOT NULL,
      shift_code VARCHAR(10) NOT NULL,
      hours DECIMAL(5,2) NOT NULL DEFAULT 8.00,
      is_holiday TINYINT(1) NOT NULL DEFAULT 0,
      custom_rate DECIMAL(10,2) NULL,
      note VARCHAR(255) NULL,
      updated_by VARCHAR(150) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_assign (roster_id, person_id, work_date, shift_code),
      INDEX idx_assign_roster_date (roster_id, work_date),
      INDEX idx_assign_person (person_id, work_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await appPool.query(`
    CREATE TABLE IF NOT EXISTS compensation_adjustments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      roster_month VARCHAR(7) NOT NULL,
      department_sub_id INT NOT NULL,
      person_id INT NOT NULL,
      pts_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      p4p_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      non_practice_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      other_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      remark VARCHAR(255) NULL,
      updated_by VARCHAR(150) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_adj (roster_month, department_sub_id, person_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await appPool.query(`
    CREATE TABLE IF NOT EXISTS shift_swaps (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      roster_id INT NOT NULL,
      roster_month VARCHAR(7) NOT NULL,
      department_sub_id INT NOT NULL,
      requester_person_id INT NOT NULL,
      requester_name VARCHAR(200) NOT NULL,
      target_person_id INT NULL,
      target_name VARCHAR(200) NULL,
      work_date DATE NOT NULL,
      shift_code VARCHAR(10) NOT NULL,
      swap_type ENUM('swap','cover') NOT NULL DEFAULT 'cover',
      reason VARCHAR(255) NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      reviewed_by VARCHAR(200) NULL,
      review_note VARCHAR(255) NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_swap_month_dept (roster_month, department_sub_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await appPool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      actor_person_id INT NULL,
      actor_name VARCHAR(200) NULL,
      action VARCHAR(80) NOT NULL,
      entity_type VARCHAR(60) NOT NULL,
      entity_id VARCHAR(60) NULL,
      detail_json TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const row of DEFAULT_SHIFT_TYPES) {
    await appPool.query(
      `INSERT IGNORE INTO shift_types (code, label, short_label, time_range, default_hours, color, bg_color, is_working, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row
    );
  }
  for (const row of DEFAULT_RATES) {
    await appPool.query(
      `INSERT IGNORE INTO compensation_rates (rate_key, group_name, match_keywords, afternoon_rate, night_rate, ot_weekday_hourly, ot_holiday_hourly, oncall_rate, refer_rate, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row
    );
  }
  for (const row of DEFAULT_HOLIDAYS) {
    await appPool.query(
      `INSERT IGNORE INTO public_holidays (holiday_date, title, holiday_type) VALUES (?, ?, ?)`,
      row
    );
  }
}

async function getOrgInfo() {
  const [orgs] = await hrdPool.query(
    'SELECT org_code, org_name, org_position_leader, org_nurse, hospcode FROM hrd_gen_organization LIMIT 1'
  );
  const [leaders] = await hrdPool.query(
    `SELECT hrd_leader_name, org_leader_position_name FROM hrd_org_leader WHERE org_leader_status = 'Y' LIMIT 1`
  );
  const org = orgs[0] || {};
  const leader = leaders[0] || {};
  return {
    org_code: org.org_code || 'ORG',
    org_name: org.org_name || 'โรงพยาบาลโคกศรีสุพรรณ',
    hospcode: org.hospcode || '11101',
    org_leader_name: leader.hrd_leader_name || 'ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ',
    org_position_leader: leader.org_leader_position_name || org.org_position_leader || 'ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ',
    org_nurse: org.org_nurse || '',
  };
}

async function getDepartments() {
  const [depts] = await hrdPool.query(
    `SELECT department_id, department_name, head_department, department_status
     FROM hrd_department
     WHERE department_status = 'Y' OR department_status IS NULL
     ORDER BY department_id`
  );
  const [subDepts] = await hrdPool.query(
    `SELECT ds.department_sub_id, ds.department_id, ds.department_sub_name, ds.department_head, ds.department_sub_status,
            d.department_name,
            COUNT(CASE WHEN p.person_status_id IN (1,2,3,4,5) THEN 1 END) AS active_staff_count
     FROM hrd_department_sub ds
     LEFT JOIN hrd_department d ON d.department_id = ds.department_id
     LEFT JOIN hrd_person p ON p.department_sub_id = ds.department_sub_id
     WHERE ds.department_sub_status = 'Y' OR ds.department_sub_status IS NULL
     GROUP BY ds.department_sub_id, ds.department_id, ds.department_sub_name, ds.department_head, ds.department_sub_status, d.department_name
     ORDER BY active_staff_count DESC, ds.department_id, ds.department_sub_id`
  );
  return { departments: depts, subDepartments: subDepts };
}

async function getStaffList({ departmentSubId, departmentId, q, includeInactive = false } = {}) {
  const where = [];
  const params = [];

  if (!includeInactive) {
    where.push('p.person_status_id IN (1,2,3,4,5)');
  }
  if (departmentSubId) {
    where.push('p.department_sub_id = ?');
    params.push(Number(departmentSubId));
  } else if (departmentId) {
    where.push('p.department_id = ?');
    params.push(Number(departmentId));
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    where.push('(p.fname LIKE ? OR p.lname LIKE ? OR pos.position_name LIKE ? OR ds.department_sub_name LIKE ?)');
    params.push(like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await hrdPool.query(
    `SELECT p.person_id, p.fname, p.lname, p.nickname, p.department_id, p.department_sub_id,
            p.position_id, p.position_groups_id, p.person_type_id, p.person_status_id,
            p.user_groups_id, p.startwork_date,
            pn.prename_name, pos.position_name, pg.position_groups_name,
            pt.person_type_name, ps.person_status_name,
            d.department_name, ds.department_sub_name, lt.level_type_name
     FROM hrd_person p
     LEFT JOIN hrd_prename pn ON pn.prename_id = p.prename_id
     LEFT JOIN hrd_position pos ON pos.position_id = p.position_id
     LEFT JOIN hrd_position_groups pg ON pg.position_groups_id = pos.position_groups_id
     LEFT JOIN hrd_person_type pt ON pt.person_type_id = p.person_type_id
     LEFT JOIN hrd_person_status ps ON ps.person_status_id = p.person_status_id
     LEFT JOIN hrd_department d ON d.department_id = p.department_id
     LEFT JOIN hrd_department_sub ds ON ds.department_sub_id = p.department_sub_id
     LEFT JOIN hrd_level_type lt ON lt.level_type_id = p.level_type_id
     ${whereSql}
     ORDER BY ds.department_sub_id, pos.position_id, p.fname, p.lname`,
    params
  );

  return rows.map((r) => ({
    person_id: r.person_id,
    fullName: `${r.prename_name || ''}${String(r.fname || '').trim()} ${String(r.lname || '').trim()}`.trim(),
    nickname: r.nickname || '',
    department_id: r.department_id,
    department_name: r.department_name || '-',
    department_sub_id: r.department_sub_id,
    department_sub_name: r.department_sub_name || '-',
    position_id: r.position_id,
    position_name: r.position_name || '-',
    position_groups_name: r.position_groups_name || '',
    person_type_id: r.person_type_id,
    person_type_name: r.person_type_name || '-',
    person_status_id: r.person_status_id,
    person_status_name: r.person_status_name || '-',
    level_type_name: r.level_type_name || '',
  }));
}

async function getLeavesForMonth(monthInfo, personIds = null) {
  const params = [
    monthInfo.endDate,
    monthInfo.startDate,
    monthInfo.beEndDate,
    monthInfo.beStartDate,
  ];
  let personFilter = '';
  if (Array.isArray(personIds) && personIds.length > 0) {
    personFilter = `AND l.person_id IN (${personIds.map(() => '?').join(',')})`;
    params.push(...personIds);
  }

  const [rows] = await hrdPool.query(
    `SELECT l.hrd_leave_id, l.person_id, l.hrd_leave_type_id, l.leave_startdate, l.leave_enddate,
            l.leave_day, l.leave_day_type, l.allow_id, l.leave_because,
            lt.hrd_leave_type_name, lt.graph_color, dt.leave_day_type_name
     FROM hrd_leave_data l
     LEFT JOIN hrd_leave_type lt ON lt.hrd_leave_type_id = l.hrd_leave_type_id
     LEFT JOIN hrd_leave_day_type dt ON dt.leave_day_type_id = l.leave_day_type
     WHERE (l.hrd_leave_type_id IS NULL OR l.hrd_leave_type_id != 12)
       AND (l.leave_because_cancel IS NULL OR l.leave_because_cancel = '')
       AND (
         (l.leave_startdate <= ? AND l.leave_enddate >= ?)
         OR
         (l.leave_startdate <= ? AND l.leave_enddate >= ?)
       )
       ${personFilter}
     ORDER BY l.leave_startdate DESC`,
    params
  );

  const leaveMap = {};
  const leaves = [];
  for (const r of rows) {
    const startCe = normalizeToCeDate(r.leave_startdate);
    const endCe = normalizeToCeDate(r.leave_enddate);
    if (!startCe || !endCe) continue;
    const dates = expandDateRange(startCe, endCe, monthInfo.startDate, monthInfo.endDate);
    if (!dates.length) continue;

    const item = {
      hrd_leave_id: r.hrd_leave_id,
      person_id: r.person_id,
      leave_type_id: r.hrd_leave_type_id,
      leave_type_name: r.hrd_leave_type_name || 'ลา',
      day_type_name: r.leave_day_type_name || 'เต็มวัน',
      leave_day: Number(r.leave_day || 1),
      color: r.graph_color || '#f59e0b',
      start_date: startCe,
      end_date: endCe,
      dates,
    };
    leaves.push(item);

    for (const d of dates) {
      const k = `${r.person_id}:${d}`;
      if (!leaveMap[k]) leaveMap[k] = [];
      leaveMap[k].push(item);
    }
  }
  return { leaves, leaveMap };
}

async function getTravelForMonth(monthInfo, personIds = null) {
  const travelMap = {};
  const travels = [];

  // 1. Check ksp_travel (requester + companions)
  try {
    const [reqRows] = await hrdPool.query(
      `SELECT r.row_id, r.doc_no, r.subject, r.destination, r.province, r.start_date, r.end_date, r.status,
              r.requester_person_id, c.person_id AS companion_person_id
       FROM \`${TRAVEL_DB}\`.travel_requests r
       LEFT JOIN \`${TRAVEL_DB}\`.travel_companions c ON c.travel_id = r.row_id
       WHERE (r.status IS NULL OR r.status NOT IN (9, 99, -1))
         AND (
           (r.start_date <= ? AND r.end_date >= ?)
           OR
           (r.start_date <= ? AND r.end_date >= ?)
         )`,
      [monthInfo.endDate, monthInfo.startDate, monthInfo.beEndDate, monthInfo.beStartDate]
    );

    const pidSet = Array.isArray(personIds) && personIds.length ? new Set(personIds.map(Number)) : null;
    for (const r of reqRows) {
      const startCe = normalizeToCeDate(r.start_date);
      const endCe = normalizeToCeDate(r.end_date);
      const dates = expandDateRange(startCe, endCe, monthInfo.startDate, monthInfo.endDate);
      if (!dates.length) continue;

      const involvedIds = [r.requester_person_id, r.companion_person_id].filter(Boolean).map(Number);
      for (const pid of involvedIds) {
        if (pidSet && !pidSet.has(pid)) continue;
        const item = {
          source: 'ksp_travel',
          travel_id: r.row_id,
          person_id: pid,
          doc_no: r.doc_no || '',
          subject: r.subject || 'ไปราชการ',
          destination: r.destination || r.province || '',
          start_date: startCe,
          end_date: endCe,
          dates,
        };
        travels.push(item);
        for (const d of dates) {
          const k = `${pid}:${d}`;
          if (!travelMap[k]) travelMap[k] = [];
          if (!travelMap[k].some((x) => x.travel_id === item.travel_id && x.source === 'ksp_travel')) {
            travelMap[k].push(item);
          }
        }
      }
    }
  } catch (err) {
    // Graceful fallback if ksp_travel is absent on another site
    console.warn('ksp_travel read skipped:', err.message);
  }

  // 2. Also check db_hrd.hrd_train_data
  try {
    const params = [monthInfo.endDate, monthInfo.startDate, monthInfo.beEndDate, monthInfo.beStartDate];
    let filter = '';
    if (Array.isArray(personIds) && personIds.length) {
      filter = `AND person_id IN (${personIds.map(() => '?').join(',')})`;
      params.push(...personIds);
    }
    const [trainRows] = await hrdPool.query(
      `SELECT train_data_id, person_id, train_topic, train_place, train_startdate, train_enddate
       FROM hrd_train_data
       WHERE person_id IS NOT NULL
         AND (
           (train_startdate <= ? AND train_enddate >= ?)
           OR
           (train_startdate <= ? AND train_enddate >= ?)
         ) ${filter}`,
      params
    );
    for (const r of trainRows) {
      const startCe = normalizeToCeDate(r.train_startdate);
      const endCe = normalizeToCeDate(r.train_enddate);
      const dates = expandDateRange(startCe, endCe, monthInfo.startDate, monthInfo.endDate);
      if (!dates.length) continue;
      const item = {
        source: 'hrd_train_data',
        travel_id: r.train_data_id,
        person_id: Number(r.person_id),
        doc_no: '',
        subject: r.train_topic || 'อบรม/ไปราชการ',
        destination: r.train_place || '',
        start_date: startCe,
        end_date: endCe,
        dates,
      };
      travels.push(item);
      for (const d of dates) {
        const k = `${item.person_id}:${d}`;
        if (!travelMap[k]) travelMap[k] = [];
        travelMap[k].push(item);
      }
    }
  } catch (err) {
    console.warn('hrd_train_data read skipped:', err.message);
  }

  return { travels, travelMap };
}

async function logAudit(actor, action, entityType, entityId, detail) {
  try {
    await appPool.query(
      `INSERT INTO audit_logs (actor_person_id, actor_name, action, entity_type, entity_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actor?.person_id || null,
        actor?.fullName || 'System',
        action,
        entityType,
        String(entityId || ''),
        detail ? JSON.stringify(detail) : null,
      ]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = {
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
};
