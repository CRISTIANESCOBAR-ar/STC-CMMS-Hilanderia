export function patrolValue(value) {
  if(value==='' || value==null) return null;
  const text=String(value).trim().replace(',','.');
  if(!/^\d+(?:\.\d)?$/.test(text) || !Number.isFinite(Number(text))) throw new Error('Usá valores no negativos con hasta un decimal, por ejemplo 1,3 o 10,5.');
  return Number(text);
}
export function comparePatrol(first,last) {
  if(first==null || last==null || first==='' || last==='') return 'missing';
  const a=Number(first),b=Number(last); if(!Number.isFinite(a) || !Number.isFinite(b)) return 'missing';
  const difference=b-a,absolute=Math.abs(difference);
  if(absolute<=0.5) return 'igual';
  if(a===0) return difference>0 ? 'peor':'mejor';
  if(absolute/Math.abs(a)*100<=20) return difference>0 ? 'leve':'mejor';
  return difference<0 ? 'mejor':'peor';
}
export function patrolSummary(rounds) {
  const first=rounds.ronda_1?.datos || {},last=rounds.ronda_6?.datos || {},summary={ mejoras:0,empeoramientos:0,leves:0,iguales:0 };
  for(const id of new Set([...Object.keys(first),...Object.keys(last)])) for(const field of ['roU','roT']) {
    const result=comparePatrol(first[id]?.[field],last[id]?.[field]);
    const key={ mejor:'mejoras',peor:'empeoramientos',leve:'leves',igual:'iguales' }[result]; if(key) summary[key]++;
  }
  return summary;
}
export function stablePatrol(value) { if(Array.isArray(value)) return value.map(stablePatrol); if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stablePatrol(value[key])])); return value; }
