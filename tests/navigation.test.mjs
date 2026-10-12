import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigation,NAVIGATION_ITEMS,navigationActive } from '../src/utils/navigation.js';
test('administrator navigation reduces eighteen views to eight entries without losing or duplicating routes',()=>{
  const model=buildNavigation('admin',()=>true),all=[...model.primary,...model.groups.flatMap(group=>group.items)];
  assert.equal(model.primary.length,5); assert.equal(model.groups.length,3); assert.equal(all.length,18);
  assert.deepEqual(new Set(all.map(item=>item.slug)),new Set(NAVIGATION_ITEMS.map(item=>item.slug)));
  assert.deepEqual(model.groups.map(group=>group.label),['Producción','Consultas','Administración']);
});
test('auxiliary daily captures remain direct even with extra individually permitted views',()=>{
  const model=buildNavigation('auxiliar',()=>true);
  assert.deepEqual(model.primary.map(item=>item.slug),['shiftreport','operarios','patrulla_seguimiento']);
  assert.ok(model.groups.find(group=>group.id==='operation').items.some(item=>item.slug==='carga_novedad'));
});
test('navigation uses the existing permission decision and removes empty groups',()=>{
  const allowed=new Set(['intervenciones','historico']);
  const model=buildNavigation('mecanico',slug=>allowed.has(slug));
  assert.deepEqual(model.primary.map(item=>item.slug),['intervenciones']);
  assert.deepEqual(model.groups.map(group=>group.id),['reference']);
  assert.deepEqual(model.groups[0].items.map(item=>item.slug),['historico']);
  assert.deepEqual(buildNavigation('pendiente',()=>false),{ primary:[],groups:[] });
});
test('active navigation includes detail routes while keeping root and similarly named views distinct',()=>{
  const find=slug=>NAVIGATION_ITEMS.find(item=>item.slug===slug);
  assert.equal(navigationActive('/intervenciones/task',find('intervenciones')),true);
  assert.equal(navigationActive('/patrulla/trama',find('patrulla')),true);
  assert.equal(navigationActive('/patrulla-seguimiento',find('patrulla')),false);
  assert.equal(navigationActive('/jefe',find('carga_novedad')),false);
});
