import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('public/Salida_ShiftReport.xlsx');

wb.worksheets.forEach(ws => {
  console.log('\n=== Hoja:', ws.name, '===');
  console.log('Dimensiones:', ws.dimensions?.toString?.());

  ws.eachRow((row, rn) => {
    if (rn <= 30) {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        if (cn <= 15) vals.push(`[C${cn}:${JSON.stringify(cell.value)}]`);
      });
      console.log(`Fila ${rn}:`, vals.join(' | '));
    }
  });

  // Estilos fila 1
  console.log('\n--- Estilos fila 1 ---');
  const r1 = ws.getRow(1);
  r1.eachCell((cell, cn) => {
    if (cn <= 15) {
      console.log(`R1C${cn}`, 'fill:', JSON.stringify(cell.fill), 'font:', JSON.stringify(cell.font), 'alignment:', JSON.stringify(cell.alignment));
    }
  });

  // Celdas combinadas
  try {
    const merges = ws._merges;
    if (merges && Object.keys(merges).length) {
      console.log('\n--- Merges ---');
      Object.keys(merges).forEach(k => console.log(k, '->', merges[k]));
    }
  } catch {}

  // Column widths
  console.log('\n--- Anchos columnas ---');
  ws.columns?.forEach((col, i) => {
    if (i < 15) console.log(`Col ${i+1}:`, col.width);
  });
});
