const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { formatThaiDate } = require('./dateUtils');

function resolveFontPaths() {
  const candidates = [
    path.join(__dirname, '..', 'fonts'),
    '/opt/ksp-hrd-system/fonts',
    '/opt/ksp-travel-system/fonts',
    'C:\\Windows\\Fonts',
  ];
  for (const dir of candidates) {
    const regular = ['THSarabun.ttf', 'THSarabunNew.ttf', 'Sarabun-Regular.ttf']
      .map((f) => path.join(dir, f))
      .find((p) => fs.existsSync(p));
    const bold = ['THSarabun-Bold.ttf', 'THSarabunNew Bold.ttf', 'Sarabun-Bold.ttf']
      .map((f) => path.join(dir, f))
      .find((p) => fs.existsSync(p));
    if (regular) {
      return { regular, bold: bold || regular };
    }
  }
  return null;
}

function formatMoney(val) {
  return Number(val || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generateRosterAndPayrollPdf({
  orgInfo,
  monthInfo,
  departmentSubName,
  departmentName,
  roster,
  people,
  days,
  assignments,
  payrollRows,
  totals,
  headName,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 28, bottom: 28, left: 26, right: 26 },
      bufferPages: true,
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fonts = resolveFontPaths();
    if (fonts) {
      doc.registerFont('Thai', fonts.regular);
      doc.registerFont('ThaiBold', fonts.bold);
    }
    const fReg = fonts ? 'Thai' : 'Helvetica';
    const fBold = fonts ? 'ThaiBold' : 'Helvetica-Bold';

    const hospitalName = orgInfo?.org_name || orgInfo?.ORG_NAME || 'โรงพยาบาลโคกศรีสุพรรณ';
    const directorName = orgInfo?.org_leader_name || orgInfo?.ORG_LEADER_NAME || 'ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ';
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Assign map
    const cellMap = new Map();
    for (const a of assignments) {
      const d = String(a.work_date).slice(0, 10);
      const k = `${a.person_id}:${d}`;
      if (!cellMap.has(k)) cellMap.set(k, []);
      cellMap.get(k).push(a.shift_code);
    }

    // ==================== PAGE 1+: ROSTER MATRIX ====================
    const drawRosterHeader = () => {
      doc.font(fBold).fontSize(15).fillColor('#0f172a')
        .text(`ตารางปฏิบัติงานเวรนอกเวลาราชการและวันหยุดราชการ (${hospitalName})`, doc.page.margins.left, 24, {
          width: pageW,
          align: 'center',
        });
      doc.font(fReg).fontSize(12).fillColor('#334155')
        .text(
          `หน่วยงาน: ${departmentSubName || '-'} (${departmentName || '-'})   |   ประจำเดือน ${monthInfo.thaiMonthLabel}   |   สถานะ: ${roster?.statusLabel || 'ฉบับร่าง'}`,
          doc.page.margins.left,
          44,
          { width: pageW, align: 'center' }
        );
    };

    drawRosterHeader();

    const startX = doc.page.margins.left;
    let y = 66;
    const noW = 22;
    const nameW = 128;
    const posW = 74;
    const sumW = 46;
    const dayW = (pageW - noW - nameW - posW - sumW) / days.length;
    const rowH = 18;

    const drawRosterTableHeader = () => {
      doc.rect(startX, y, pageW, 22).fill('#0f766e');
      doc.font(fBold).fontSize(9.5).fillColor('#ffffff');
      doc.text('ที่', startX + 2, y + 6, { width: noW - 4, align: 'center' });
      doc.text('ชื่อ - สกุล', startX + noW + 4, y + 6, { width: nameW - 6 });
      doc.text('ตำแหน่ง', startX + noW + nameW + 3, y + 6, { width: posW - 4 });
      days.forEach((d, idx) => {
        const dx = startX + noW + nameW + posW + idx * dayW;
        if (d.isWeekend) {
          doc.save();
          doc.rect(dx, y, dayW, 22).fill('#0d9488');
          doc.restore();
        }
        doc.font(fBold).fontSize(8.5).fillColor('#ffffff')
          .text(String(d.day), dx, y + 3, { width: dayW, align: 'center' });
        doc.font(fReg).fontSize(7).fillColor('#e2e8f0')
          .text(d.thaiDow, dx, y + 12, { width: dayW, align: 'center' });
      });
      doc.font(fBold).fontSize(8.5).fillColor('#ffffff')
        .text('บ/ด/OT', startX + pageW - sumW, y + 6, { width: sumW, align: 'center' });
      y += 22;
    };

    drawRosterTableHeader();

    const payByPerson = new Map(payrollRows.map((r) => [r.person_id, r]));

    people.forEach((p, idx) => {
      if (y + rowH > doc.page.height - 92) {
        doc.addPage();
        drawRosterHeader();
        y = 66;
        drawRosterTableHeader();
      }
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(startX, y, pageW, rowH).fill(bg).strokeColor('#cbd5e1').lineWidth(0.4).stroke();

      doc.font(fReg).fontSize(8.5).fillColor('#0f172a');
      doc.text(String(idx + 1), startX + 2, y + 4, { width: noW - 4, align: 'center' });
      doc.text(p.fullName, startX + noW + 3, y + 4, { width: nameW - 5, ellipsis: true, lineBreak: false });
      doc.text(p.position_name || '-', startX + noW + nameW + 3, y + 4, { width: posW - 5, ellipsis: true, lineBreak: false });

      days.forEach((d, dIdx) => {
        const dx = startX + noW + nameW + posW + dIdx * dayW;
        if (d.isWeekend) {
          doc.save();
          doc.rect(dx, y, dayW, rowH).fill('#f1f5f9');
          doc.restore();
        }
        doc.rect(dx, y, dayW, rowH).strokeColor('#e2e8f0').lineWidth(0.3).stroke();
        const codes = cellMap.get(`${p.person_id}:${d.date}`) || [];
        if (codes.length) {
          const text = codes.map((c) => (c === 'OFF' ? '-' : c)).join('/');
          doc.font(fBold).fontSize(7.5).fillColor('#0f172a')
            .text(text, dx, y + 5, { width: dayW, align: 'center', lineBreak: false });
        }
      });

      const pr = payByPerson.get(p.person_id);
      const sumTxt = pr ? `${pr.counts.A}/${pr.counts.N}/${pr.counts.OT_WD + pr.counts.OT_HD}` : '0/0/0';
      doc.font(fReg).fontSize(8).fillColor('#0f172a')
        .text(sumTxt, startX + pageW - sumW, y + 5, { width: sumW, align: 'center', lineBreak: false });
      y += rowH;
    });

    // Legend & signature on roster
    y += 10;
    if (y > doc.page.height - 76) {
      doc.addPage();
      y = 40;
    }
    doc.font(fReg).fontSize(9.5).fillColor('#475569')
      .text('สัญลักษณ์: M = เช้า, A = บ่าย, N = ดึก, OT = นอกเวลา, OC = On-Call, REF = Refer, - = หยุด', startX, y);

    const sigY = y + 18;
    doc.font(fReg).fontSize(10.5).fillColor('#0f172a');
    doc.text(`ลงชื่อ .................................................... ผู้จัดทำเวร`, startX + 30, sigY);
    doc.text(`( ${headName || 'หัวหน้าหน่วยงาน'} )`, startX + 45, sigY + 16);
    doc.text(`ลงชื่อ .................................................... ผู้อนุมัติ`, startX + pageW - 260, sigY);
    doc.text(`( ${directorName} )`, startX + pageW - 245, sigY + 16);

    // ==================== COMPENSATION SUMMARY PAGE ====================
    doc.addPage();
    doc.font(fBold).fontSize(15).fillColor('#0f172a')
      .text(`หลักฐานสรุปการเบิกจ่ายค่าตอบแทนปฏิบัติงานนอกเวลาราชการ (${hospitalName})`, startX, 24, {
        width: pageW,
        align: 'center',
      });
    doc.font(fReg).fontSize(12).fillColor('#334155')
      .text(
        `หน่วยงาน: ${departmentSubName || '-'}   |   ประจำเดือน ${monthInfo.thaiMonthLabel}   |   พิมพ์วันที่ ${formatThaiDate(new Date())}`,
        startX,
        44,
        { width: pageW, align: 'center' }
      );

    y = 68;
    const cols = [
      { label: 'ที่', w: 26, align: 'center' },
      { label: 'ชื่อ - สกุล', w: 145, align: 'left' },
      { label: 'ตำแหน่ง / กลุ่มอัตรา', w: 120, align: 'left' },
      { label: 'บ่าย (บ.)', w: 58, align: 'right' },
      { label: 'ดึก (บ.)', w: 58, align: 'right' },
      { label: 'OT ธรรมดา', w: 66, align: 'right' },
      { label: 'OT วันหยุด', w: 66, align: 'right' },
      { label: 'OC/Refer', w: 62, align: 'right' },
      { label: 'พ.ต.ส./P4P/เพิ่ม', w: 78, align: 'right' },
      { label: 'รวมสุทธิ (บาท)', w: 91, align: 'right' },
    ];

    const drawPayHeader = () => {
      doc.rect(startX, y, pageW, 22).fill('#0f172a');
      let cx = startX;
      cols.forEach((c) => {
        doc.font(fBold).fontSize(9.5).fillColor('#ffffff')
          .text(c.label, cx + 4, y + 6, { width: c.w - 8, align: c.align });
        cx += c.w;
      });
      y += 22;
    };
    drawPayHeader();

    payrollRows.forEach((row, idx) => {
      if (y + 20 > doc.page.height - 85) {
        doc.addPage();
        y = 40;
        drawPayHeader();
      }
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(startX, y, pageW, 19).fill(bg).strokeColor('#cbd5e1').lineWidth(0.4).stroke();
      const b = row.breakdown;
      const values = [
        String(idx + 1),
        row.fullName,
        `${row.position_name || '-'}`,
        formatMoney(b.afternoonPay),
        formatMoney(b.nightPay),
        formatMoney(b.otWeekdayPay),
        formatMoney(b.otHolidayPay),
        formatMoney(b.onCallPay + b.referPay),
        formatMoney(row.allowanceTotal),
        formatMoney(row.grandTotal),
      ];
      let cx = startX;
      cols.forEach((c, i) => {
        doc.font(i === cols.length - 1 ? fBold : fReg).fontSize(9).fillColor('#0f172a')
          .text(values[i], cx + 4, y + 4, { width: c.w - 8, align: c.align, ellipsis: true, lineBreak: false });
        cx += c.w;
      });
      y += 19;
    });

    // Totals row
    doc.rect(startX, y, pageW, 22).fill('#ecfdf5').strokeColor('#0f766e').lineWidth(0.8).stroke();
    const totalVals = [
      '',
      `รวมทั้งสิ้น (${payrollRows.length} ราย)`,
      '',
      formatMoney(totals.afternoonPay),
      formatMoney(totals.nightPay),
      formatMoney(totals.otWeekdayPay),
      formatMoney(totals.otHolidayPay),
      formatMoney(totals.onCallPay + totals.referPay),
      formatMoney(totals.allowanceTotal),
      formatMoney(totals.grandTotal),
    ];
    let tx = startX;
    cols.forEach((c, i) => {
      doc.font(fBold).fontSize(9.5).fillColor('#065f46')
        .text(totalVals[i], tx + 4, y + 5, { width: c.w - 8, align: c.align, lineBreak: false });
      tx += c.w;
    });

    doc.end();
  });
}

module.exports = { generateRosterAndPayrollPdf };
