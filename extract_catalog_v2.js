const fs = require('fs');

try {
    const raw = fs.readFileSync('public/Modelo_Puestos_Control.txt', 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    const headers = lines[0].split('\t');
    
    const catalog = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        if (cols.length < 10) continue;
        
        catalog.push({
            seccion: cols[5]?.trim() || '',
            grupo: cols[7]?.trim() || '',
            subGrupo: cols[8]?.trim() || '',
            denominacion: cols[9]?.trim() || '',
            numeroCatalogo: cols[10]?.trim() || '',
            numeroArticulo: cols[11]?.trim() || ''
        });
    }
    
    fs.writeFileSync('src/data/catalogo_oe.json', JSON.stringify(catalog, null, 2));
    console.log('Total items extracted:', catalog.length);
} catch (e) {
    console.error(e);
}
