const XLSX = require('xlsx');

function generateRosterAndPayrollExcel({
  monthInfo,
  departmentSubName,
  departmentName,
  people,
  days,
  assignments,
  payrollRows,
  totals,
}) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: 31-day shift matrix
  const cellMap = new Map();
  for (const a of assignments) {
    const d = String(a.work_date).slice(0, 10);
    const k = `${a.person_id}:${d}`;
    if (!cellMap.has(k)) cellMap.set(k, []);
    cellMap.get(k).push(a.shift_code);
  }

  const matrixHeader = [
    'ลำดับ',
    'ชื่อ - สกุล',
    'ตำแหน่ง',
    ...days.map((d) => `${d.day} (${d.thaiDow})`),
    'เช้า(M)',
    'บ่าย(A)',
    'ดึก(N)',
    'OT ธรรมดา',
    'OT วันหยุด',
    'On-Call',
    'Refer',
    'รวมค่าเวร/OT (บาท)',
    'รวมสุทธิ (บาท)',
  ];

  const payMap = new Map(payrollRows.map((r) => [r.person_id, r]));
  const matrixRows = people.map((p, idx) => {
    const pr = payMap.get(p.person_id);
    const dayCells = days.map((d) => (cellMap.get(`${p.person_id}:${d.date}`) || []).join('/'));
    return [
      idx + 1,
      p.fullName,
      p.position_name || '',
      ...dayCells,
      pr?.counts.M || 0,
      pr?.counts.A || 0,
      pr?.counts.N || 0,
      pr?.counts.OT_WD || 0,
      pr?.counts.OT_HD || 0,
      pr?.counts.OC || 0,
      pr?.counts.REF || 0,
      pr?.shiftTotal || 0,
      pr?.grandTotal || 0,
    ];
  });

  const wsMatrix = XLSX.utils.aoa_to_sheet([
    [`ตารางเวรปฏิบัติงาน ประจำเดือน ${monthInfo.thaiMonthLabel} - ${departmentSubName} (${departmentName})`],
    [],
    matrixHeader,
    ...matrixRows,
  ]);
  wsMatrix['!cols'] = [
    { wch: 6 },
    { wch: 26 },
    { wch: 22 },
    ...days.map(() => ({ wch: 6 })),
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 10 },
    { wch: 10 },
    { wch: 8 },
    { wch: 8 },
    { wch: 16 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMatrix, 'ตารางเวรรายวัน');

  // Sheet 2: Detailed compensation payroll
  const payHeader = [
    'ลำดับ',
    'ชื่อ - สกุล',
    'ตำแหน่ง',
    'ประเภทบุคลากร',
    'กลุ่มอัตราค่าตอบแทน',
    'เวรบ่าย (ครั้ง)',
    'ค่าเวรบ่าย (บาท)',
    'เวรดึก (ครั้ง)',
    'ค่าเวรดึก (บาท)',
    'OT วันธรรมดา (ครั้ง)',
    'ค่า OT วันธรรมดา (บาท)',
    'OT วันหยุด (ครั้ง)',
    'ค่า OT วันหยุด (บาท)',
    'On-Call (บาท)',
    'Refer (บาท)',
    'พ.ต.ส. (บาท)',
    'P4P (บาท)',
    'ไม่ทำเวชฯ (บาท)',
    'อื่นๆ (บาท)',
    'รวมค่าเวร/OT (บาท)',
    'รวมจ่ายสุทธิ (บาท)',
    'หมายเหตุ',
  ];

  const payDataRows = payrollRows.map((r, idx) => [
    idx + 1,
    r.fullName,
    r.position_name || '',
    r.person_type_name || '',
    r.rate_group || '',
    r.counts.A,
    r.breakdown.afternoonPay,
    r.counts.N,
    r.breakdown.nightPay,
    r.counts.OT_WD,
    r.breakdown.otWeekdayPay,
    r.counts.OT_HD,
    r.breakdown.otHolidayPay,
    r.breakdown.onCallPay,
    r.breakdown.referPay,
    r.breakdown.ptsAmount,
    r.breakdown.p4pAmount,
    r.breakdown.nonPracticeAmount,
    r.breakdown.otherAmount,
    r.shiftTotal,
    r.grandTotal,
    r.remark || '',
  ]);

  payDataRows.push([
    '',
    `รวมทั้งสิ้น (${payrollRows.length} ราย)`,
    '',
    '',
    '',
    payrollRows.reduce((s, r) => s + r.counts.A, 0),
    totals.afternoonPay,
    payrollRows.reduce((s, r) => s + r.counts.N, 0),
    totals.nightPay,
    payrollRows.reduce((s, r) => s + r.counts.OT_WD, 0),
    totals.otWeekdayPay,
    payrollRows.reduce((s, r) => s + r.counts.OT_HD, 0),
    totals.otHolidayPay,
    totals.onCallPay,
    totals.referPay,
    totals.ptsAmount,
    totals.p4pAmount,
    totals.nonPracticeAmount,
    totals.otherAmount,
    totals.shiftTotal,
    totals.grandTotal,
    '',
  ]);

  const wsPay = XLSX.utils.aoa_to_sheet([
    [`สรุปการเบิกจ่ายค่าตอบแทน ประจำเดือน ${monthInfo.thaiMonthLabel} - ${departmentSubName}`],
    [],
    payHeader,
    ...payDataRows,
  ]);
  wsPay['!cols'] = payHeader.map((_, i) => ({ wch: i === 1 ? 26 : i === 2 || i === 4 ? 22 : 14 }));
  XLSX.utils.book_append_sheet(wb, wsPay, 'สรุปค่าตอบแทน');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generateRosterAndPayrollExcel };
