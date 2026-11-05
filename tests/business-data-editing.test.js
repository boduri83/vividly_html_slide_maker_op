import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTsvBlock, pasteChartValues } from '../src/business-data-editing.js';

const chart = () => ({ kind:'bar',categories:['검색','소셜'],series:[{id:'a',name:'기존',color:'#6355ff',values:[1,2]}],showLegend:true,variants:{variableId:'year',values:[{value:'old',series:[{seriesId:'a',values:[3,4]}]},{value:'new',series:[{seriesId:'a',values:[5,6]}]}]} });

test('plain TSV preserves empty cells and accepts CRLF while rejecting ragged or oversized blocks', () => {
  assert.deepEqual(parseTsvBlock('1\t\r\n2\t3\r\n'),[['1',''],['2','3']]);
  assert.throws(()=>parseTsvBlock('1\t2\n3'));
  assert.throws(()=>parseTsvBlock('1\t2',{maxColumns:1}));
  assert.throws(()=>parseTsvBlock('a'.repeat(2_000_001)));
  assert.throws(()=>parseTsvBlock('\n'.repeat(200_000)));
});
test('chart paste grows all data shapes but changes only the selected variant, preserving base values and IDs', () => {
  const source=chart(),before=structuredClone(source),result=pasteChartValues(source,{text:'1,200\t\n-7.5\t8',row:1,col:0,choice:'value:new'});
  assert.deepEqual(source,before);assert.equal(result.series[0].id,'a');assert.deepEqual(result.categories,['검색','소셜','항목 3']);
  assert.deepEqual(result.series[0].values,[1,2,null]);assert.deepEqual(result.series[1].values,[null,null,null]);
  assert.deepEqual(result.variants.values[0].series[0].values,[3,4,null]);assert.deepEqual(result.variants.values[1].series.map(s=>s.values),[[5,1200,-7.5],[null,null,8]]);
  assert.equal(result.variants.values[1].series[1].seriesId,result.series[1].id);
});
test('invalid number, nonfinite value, missing selection and out-of-range shape reject the complete paste without mutation', () => {
  const source=chart(),before=structuredClone(source);
  for(const options of [{text:'9\tbad',row:0,col:0},{text:'Infinity',row:0,col:0},{text:'1e16',row:0,col:0},{text:'9\t10',row:0,col:11},{text:'9\n10',row:127,col:0},{text:'9',row:0,col:0,choice:'value:gone'}])assert.throws(()=>pasteChartValues(source,options));
  assert.deepEqual(source,before);
});
test('a valid variant with a different series array order is updated by series identity',()=>{
  const source=chart();source.series.push({id:'b',name:'두번째',color:'#334455',values:[10,20]});
  for(const variant of source.variants.values)variant.series.unshift({seriesId:'b',values:[30,40]});
  const result=pasteChartValues(source,{text:'90\t80',row:0,col:0,choice:'value:new'});
  assert.deepEqual(result.variants.values[1].series.map(s=>[s.seriesId,s.values]),[['b',[80,40]],['a',[90,6]]]);
  assert.deepEqual(source.variants.values[1].series[0].values,[30,40]);
});
