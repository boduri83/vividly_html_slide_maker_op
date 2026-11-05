/** Semantic business content shared by editing, presentation and static output. */
import { formulaValue, planMotionTimeline } from './advanced-motion-model.js';
import { resolveConnectorGeometry,chartValueDomain,formatChartNumber } from './business-model.js';
import { normalizeSvgPath } from './svg-path.js';
import { fontStack } from './font-names.js';
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("유효한 숫자가 필요합니다.");
  return String(Object.is(value, -0) ? 0 : value);
};
const paint = (value) => {
  if (value === "none") return value;
  if (
    typeof value !== "string" ||
    !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
  )
    throw new Error("HEX 색상이 필요합니다.");
  return value;
};
const align = (value) => {
  if (!["left", "center", "right"].includes(value))
    throw new Error("지원하지 않는 정렬입니다.");
  return value;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
export const BUSINESS_CONTENT_CSS = `
.slide-element .business-table{border-collapse:collapse;table-layout:fixed;width:100%;height:100%;font-family:inherit;line-height:1.3}
.business-table th,.business-table td{border:1px solid #ccd5e4;padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:middle;overflow:hidden}
.business-chart{margin:0;width:100%;height:100%;position:relative}.business-chart [data-chart-output]{width:100%;height:100%}.business-chart [data-chart-output]>svg,.business-svg{display:block;width:100%;height:100%;overflow:visible}
.business-chart-data{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.element-connector{overflow:visible!important;pointer-events:none}.element-connector[data-interactive]{pointer-events:none}.element-connector[data-interactive] .connector-hit,.presentation-slide .element-connector .connector-hit{pointer-events:stroke}.element-connector svg{display:block;width:100%;height:100%;overflow:visible;pointer-events:none}
.element-text-content ul,.element-text-content ol{margin:0;padding-left:1.25em}.element-text-content li{padding:0;white-space:normal}.element-text-content li>p{white-space:pre-wrap}
.element-text-content a{color:inherit;text-decoration:underline;pointer-events:auto}.slide-element [data-heading]{font-weight:700}
.business-master{position:absolute;inset:0;pointer-events:none;overflow:hidden}.business-master-footer,.business-master-logo,.business-master-page{position:absolute;font-family:inherit;white-space:pre-wrap;overflow:hidden}
`;

export function safeLink(href) {
  if (
    typeof href !== "string" ||
    !href ||
    href.length > 2048 ||
    /[\u0000-\u0020]/.test(href)
  )
    throw new Error("링크 주소가 올바르지 않습니다.");
  if (href.startsWith("#")) return href;
  let url;
  try {
    url = new URL(href);
  } catch {
    throw new Error("지원하지 않는 링크 주소입니다.");
  }
  if (!["https:", "http:", "mailto:"].includes(url.protocol))
    throw new Error("웹 주소 또는 메일 주소만 지원합니다.");
  return href;
}

export function renderRichParagraph(text, index) {
  const source = text.paragraphs[index],
    runs = (text.runs || [])
      .filter((run) => run.paragraph === index)
      .sort((a, b) => a.start - b.start);
  let cursor=0,markup='';
  function segment(value,run={}){
    if(!value)return '';
    const styles=[];
    for(const [key,css,yes,no]of [['bold','font-weight','700','400'],['italic','font-style','italic','normal']])if(run[key]!==undefined)styles.push(css+':'+((run[key]??text.textStyle[key])?yes:no));
    const underline=run.underline??text.textStyle.underline,strike=run.strike??text.textStyle.strike;
    if(underline||strike||run.underline!==undefined||run.strike!==undefined)styles.push('text-decoration:'+([underline?'underline':'',strike?'line-through':''].filter(Boolean).join(' ')||'none'));
    if(run.fontSize!==undefined)styles.push('font-size:'+num(run.fontSize)+'px');if(run.fontFamily!==undefined)styles.push('font-family:'+fontStack(run.fontFamily));if(run.color!==undefined)styles.push('color:'+paint(run.color));
    let part=esc(value);if(styles.length)part='<span style="'+esc(styles.join(';'))+'">'+part+'</span>';
    if(run.href!==undefined)part='<a href="'+esc(safeLink(run.href))+'" target="_blank" rel="noopener noreferrer">'+part+'</a>';return part;
  }
  for(const run of runs){if(!Number.isInteger(run.start)||!Number.isInteger(run.end)||run.start<cursor||run.end<=run.start||run.end>source.length)throw Error('문자 범위가 올바르지 않습니다.');markup+=segment(source.slice(cursor,run.start))+segment(source.slice(run.start,run.end),run);cursor=run.end;}
  markup+=segment(source.slice(cursor));
  const style = text.paragraphStyles?.[index],
    spacing = style
      ? ` style="margin-top:${num(style.spaceBefore)}px;margin-bottom:${num(style.spaceAfter)}px"`
      : "";
  return `<p${spacing}>${markup}</p>`;
}

export function renderRichParagraphs(text) {
  if (!text.paragraphStyles)
    return text.paragraphs
      .map((_, index) => renderRichParagraph(text, index))
      .join("");
  const blocks = [];
  let items = [];
  const flush = () => {
    if (!items.length) return;
    const roots = [],
      stack = [];
    for (const item of items) {
      while (stack.length && stack.at(-1).level >= item.level) stack.pop();
      (stack.at(-1)?.children || roots).push(item);
      stack.push(item);
    }
    function nested(nodes, parentLevel = -1) {
      let out = "";
      for (let i = 0; i < nodes.length; ) {
        const kind = nodes[i].kind,
          tag = kind === "number" ? "ol" : "ul",
          group = [];
        while (i < nodes.length && nodes[i].kind === kind)
          group.push(nodes[i++]);
        const level = group[0].level;
        out +=
          `<${tag} data-list-level="${level}" style="padding-left:${Math.max(1, level - parentLevel) * 24}px">` +
          group
            .map(
              (item) =>
                `<li aria-level="${item.level + 1}">${renderRichParagraph(text, item.index)}${nested(item.children, item.level)}</li>`,
            )
            .join("") +
          `</${tag}>`;
      }
      return out;
    }
    blocks.push(nested(roots));
    items = [];
  };
  for (let index = 0; index < text.paragraphs.length; index++) {
    const style = text.paragraphStyles[index];
    if (!style || style.list === "none") {
      flush();
      blocks.push(renderRichParagraph(text, index));
    } else
      items.push({ index, kind: style.list, level: style.level, children: [] });
  }
  flush();
  return blocks.join("");
}

export function tableContent(table) {
  const widths = table.columnWidths,
    total = widths.reduce((a, b) => a + b, 0);
  const row = (cells, index) =>
    `<tr>${cells
      .map((cell) => {
        const tag = index < (table.headerRows || 0) ? "th" : "td";
        const styles = [`text-align:${align(cell.align || "left")}`];
        if (cell.fill) styles.push(`background:${paint(cell.fill)}`);
        if (cell.color) styles.push(`color:${paint(cell.color)}`);
        if (cell.bold !== undefined)
          styles.push(`font-weight:${cell.bold ? 700 : 400}`);
        return `<${tag}${tag === "th" ? ' scope="col"' : ""} style="${esc(styles.join(";"))}">${esc(cell.text)}</${tag}>`;
      })
      .join("")}</tr>`;
  return `<table class="business-table" style="font-size:${num(table.fontSize)}px"><colgroup>${widths.map((width) => `<col style="width:${num((width / total) * 100)}%">`).join("")}</colgroup>${table.headerRows ? `<thead>${table.rows.slice(0, table.headerRows).map(row).join("")}</thead>` : ""}<tbody>${table.rows
    .slice(table.headerRows || 0)
    .map((cells, index) => row(cells, index + (table.headerRows || 0)))
    .join("")}</tbody></table>`;
}

export function resolveChart(chart, variableValues = {}) {
  const variant = chart.variants?.values.find(
    (row) => row.value === variableValues[chart.variants.variableId],
  );
  if (!variant) return chart;
  return {
    ...chart,
    series: chart.series.map((series) => ({
      ...series,
      values:
        variant.series.find((row) => row.seriesId === series.id)?.values ||
        series.values,
    })),
  };
}

const chartDataTable=(chart,title)=>`<table class="business-chart-data"><caption>${esc(title)}</caption><thead><tr><th>항목</th>${chart.series.map(s=>`<th scope="col">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${chart.categories.map((category,i)=>`<tr><th scope="row">${esc(category)}</th>${chart.series.map(s=>`<td>${s.values[i]===null?'':esc(s.values[i])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
function radialChartGraphic(chart,width,height,title){
  const colors=['#4f63ff','#14a58f','#a165d4','#e6ab37','#e9708d','#499ed9','#b08059','#7aa751'],n=v=>Number(v.toFixed(4));
  const isRadar=chart.kind==='radar',legendLabels=isRadar?chart.series.map(s=>s.name):chart.categories;
  const columns=Math.max(1,Math.floor(width/150)),legendHeight=chart.showLegend?Math.min(height*.3,Math.ceil(legendLabels.length/columns)*22+12):0;
  const radius=Math.max(1,Math.min(width-100,height-legendHeight-50)/2),cx=width/2,cy=(height-legendHeight)/2;
  const point=(r,a)=>[n(cx+Math.cos(a)*r),n(cy+Math.sin(a)*r)],pair=p=>p.join(' ');
  let svg=`<title>${esc(title)}</title><desc>${esc(chart.categories.join(', '))}</desc>`;
  const maximum=Math.max(1,...chart.series.flatMap(s=>s.values.filter(v=>v!==null)));
  if(isRadar){
    for(let ring=1;ring<=4;ring++)svg+=`<polygon points="${chart.categories.map((_,i)=>point(radius*ring/4,-Math.PI/2+i*Math.PI*2/chart.categories.length).join(',')).join(' ')}" fill="none" stroke="#dce3ef"/>`;
    chart.categories.forEach((label,i)=>{const a=-Math.PI/2+i*Math.PI*2/chart.categories.length,p=point(radius,a),t=point(radius+18,a);svg+=`<path d="M ${cx} ${cy} L ${pair(p)}" stroke="#dce3ef"/><text x="${t[0]}" y="${t[1]+4}" text-anchor="middle" fill="#53627a" font-size="12">${esc(label)}</text>`;});
    chart.series.forEach(series=>{const pts=series.values.map((v,i)=>v===null?null:point(radius*v/maximum,-Math.PI/2+i*Math.PI*2/chart.categories.length));svg+=`<polygon points="${pts.filter(Boolean).map(p=>p.join(',')).join(' ')}" fill="${paint(series.color)}" fill-opacity=".2" stroke="${paint(series.color)}" stroke-width="3"/>`;pts.forEach((p,i)=>{if(p)svg+=`<circle data-series-id="${esc(series.id)}" data-category-index="${i}" cx="${p[0]}" cy="${p[1]}" r="4" fill="${paint(series.color)}"><title>${esc(series.name)} · ${esc(chart.categories[i])}: ${esc(series.values[i])}</title></circle>`;if(p&&chart.labels?.show)svg+=`<text data-chart-value-label x="${p[0]}" y="${p[1]-7}" text-anchor="middle" fill="#334155" font-size="12">${esc(formatChartNumber(series.values[i],chart.labels))}</text>`;});});
  }else{
    chart.series.forEach((series,s)=>{
      const total=series.values.reduce((sum,v)=>sum+(v||0),0),cutout=chart.kind==='doughnut'?.5:0,band=radius*(1-cutout)/chart.series.length;
      let angle=-Math.PI/2;
      series.values.forEach((value,i)=>{
        const slice=chart.kind==='polarArea'?Math.PI*2/chart.categories.length:total?Math.PI*2*(value||0)/total:0;
        const a=angle,b=angle+slice;angle=b;if(value===null||value===0||slice===0)return;
        const outer=chart.kind==='polarArea'?radius*value/maximum:radius-s*band,inner=chart.kind==='polarArea'?0:Math.max(0,outer-band);
        const middle=(a+b)/2,full=slice>=Math.PI*2-1e-9,large=slice>Math.PI?1:0,p0=point(outer,a),p1=point(outer,b),q0=point(inner,a),q1=point(inner,b);
        let d=full?`M ${pair(p0)} A ${outer} ${outer} 0 1 1 ${pair(point(outer,middle))} A ${outer} ${outer} 0 1 1 ${pair(p0)}`:`M ${pair(p0)} A ${outer} ${outer} 0 ${large} 1 ${pair(p1)}`;
        if(inner>0)d+=full?` L ${pair(q0)} A ${inner} ${inner} 0 1 0 ${pair(point(inner,middle))} A ${inner} ${inner} 0 1 0 ${pair(q0)} Z`:` L ${pair(q1)} A ${inner} ${inner} 0 ${large} 0 ${pair(q0)} Z`;
        else d+=` L ${cx} ${cy} Z`;
        svg+=`<path data-series-id="${esc(series.id)}" data-category-index="${i}" d="${d}" fill="${paint(i===0?series.color:colors[i%colors.length])}"${chart.kind==='polarArea'?' fill-opacity=".7"':''} stroke="#ffffff" stroke-width="2"><title>${esc(series.name)} · ${esc(chart.categories[i])}: ${esc(value)}</title></path>`;
        if(chart.labels?.show){const label=point((outer+inner)/2,middle);svg+=`<text data-chart-value-label x="${label[0]}" y="${label[1]+4}" text-anchor="middle" fill="#17233b" stroke="white" stroke-width="3" paint-order="stroke" font-size="12">${esc(formatChartNumber(value,chart.labels))}</text>`;}
      });
    });
  }
  if(chart.showLegend)legendLabels.forEach((label,i)=>{const row=Math.floor(i/columns),x=20+(i%columns)*((width-40)/columns),y=height-legendHeight+row*22+12;if(y>height-8)return;svg+=`<rect x="${n(x)}" y="${n(y-9)}" width="11" height="11" rx="3" fill="${paint(isRadar?chart.series[i].color:i===0?chart.series[0].color:colors[i%colors.length])}"/><text x="${n(x+17)}" y="${n(y)}" fill="#53627a" font-size="12">${esc(label)}</text>`;});
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}" viewBox="0 0 ${num(width)} ${num(height)}">${svg}</svg>${chartDataTable(chart,title)}`;
}

export function chartGraphic(chart,width,height,title='차트'){
  if(['doughnut','pie','radar','polarArea'].includes(chart.kind))return radialChartGraphic(chart,width,height,title);
  const axes=chart.axes||{},labels=chart.labels||{},horizontal=chart.kind==='bar'&&axes.direction==='horizontal',stacked=Boolean(chart.presentation?.stacked);
  const legendPosition=chart.presentation?.legendPosition||'bottom',sideLegend=chart.showLegend&&['left','right'].includes(legendPosition),legendWidth=sideLegend?Math.min(150,width*.24):0;
  const left=(horizontal?Math.min(width*.35,Math.max(64,...chart.categories.map(label=>Math.min(22,label.length)*7+16))):64)+(axes.valueTitle&&!horizontal?20:0)+(legendPosition==='left'?legendWidth:0);
  const right=20+(legendPosition==='right'?legendWidth:0),top=24+(chart.showLegend&&legendPosition==='top'?30:0),bottom=50+(chart.showLegend&&legendPosition==='bottom'?26:0)+(axes.categoryTitle&&!horizontal||axes.valueTitle&&horizontal?20:0);
  const plotWidth=Math.max(1,width-left-right),plotHeight=Math.max(1,height-top-bottom),domain=chartValueDomain(chart),min=domain.minimum,max=domain.maximum;
  const scale=value=>horizontal?left+(value-min)/(max-min)*plotWidth:top+(max-value)/(max-min)*plotHeight,clamp=value=>Math.max(min,Math.min(max,value)),zero=scale(clamp(0)),step=(horizontal?plotHeight:plotWidth)/Math.max(1,chart.categories.length),n=value=>Number(value.toFixed(4));
  const totals=chart.categories.map(()=>({positive:0,negative:0}));
  const plotSeries=chart.series.map(series=>{const starts=[],values=series.values.map((value,index)=>{if(value===null){starts.push(0);return null;}const key=value>=0?'positive':'negative',start=stacked?totals[index][key]:0;starts.push(start);if(stacked)totals[index][key]+=value;return start+value;});return{...series,starts,values};});
  let code=0;for(const character of JSON.stringify([chart,title,width,height]))code=(Math.imul(code,31)+character.charCodeAt(0))>>>0;const clipId='chart-plot-'+code.toString(36);
  let svg=`<title>${esc(title)}</title><desc>${esc(chart.categories.join(', '))} · ${esc(chart.series.map(s=>s.name).join(', '))}</desc><defs><clipPath id="${clipId}"><rect x="${n(left)}" y="${n(top)}" width="${n(plotWidth)}" height="${n(plotHeight)}"/></clipPath></defs>`;
  const tickStep=axes.step??(max-min)/4,tickCount=Math.floor((max-min)/tickStep+1e-9),stride=Math.max(1,Math.ceil(tickCount/8)),tickValues=[];
  for(let i=0;i<=tickCount&&i<=1000;i+=stride)tickValues.push(min+i*tickStep);
  if(!tickValues.length||Math.abs(tickValues.at(-1)-max)>(max-min)*1e-7)tickValues.push(max);
  for(const value of tickValues){const position=scale(value),text=formatChartNumber(value,labels);if(horizontal){if(axes.showGrid!==false)svg+=`<line x1="${n(position)}" y1="${top}" x2="${n(position)}" y2="${top+plotHeight}" stroke="#dce3ef"/>`;svg+=`<text x="${n(position)}" y="${top+plotHeight+23}" text-anchor="middle" fill="#66758d" font-size="12">${esc(text)}</text>`;}else{if(axes.showGrid!==false)svg+=`<line x1="${left}" y1="${n(position)}" x2="${left+plotWidth}" y2="${n(position)}" stroke="#dce3ef" stroke-width="1"/>`;svg+=`<text x="${left-10}" y="${n(position+4)}" text-anchor="end" fill="#66758d" font-size="12">${esc(text)}</text>`;}}
  svg+=horizontal?`<line x1="${n(zero)}" y1="${top}" x2="${n(zero)}" y2="${top+plotHeight}" stroke="#8190a8"/>`:`<line x1="${left}" y1="${n(zero)}" x2="${left+plotWidth}" y2="${n(zero)}" stroke="#8190a8"/>`;
  if(axes.showCategoryLabels!==false)chart.categories.forEach((label,index)=>{const maximum=horizontal?22:Math.max(3,Math.floor(step/7)),text=label.length>maximum?label.slice(0,maximum-1)+'…':label;svg+=horizontal?`<text x="${left-10}" y="${n(top+step*(index+.5)+4)}" text-anchor="end" fill="#53627a" font-size="12"><title>${esc(label)}</title>${esc(text)}</text>`:`<text x="${n(left+step*(index+.5))}" y="${height-bottom+26}" text-anchor="middle" fill="#53627a" font-size="12"><title>${esc(label)}</title>${esc(text)}</text>`;});
  let marks='',valueLabels='';
  plotSeries.forEach((series,seriesIndex)=>{
    const fill=paint(series.color);
    if(chart.kind==='bar'){
      const bar=step*.72/(stacked?1:chart.series.length);
      series.values.forEach((value,index)=>{
        if(value===null)return;
        const position=scale(clamp(value)),base=scale(clamp(series.starts[index])),category=(horizontal?top:left)+step*index+step*.14+(stacked?0:bar*seriesIndex),size=Math.max(.1,bar-2),raw=chart.series[seriesIndex].values[index];
        marks+=horizontal?`<rect data-series-id="${esc(series.id)}" data-category-index="${index}" x="${n(Math.min(position,base))}" y="${n(category)}" width="${n(Math.abs(position-base))}" height="${n(size)}" rx="2" fill="${fill}"><title>${esc(series.name)} · ${esc(chart.categories[index])}: ${esc(raw)}</title></rect>`:`<rect data-series-id="${esc(series.id)}" data-category-index="${index}" x="${n(category)}" y="${n(Math.min(position,base))}" width="${n(size)}" height="${n(Math.abs(position-base))}" rx="2" fill="${fill}"><title>${esc(series.name)} · ${esc(chart.categories[index])}: ${esc(raw)}</title></rect>`;
        if(labels.show){const display=formatChartNumber(raw,labels),half=Math.min(plotWidth,display.length*7)/2,x=Math.max(left+half,Math.min(left+plotWidth-half,horizontal?position:category+size/2)),y=horizontal?category+size/2+4:Math.max(top+12,position-5);valueLabels+=`<text data-chart-value-label x="${n(x)}" y="${n(y)}" text-anchor="middle" fill="#334155" font-size="12">${esc(display)}</text>`;}
      });
    }else if(chart.kind==='line'){
      let points=[];
      const flush=()=>{if(points.length>1){if(chart.presentation?.fill)marks+=`<polygon fill="${fill}" fill-opacity=".25" points="${points[0][0]},${n(zero)} ${points.map(p=>p.join(',')).join(' ')} ${points.at(-1)[0]},${n(zero)}"/>`;if(chart.presentation?.smooth){let d=`M ${points[0].join(' ')}`;for(let i=0;i<points.length-1;i++){const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],e=points[Math.min(points.length-1,i+2)];d+=` C ${n(b[0]+(c[0]-a[0])/6)} ${n(b[1]+(c[1]-a[1])/6)} ${n(c[0]-(e[0]-b[0])/6)} ${n(c[1]-(e[1]-b[1])/6)} ${c.join(' ')}`;}marks+=`<path d="${d}" fill="none" stroke="${fill}" stroke-width="3"/>`;}else marks+=`<polyline fill="none" stroke="${fill}" stroke-width="3" points="${points.map(p=>p.join(',')).join(' ')}"/>`;}points=[];};
      series.values.forEach((value,index)=>{if(value===null){flush();return;}const x=left+step*(index+.5),y=scale(value),raw=chart.series[seriesIndex].values[index];points.push([n(x),n(y)]);marks+=`<circle data-series-id="${esc(series.id)}" data-category-index="${index}" cx="${n(x)}" cy="${n(y)}" r="4" fill="${fill}"><title>${esc(series.name)} · ${esc(chart.categories[index])}: ${esc(raw)}</title></circle>`;if(labels.show&&value>=min&&value<=max)valueLabels+=`<text data-chart-value-label x="${n(x)}" y="${n(Math.max(top+12,y-7))}" text-anchor="middle" fill="#334155" font-size="12">${esc(formatChartNumber(raw,labels))}</text>`;});flush();
    }else throw Error('지원하지 않는 차트 종류입니다.');
  });
  svg+=`<g clip-path="url(#${clipId})">${marks}</g>`+valueLabels;
  const axisTitle=(text,x,y,rotate=false)=>text?`<text data-chart-axis-title x="${n(x)}" y="${n(y)}"${rotate?` transform="rotate(-90 ${n(x)} ${n(y)})"`:''} text-anchor="middle" fill="#53627a" font-size="13">${esc(text)}</text>`:'';
  svg+=horizontal?axisTitle(axes.valueTitle,left+plotWidth/2,top+plotHeight+44)+axisTitle(axes.categoryTitle,left-54,top+plotHeight/2,true):axisTitle(axes.categoryTitle,left+plotWidth/2,top+plotHeight+46)+axisTitle(axes.valueTitle,left-54,top+plotHeight/2,true);
  if(chart.showLegend)chart.series.forEach((series,index)=>{const vertical=['left','right'].includes(legendPosition),x=vertical?(legendPosition==='left'?8:width-legendWidth+10):left+index*plotWidth/chart.series.length,y=vertical?top+index*24+12:legendPosition==='top'?18:height-14,available=vertical?legendWidth-24:plotWidth/chart.series.length-22,limit=Math.max(3,Math.floor(available/7)),name=series.name.length>limit?series.name.slice(0,limit-1)+'…':series.name;svg+=`<rect x="${n(x)}" y="${n(y-10)}" width="12" height="12" rx="2" fill="${paint(series.color)}"/><text x="${n(x+18)}" y="${n(y)}" fill="#53627a" font-size="12"><title>${esc(series.name)}</title>${esc(name)}</text>`;});
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}" viewBox="0 0 ${num(width)} ${num(height)}">${svg}</svg>${chartDataTable(chart,title)}`;
}

export function chartContent(element, document) {
  const chart = element.chart,
    { width, height } = element.geometry,
    values = Object.fromEntries(
      (document.variables || []).map((v) => [v.id, v.initialValue]),
    );
  const output = chartGraphic(
    resolveChart(chart, values),
    width,
    height,
    element.name || "데이터 차트",
  );
  const variants =
    chart.variants?.values
      .map(
        (variant) =>
          `<template data-chart-value="${esc(variant.value)}">${chartGraphic(resolveChart(chart, { [chart.variants.variableId]: variant.value }), width, height, element.name || "데이터 차트")}</template>`,
      )
      .join("") || "";
  return `<figure class="business-chart"${chart.variants ? ` data-chart-variable="${esc(chart.variants.variableId)}"` : ""}><div data-chart-output>${output}</div>${variants}</figure>`;
}

export function svgContent(svg) {
  const shape = (entry) => {
    const kind = entry.kind,
      attrs = [];
    const numeric = {
      rect: ["x", "y", "width", "height", "rx"],
      circle: ["cx", "cy", "r"],
      ellipse: ["cx", "cy", "rx", "ry"],
      line: ["x1", "y1", "x2", "y2"],
      polygon: [],
      polyline: [],
      path: [],
    }[kind];
    if (!numeric) throw new Error("지원하지 않는 SVG 도형입니다.");
    for (const key of numeric)
      if (entry[key] !== undefined) attrs.push(`${key}="${num(entry[key])}"`);
    if (entry.points)
      attrs.push(
        `points="${entry.points.map((point) => `${num(point.x)},${num(point.y)}`).join(" ")}"`,
      );
    if(kind==='path')attrs.push(`d="${esc(normalizeSvgPath(entry.d))}"`);
    if(entry.fillRule)attrs.push(`fill-rule="${esc(entry.fillRule)}"`);
    if(entry.strokeLinecap)attrs.push(`stroke-linecap="${esc(entry.strokeLinecap)}"`);
    if(entry.strokeLinejoin)attrs.push(`stroke-linejoin="${esc(entry.strokeLinejoin)}"`);
    if (entry.fill !== undefined) attrs.push(`fill="${paint(entry.fill)}"`);
    if (entry.stroke !== undefined)
      attrs.push(`stroke="${paint(entry.stroke)}"`);
    if (entry.strokeWidth !== undefined)
      attrs.push(`stroke-width="${num(entry.strokeWidth)}"`);
    return `<${kind} ${attrs.join(" ")}/>`;
  };
  return `<svg class="business-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(svg.viewBox.width)} ${num(svg.viewBox.height)}" role="img" aria-label="${esc(svg.title || "벡터 그래픽")}"><title>${esc(svg.title || "벡터 그래픽")}</title>${svg.shapes.map(shape).join("")}</svg>`;
}

export function connectorContent(element, resolved) {
  const stroke = element.connector.stroke,
    color = paint(stroke.color),
    g = resolved.geometry;
  const x1 = resolved.from.x - g.x,
    y1 = resolved.from.y - g.y,
    x2 = resolved.to.x - g.x,
    y2 = resolved.to.y - g.y,
    size = Math.max(8, stroke.width * 3);
  const points=resolved.points||[resolved.from,resolved.to],route=element.connector.route||'straight';
  const nearStart=route==='curve'&&Math.hypot(resolved.control.x-resolved.from.x,resolved.control.y-resolved.from.y)>.001?resolved.control:points.find(p=>Math.hypot(p.x-resolved.from.x,p.y-resolved.from.y)>.001)||resolved.to;
  const nearEnd=route==='curve'&&Math.hypot(resolved.control.x-resolved.to.x,resolved.control.y-resolved.to.y)>.001?resolved.control:[...points].reverse().find(p=>Math.hypot(p.x-resolved.to.x,p.y-resolved.to.y)>.001)||resolved.from;
  const arrow=(x,y,toward)=>{const dx=x-(toward.x-g.x),dy=y-(toward.y-g.y),length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length;return `<polygon points="${num(x)},${num(y)} ${num(x-ux*size+uy*size*.48)},${num(y-uy*size-ux*size*.48)} ${num(x-ux*size-uy*size*.48)},${num(y-uy*size+ux*size*.48)}" fill="${color}"/>`;};
  const path=resolved.path||`M ${num(x1)} ${num(y1)} L ${num(x2)} ${num(y2)}`;
  const visual=route==='straight'?`<line data-connector-stroke="true" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${color}" stroke-width="${num(stroke.width)}"/>`:`<path data-connector-stroke="true" d="${esc(path)}" fill="none" stroke="${color}" stroke-width="${num(stroke.width)}" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 ${num(g.width)} ${num(g.height)}"><path class="connector-hit" d="${esc(path)}" fill="none" stroke="transparent" stroke-width="${num(Math.max(14,stroke.width+10))}"/>${visual}${element.connector.arrow==='end'||element.connector.arrow==='both'?arrow(x2,y2,nearEnd):''}${element.connector.arrow==='both'?arrow(x1,y1,nearStart):''}</svg>`;
}

export function masterContent(slide, document) {
  const master = {
    enabled: false,
    footer: "",
    logoText: "",
    accentColor: "#71809e",
    showPageNumber: false,
    ...document.master,
    ...slide.masterOverride,
  };
  if (!master.enabled || slide.hideMaster) return "";
  const { width, height } = document.canvas,
    accent = paint(master.accentColor),
    font = esc(fontStack(document.theme?.fontFamily || "Malgun Gothic"));
  const index = document.slides.findIndex((s) => s.id === slide.id) + 1;
  return `<div class="business-master" aria-hidden="true" style="font-family:${font}"><div style="position:absolute;left:40px;right:40px;bottom:46px;height:1px;background:${accent}"></div><div class="business-master-logo" style="left:40px;top:20px;width:${Math.max(100, width * 0.3)}px;height:28px;font-size:14px;font-weight:700;color:${accent}">${esc(master.logoText)}</div><div class="business-master-footer" style="left:40px;bottom:16px;width:${Math.max(100, width - 140)}px;height:24px;font-size:11px;color:${accent}">${esc(master.footer)}</div>${master.showPageNumber ? `<div class="business-master-page" style="right:40px;bottom:16px;width:60px;height:24px;text-align:right;font-size:11px;color:${accent}">${index}</div>` : ""}</div>`;
}

export function staticControlContent(element, document, variables) {
  const component = element.component,
    variable = document.variables?.find((v) => v.id === component?.variableId);
  if (!variable || !["tabs", "select", "slider"].includes(component.kind)) return null;
  const selected = variables[variable.id] ?? variable.initialValue,
    style = element.text?.textStyle || {};
  const type =
    component.kind === "tabs"
      ? "vividly-runtime-tabs"
      : component.kind === 'slider' ? 'vividly-runtime-slider' : "vividly-runtime-select";
  const body =
    component.kind === "tabs"
      ? variable.options
          .map(
            (option) =>
              `<button type="button" aria-selected="${option.value === selected}">${esc(option.label)}</button>`,
          )
          .join("")
      : component.kind === 'slider' ? variable.kind==='number'?`<input type="range" min="${num(variable.minimum)}" max="${num(variable.maximum)}" step="${num(variable.step)}" value="${esc(selected)}" tabindex="-1" aria-label="${esc(variable.name)}"><output>${esc(selected)}</output>`:`<input type="range" min="0" max="${variable.options.length-1}" step="1" value="${variable.options.findIndex(option=>option.value===selected)}" tabindex="-1" aria-label="${esc(variable.name)}"><output>${esc(variable.options.find(option=>option.value===selected)?.label||'')}</output>` : `<select tabindex="-1" aria-label="${esc(variable.name)}">${variable.options.map((option) => `<option${option.value === selected ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select>`;
  return `<div class="${type}" style="font-family:${esc(fontStack(style.fontFamily || document.theme?.fontFamily || "Malgun Gothic"))};font-size:${num(style.fontSize || 24)}px;font-weight:${style.bold ? 700 : 400};color:${paint(style.color || "#182037")}">${body}</div>`;
}

export function orderedElements(slide) {
  const order = slide.readingOrder;
  if (!order?.length) return slide.elements;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...slide.elements].sort(
    (a, b) =>
      (rank.get(a.id) ?? order.length + slide.elements.indexOf(a)) -
      (rank.get(b.id) ?? order.length + slide.elements.indexOf(b)),
  );
}

export function normalizeOutputState(document, state = {}) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    Object.keys(state).some(
      (key) => !["variables", "openPanels", "shownIds"].includes(key),
    )
  )
    throw new Error("출력 장면 설정이 올바르지 않습니다.");
  const variables = Object.fromEntries(
    (document.variables || []).map((v) => [v.id, v.initialValue]),
  );
  if (state.variables !== undefined) {
    if (
      !state.variables ||
      typeof state.variables !== "object" ||
      Array.isArray(state.variables)
    )
      throw new Error("출력 선택 값이 올바르지 않습니다.");
    for (const [id, value] of Object.entries(state.variables)) {
      const variable = document.variables?.find((v) => v.id === id);
      if (!(variable?.kind==='number'?typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=variable.minimum&&Number(value)<=variable.maximum:variable?.options.some((o) => o.value === value)))
        throw new Error("지원하지 않는 출력 선택 값입니다.");
      variables[id] = value;
    }
  }
  const all = document.slides.flatMap((s) => s.elements);
  for (const key of ["openPanels", "shownIds"])
    if (
      state[key] !== undefined &&
      (!Array.isArray(state[key]) ||
        new Set(state[key]).size !== state[key].length ||
        state[key].some(
          (id) =>
            !all.some(
              (e) =>
                e.id === id &&
                (key !== "openPanels" || e.component?.kind === "panel") &&
                !e.hidden,
            ),
        ))
    )
      throw new Error("출력할 패널/표시 대상이 올바르지 않습니다.");
  return {
    variables,
    openPanels: state.openPanels
      ? [...state.openPanels]
      : all
          .filter(
            (e) => e.component?.kind === "panel" && e.component.initiallyOpen,
          )
          .map((e) => e.id),
    shownIds: [...(state.shownIds || [])],
  };
}

export function staticDocument(
  document,
  { scene = "complete", state = {} } = {},
) {
  if (!["initial", "complete"].includes(scene))
    throw new Error("지원하지 않는 정적 장면입니다.");
  const result = clone(document),
    resolved = normalizeOutputState(result, state),
    shown = new Set(resolved.shownIds),
    open = new Set(resolved.openPanels);
  if (result.variables)
    for (const variable of result.variables)
      variable.initialValue = resolved.variables[variable.id];
  for (const slide of result.slides) {
    let groupStart = 0;
    const timeline = planMotionTimeline(slide).flatMap(group => { const items = group.items.map(item => ({...item,start:item.start+groupStart})); groupStart += group.duration; return items; }).sort((a,b)=>a.start-b.start);
    const excluded = new Set();
    for (const panel of slide.elements.filter(
      (e) => e.component?.kind === "panel",
    ))
      if (!open.has(panel.id))
        for (const id of [panel.id, ...(panel.component.contentIds || [])])
          excluded.add(id);
    for (const e of slide.elements) {
      if (e.initiallyHidden && !shown.has(e.id)) excluded.add(e.id);
      const tracks = (slide.motions || []).filter((m) => m.targetId === e.id);
      const custom = timeline.filter(item=>item.motion.targetId===e.id&&item.motion.preset==='keyframes');
      if(custom.length) {
        e.__staticMotionPose = {};
        for(const item of (scene==='initial'?custom.slice(0,1):custom))Object.assign(e.__staticMotionPose,scene==='initial'?item.motion.keyframes[0]:item.motion.keyframes.at(-1));
        delete e.__staticMotionPose.offset;
      }
      if (tracks.length) {
        const preset = (scene === "initial" ? tracks[0] : tracks.at(-1)).preset;
        if (
          (scene === "initial" &&
            [
              "fadeIn",
              "slideInLeft",
              "slideInRight",
              "slideInUp",
              "zoomIn",
            ].includes(preset)) ||
          (scene === "complete" &&
            ["fadeOut", "slideOutRight"].includes(preset))
        )
          excluded.add(e.id);
      }
      if (shown.has(e.id)) excluded.delete(e.id);
      if (e.binding && e.text) {
        const binding = e.binding,
          row = binding.values.find(
            (r) => r.value === resolved.variables[binding.variableId],
          ),
          computed = formulaValue(binding,binding.source==='variable'?resolved.variables[binding.variableId]??'':row?.text || ""), value = computed.text;
        e.text = {
          ...e.text,
          paragraphs: [
            computed.valid ? `${binding.prefix || ""}${binding.format === "number" ? new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(Number(value)) : value}${binding.suffix || ""}` : value,
          ],
        };
        delete e.text.runs;
        delete e.text.paragraphStyles;
      }
      if (e.chart?.variants) {
        e.chart = { ...resolveChart(e.chart, resolved.variables) };
        delete e.chart.variants;
      }
    }
    for (const e of slide.elements)
      if (
        excluded.has(e.id) ||
        (e.type === "connector" &&
          (excluded.has(e.connector.from.elementId) ||
            excluded.has(e.connector.to.elementId)))
      )
        e.hidden = true;
    const posed = { elements: slide.elements.map(element => {
      const pose = element.__staticMotionPose; if (!pose) return element;
      const g = element.geometry, scale = pose.scale ?? 1;
      return { ...element, rotation: (element.rotation || 0) + (pose.rotate || 0), geometry: { x:g.x+(pose.x||0)+g.width*(1-scale)/2, y:g.y+(pose.y||0)+g.height*(1-scale)/2, width:g.width*scale, height:g.height*scale } };
    }) };
    for (const element of slide.elements) if (element.type === 'connector') element.__staticConnector = resolveConnectorGeometry(element, posed);
  }
  return result;
}
