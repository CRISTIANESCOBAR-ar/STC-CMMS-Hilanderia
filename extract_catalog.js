const fs = require('fs');
const path = require('path');

const filePath = 'c:\\STC-CMMS-Hilanderia\\public\\Modelo_Puestos_Control.txt';
const content = fs.readFileSync(filePath, 'utf-8');
const linesArr = content.split('\r\n').length > 1 ? content.split('\r\n') : content.split('\n');
const headers = linesArr[0].split('\t');

const catalog = [];

for (let i = 1; i < linesArr.length; i++) {
    const cols = linesArr[i].split('\t');
    if (cols.length < 10) continue; // Skip empty/incomplete lines

    const item = {
        tipoMaquina: 'OPEN END',
        modelo: 'R-60',
        seccion: cols[5].trim(),
        abreviado: cols[6].trim(),
        grupo: cols[7].trim(),
        subGrupo: cols[8].trim(),
        denominacion: cols[9].trim(),
        numeroCatalogo: cols[10].trim(),
        numeroArticulo: cols[11].trim()
    };
    
    // Only add if it has a section
    if (item.seccion) {
        catalog.push(item);
    }
}

// Group data for the UI to be more efficient if needed, 
// but for Firestore we will upload as individual documents.
console.log(JSON.stringify(catalog, null, 2));
fs.writeFileSync('c:\\STC-CMMS-Hilanderia\\src\\data\\catalogo_oe.json', JSON.stringify(catalog, null, 2));
console.log('Catalog extracted to src/data/catalogo_oe.json');
