const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

const THAI_SHORT_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const THAI_SHORT_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

function pad2(num) {
  return String(num).padStart(2, '0');
}

/**
 * Normalize a date string or Date object from db_hrd (which may use Buddhist Era years > 2400)
 * into CE 'YYYY-MM-DD'. Returns null if invalid.
 */
function normalizeToCeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = value.getMonth() + 1;
    const d = value.getDate();
    const ceYear = y > 2400 ? y - 543 : y;
    return `${ceYear}-${pad2(m)}-${pad2(d)}`;
  }
  const str = String(value).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year > 2400) year -= 543;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function parseYearMonth(yearMonth) {
  const fallback = getCurrentYearMonth();
  const raw = String(yearMonth || fallback).trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return parseYearMonth(fallback);
  let year = Number(match[1]);
  if (year > 2400) year -= 543;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return parseYearMonth(fallback);
  return { year, month, yearMonth: `${year}-${pad2(month)}` };
}

function getMonthInfo(yearMonth) {
  const { year, month, yearMonth: normalizedYm } = parseYearMonth(yearMonth);
  const daysInMonth = new Date(year, month, 0).getDate();
  const beYear = year + 543;
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    const dow = dt.getDay();
    days.push({
      day: d,
      date: `${year}-${pad2(month)}-${pad2(d)}`,
      dow,
      thaiDow: THAI_SHORT_DAYS[dow],
      isWeekend: dow === 0 || dow === 6,
    });
  }
  return {
    year,
    month,
    beYear,
    yearMonth: normalizedYm,
    daysInMonth,
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(daysInMonth)}`,
    beStartDate: `${beYear}-${pad2(month)}-01`,
    beEndDate: `${beYear}-${pad2(month)}-${pad2(daysInMonth)}`,
    thaiMonthLabel: `${THAI_MONTHS[month - 1]} ${beYear}`,
    thaiShortMonthLabel: `${THAI_SHORT_MONTHS[month - 1]} ${beYear}`,
    days,
  };
}

function getPrevYearMonth(yearMonth) {
  const { year, month } = parseYearMonth(yearMonth);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${pad2(month - 1)}`;
}

function formatThaiDate(ceDate) {
  const norm = normalizeToCeDate(ceDate);
  if (!norm) return '-';
  const [y, m, d] = norm.split('-').map(Number);
  return `${d} ${THAI_SHORT_MONTHS[m - 1]} ${y + 543}`;
}

function expandDateRange(startValue, endValue, clampStart, clampEnd) {
  const s = normalizeToCeDate(startValue);
  const e = normalizeToCeDate(endValue || startValue);
  if (!s || !e) return [];
  const startMs = Date.parse(`${s}T00:00:00Z`);
  const endMs = Date.parse(`${e}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return [];

  const minMs = clampStart ? Date.parse(`${clampStart}T00:00:00Z`) : startMs;
  const maxMs = clampEnd ? Date.parse(`${clampEnd}T00:00:00Z`) : endMs;
  const from = Math.max(startMs, minMs);
  const to = Math.min(endMs, maxMs);
  const results = [];
  for (let ms = from; ms <= to && results.length <= 62; ms += 86400000) {
    results.push(new Date(ms).toISOString().slice(0, 10));
  }
  return results;
}

module.exports = {
  THAI_MONTHS,
  THAI_SHORT_MONTHS,
  THAI_SHORT_DAYS,
  normalizeToCeDate,
  getCurrentYearMonth,
  parseYearMonth,
  getMonthInfo,
  getPrevYearMonth,
  formatThaiDate,
  expandDateRange,
};
