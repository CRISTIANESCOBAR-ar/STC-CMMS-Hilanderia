const fs = require('fs');
const path = require('path');

const filePath = 'c:\\STC-CMMS-Hilanderia\\public\\Modelo_Puestos_Control.txt';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');
const headers = lines[0].split('\t');

const data = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].split('\t');
  if (line.length < headers.length) continue;
  
  const obj = {};
  headers.forEach((h, index) => {
    obj[h.trim()] = line[index] ? line[index].trim() : '';
  });
  data.push(obj);
}

// Group by Section, then Grupo
const config = {
  'OPEN END': {
    secciones: []
  }
};

const sections = [...new Set(data.map(d => d.Sección))].filter(s => s);

sections.forEach(sName => {
  const sData = data.filter(d => d.Sección === sName);
  const groups = [...new Set(sData.map(d => d.Grupo))].filter(g => g && g !== '-');
  
  const seccionObj = {
    nombre: sName,
    grupos: groups.map(gId => {
      const gData = sData.find(d => d.Grupo === gId);
      return {
        id: gId,
        nombre: gData.Denominación || gId
      };
    })
  };
  config['OPEN END'].secciones.push(seccionObj);
});

console.log(JSON.stringify(config, null, 2));
