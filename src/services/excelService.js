const ExcelJS = require('exceljs');

/**
 * Parse uploaded Excel file and extract rows with NIK and Nama
 * @param {Buffer} buffer 
 * @returns {Promise<Array<{rowNumber: number, nik: string, nama: string}>>}
 */
async function parseUploadedExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('File Excel tidak memiliki lembar kerja (worksheet).');
  }

  let headerRowIndex = 1;
  let nikColIndex = -1;
  let namaColIndex = -1;

  // Search first 5 rows for header names
  for (let r = 1; r <= Math.min(5, worksheet.rowCount); r++) {
    const row = worksheet.getRow(r);
    row.eachCell((cell, colNumber) => {
      const val = String(cell.value || '').toLowerCase().trim();
      if (val.includes('nik') || val.includes('ktp') || val.includes('nomor induk')) {
        nikColIndex = colNumber;
        headerRowIndex = r;
      }
      if (val.includes('nama') || val.includes('name')) {
        namaColIndex = colNumber;
      }
    });
    if (nikColIndex !== -1) break;
  }

  // Fallback: If no headers found, assume col 1 is NIK, col 2 is Nama or vice-versa
  if (nikColIndex === -1) {
    nikColIndex = 1;
    namaColIndex = 2;
    headerRowIndex = 1;
  }

  const items = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return; // skip header

    let nikVal = '';
    const nikCell = row.getCell(nikColIndex);
    if (nikCell) {
      if (typeof nikCell.value === 'object' && nikCell.value !== null) {
        nikVal = String(nikCell.value.text || nikCell.value.result || '');
      } else {
        nikVal = String(nikCell.value || '');
      }
    }

    // Clean NIK: remove scientific notation / spaces / dashes
    nikVal = nikVal.trim().replace(/[^0-9]/g, '');

    let namaVal = '';
    if (namaColIndex !== -1) {
      const namaCell = row.getCell(namaColIndex);
      if (namaCell) {
        if (typeof namaCell.value === 'object' && namaCell.value !== null) {
          namaVal = String(namaCell.value.text || namaCell.value.result || '');
        } else {
          namaVal = String(namaCell.value || '');
        }
      }
    }

    if (nikVal) {
      items.push({
        id: items.length + 1,
        rowNumber,
        nik: nikVal,
        nama: namaVal.trim(),
        status: 'Antrean',
        desil: '-',
        namaMasked: '-',
        dtsenPeriod: '-',
        sembakoStatus: '-',
        sembakoPeriode: '-',
        pkhStatus: '-',
        pkhPeriode: '-',
        pbiStatus: '-',
        pbiPeriode: '-',
        pbiKeterangan: '-',
        kpdStatus: '-',
        rawText: '-'
      });
    }
  });

  return items;
}

/**
 * Generate a clean template Excel for users to download
 * @returns {Promise<Buffer>}
 */
async function generateTemplateExcel() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BuatDigital.id - Cek Desil Massal DTSEN';
  const sheet = workbook.addWorksheet('Data Cek Bansos');

  sheet.columns = [
    { header: 'NO', key: 'no', width: 8 },
    { header: 'NIK', key: 'nik', width: 22 },
    { header: 'NAMA', key: 'nama', width: 30 }
  ];

  // Header style
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E40AF' } // Deep Blue
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Sample data
  sheet.addRow({ no: 1, nik: '3201010000000001', nama: 'Budi Santoso' });
  sheet.addRow({ no: 2, nik: '3201010000000002', nama: 'Siti Aminah' });

  // Format NIK column as text
  sheet.getColumn('nik').numFmt = '@';

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generate output Excel containing full Desil and Bansos check results
 * @param {Array} results 
 * @returns {Promise<Buffer>}
 */
async function generateResultExcel(results) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BuatDigital.id - Cek Desil Massal Kemensos DTSEN';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Hasil Cek Desil Bansos');

  sheet.columns = [
    { header: 'NO', key: 'no', width: 6 },
    { header: 'NIK', key: 'nik', width: 20 },
    { header: 'NAMA INPUT', key: 'namaInput', width: 25 },
    { header: 'NAMA DI DTSEN', key: 'namaDtsen', width: 25 },
    { header: 'DESIL', key: 'desil', width: 14 },
    { header: 'STATUS DTKS/DTSEN', key: 'statusDtsen', width: 20 },
    { header: 'SEMBAKO STATUS', key: 'sembakoStatus', width: 16 },
    { header: 'SEMBAKO PERIODE', key: 'sembakoPeriode', width: 22 },
    { header: 'PKH STATUS', key: 'pkhStatus', width: 15 },
    { header: 'PKH PERIODE', key: 'pkhPeriode', width: 22 },
    { header: 'PBI-JK STATUS', key: 'pbiStatus', width: 16 },
    { header: 'PBI-JK PERIODE', key: 'pbiPeriode', width: 25 },
    { header: 'KETERANGAN PBI', key: 'pbiKet', width: 20 },
    { header: 'STATUS KPD', key: 'statusKpd', width: 15 },
    { header: 'PERIODE DTSEN', key: 'dtsenPeriod', width: 22 },
    { header: 'WAKTU CEK', key: 'waktuCek', width: 20 }
  ];

  // Header style
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' } // Tailwind Blue-900
  };

  // Border style
  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
  };

  results.forEach((item, idx) => {
    const row = sheet.addRow({
      no: idx + 1,
      nik: item.nik || '',
      namaInput: item.nama || '',
      namaDtsen: item.namaMasked || '-',
      desil: item.desil || '-',
      statusDtsen: item.status || '-',
      sembakoStatus: item.sembakoStatus || '-',
      sembakoPeriode: item.sembakoPeriode || '-',
      pkhStatus: item.pkhStatus || '-',
      pkhPeriode: item.pkhPeriode || '-',
      pbiStatus: item.pbiStatus || '-',
      pbiPeriode: item.pbiPeriode || '-',
      pbiKet: item.pbiKeterangan || '-',
      statusKpd: item.kpdStatus || '-',
      dtsenPeriod: item.dtsenPeriod || '-',
      waktuCek: item.timestamp ? new Date(item.timestamp).toLocaleString('id-ID') : '-'
    });

    row.height = 22;
    row.alignment = { vertical: 'middle' };

    // Set text format for NIK column
    row.getCell('nik').numFmt = '@';
    row.getCell('no').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('desil').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('statusDtsen').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('sembakoStatus').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('pkhStatus').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('pbiStatus').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('statusKpd').alignment = { vertical: 'middle', horizontal: 'center' };

    // Highlight Desil colors
    const desilVal = String(item.desil || '').trim();
    if (['1', '2', '3', '4'].includes(desilVal)) {
      row.getCell('desil').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCFCE7' } // Light Green
      };
      row.getCell('desil').font = { bold: true, color: { argb: 'FF166534' } };
    } else if (desilVal === '5') {
      row.getCell('desil').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF9C3' } // Light Yellow
      };
      row.getCell('desil').font = { bold: true, color: { argb: 'FF854D0E' } };
    } else if (desilVal.includes('6') || desilVal.includes('10')) {
      row.getCell('desil').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' } // Light Gray
      };
      row.getCell('desil').font = { bold: true, color: { argb: 'FF374151' } };
    }

    // Apply borders
    for (let c = 1; c <= 16; c++) {
      row.getCell(c).border = thinBorder;
    }
  });

  return await workbook.xlsx.writeBuffer();
}

module.exports = {
  parseUploadedExcel,
  generateTemplateExcel,
  generateResultExcel
};
