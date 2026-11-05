/** Spreadsheet-style data input. It produces a candidate and never mutates author data. */
export function parseTsvBlock(text, { maxRows = 128, maxColumns = 12, allowRagged = false } = {}) {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('붙여넣을 데이터가 너무 큽니다.');
  const lines=text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n',maxRows+1);
  if(lines.length>maxRows)throw new Error(`붙여넣기는 ${maxRows}행·${maxColumns}열까지 지원합니다.`);
  const rows = lines.map(row => row.split('\t',maxColumns+1));
  const width = rows.reduce((maximum,row)=>Math.max(maximum,row.length),0);
  if (rows.length > maxRows || width > maxColumns) throw new Error(`붙여넣기는 ${maxRows}행·${maxColumns}열까지 지원합니다.`);
  if (!allowRagged && rows.some(row => row.length !== width)) throw new Error('붙여넣을 데이터의 행마다 열 수를 맞춰 주세요.');
  return rows;
}

function numberCell(text) {
  const raw = text.trim();
  if (!raw) return null;
  const grouped = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw);
  const value = Number(grouped ? raw.replaceAll(',', '') : raw);
  if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error(`차트 수치에는 유효한 숫자 또는 빈칸을 붙여넣으세요: ${raw.slice(0, 24)}`);
  return value;
}

export function pasteChartValues(chart, { text, row, col, choice = 'base', createSeriesId } = {}) {
  if (!Number.isInteger(row) || row < 0 || !Number.isInteger(col) || col < 0) throw new Error('차트의 붙여넣기 시작 셀을 선택하세요.');
  const values = parseTsvBlock(text).map(items => items.map(numberCell));
  const height = Math.max(chart.categories.length, row + values.length), width = Math.max(chart.series.length, col + values[0].length);
  if (height > 128 || width > 12) throw new Error('차트는 128개 항목·12개 계열까지 붙여넣을 수 있습니다.');
  if (choice !== 'base' && !chart.variants?.values.some(item => 'value:' + item.value === choice)) throw new Error('붙여넣을 선택 값 데이터를 다시 선택하세요.');
  const result = structuredClone(chart), ids = new Set(result.series.map(series => series.id));
  while (result.categories.length < height) result.categories.push(`항목 ${result.categories.length + 1}`);
  for (const series of result.series) while (series.values.length < height) series.values.push(null);
  for (const variant of result.variants?.values || []) for (const series of variant.series) while (series.values.length < height) series.values.push(null);
  while (result.series.length < width) {
    let next = result.series.length + 1, id = createSeriesId?.() || `series-paste-${next}`;
    while (ids.has(id)) id = `series-paste-${++next}`;
    ids.add(id);
    result.series.push({ id, name: `계열 ${result.series.length + 1}`, color: '#9b7cf4', values: Array(height).fill(null) });
    for (const variant of result.variants?.values || []) variant.series.push({ seriesId: id, values: Array(height).fill(null) });
  }
  const target = choice === 'base' ? result.series : result.variants.values.find(item => 'value:' + item.value === choice).series;
  values.forEach((items, r) => items.forEach((value, c) => {
    const series = choice === 'base' ? target[col + c] : target.find(item => item.seriesId === result.series[col + c].id);
    series.values[row + r] = value;
  }));
  return result;
}

/** A copied spreadsheet table includes category labels and series headers, without losing variants. */
export function pasteChartTable(chart,{text,choice='base',createSeriesId}={}){
  const rows=parseTsvBlock(text,{maxRows:129,maxColumns:13});
  if(rows.length<2||rows[0].length<2)throw Error('첫 행에 계열 이름, 첫 열에 항목 이름을 포함한 표를 붙여넣으세요.');
  const names=rows[0].slice(1),categories=rows.slice(1).map(row=>row[0]);
  if([...names,...categories].some(value=>value.length>256))throw Error('항목과 계열 이름은 256자 이하로 입력하세요.');
  const data=rows.slice(1).map(row=>row.slice(1).map(numberCell));
  if(choice!=='base'&&!chart.variants?.values.some(item=>'value:'+item.value===choice))throw Error('붙여넣을 선택 값 데이터를 다시 선택하세요.');
  const result=structuredClone(chart),used=new Set(),ids=new Set(chart.series.map(series=>series.id));
  const categoryIndexes=categories.map((name,index)=>{const prior=chart.categories.indexOf(name);return prior<0?index:prior;});
  const sourceIndexes=names.map((name,index)=>{let prior=chart.series.findIndex((series,i)=>series.name===name&&!used.has(i));if(prior<0&&index<chart.series.length&&!used.has(index))prior=index;if(prior>=0)used.add(prior);return prior;});
  const resize=values=>categoryIndexes.map(index=>values?.[index]??null);
  result.categories=categories;
  result.series=names.map((name,index)=>{
    const prior=chart.series[sourceIndexes[index]];
    if(prior)return {...structuredClone(prior),name,values:choice==='base'?data.map(row=>row[index]):resize(prior.values)};
    let suffix=index+1,id=createSeriesId?.()||'series-table-'+suffix;while(ids.has(id))id='series-table-'+(++suffix);ids.add(id);
    return {id,name,color:['#4f63ff','#14a58f','#a165d4','#e6ab37','#e9708d','#499ed9'][index%6],values:choice==='base'?data.map(row=>row[index]):Array(categories.length).fill(null)};
  });
  if(result.variants)result.variants.values=result.variants.values.map(variant=>({...variant,series:result.series.map((series,index)=>({seriesId:series.id,values:choice==='value:'+variant.value?data.map(row=>row[index]):resize(variant.series.find(prior=>prior.seriesId===series.id)?.values)}))}));
  return result;
}
