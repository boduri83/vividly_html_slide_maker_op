/** Self-contained canvas hydration. Serialized unchanged into offline HTML. */
export function createChartRuntime({root,document,Chart=globalThis.Chart,interactive=true,animate=true,reducedMotion=false,variables={}}={}) {
  const records=new Map();
  const palette=['#4f63ff','#14a58f','#a165d4','#e6ab37','#e9708d','#499ed9','#b08059','#7aa751'];
  const initial=Object.fromEntries((document.variables||[]).map(v=>[v.id,v.initialValue]));
  let destroyed=false;
  const optionsFor=chart=>({animated:true,duration:700,showTooltip:true,legendPosition:'bottom',stacked:false,smooth:true,fill:false,...chart.presentation});
  const formatValue=(value,labels={})=>(labels.prefix||'')+new Intl.NumberFormat('ko-KR',{minimumFractionDigits:labels.decimals??0,maximumFractionDigits:labels.decimals??2,useGrouping:labels.grouping??true}).format(value)+(labels.suffix||'');
  const valueLabelPlugin={id:'vividlyValueLabels',afterDatasetsDraw(instance,_args,labels){
    if(!labels.show)return;const {ctx,chartArea}=instance;ctx.save();ctx.font='12px '+(instance.options.font?.family||'sans-serif');ctx.fillStyle='#334155';ctx.textBaseline='bottom';
    instance.data.datasets.forEach((dataset,index)=>{if(!instance.isDatasetVisible(index))return;const meta=instance.getDatasetMeta(index);meta.data.forEach((point,i)=>{const value=dataset.data[i];if(value===null||value===undefined||!Number.isFinite(Number(value)))return;const position=point.tooltipPosition(),text=formatValue(Number(value),labels),half=ctx.measureText(text).width/2,x=Math.min(chartArea.right-half,Math.max(chartArea.left+half,position.x));ctx.textAlign='center';ctx.fillText(text,x,Math.max(chartArea.top+14,Math.min(chartArea.bottom,position.y-5)));});});ctx.restore();
  }};
  function configuration(element,figure,currentValues,shouldAnimate){
    const source=element.chart,variant=source.variants?.values.find(row=>row.value===currentValues[source.variants.variableId]);
    const chart={...source,series:source.series.map(s=>({...s,values:[...(variant?.series.find(row=>row.seriesId===s.id)?.values||s.values)]}))};
    const o=optionsFor(chart),radial=['pie','doughnut','polarArea'].includes(chart.kind),axes=chart.axes||{},labels=chart.labels||{},horizontal=chart.kind==='bar'&&axes.direction==='horizontal';
    const datasets=chart.series.map(series=>({label:series.name,data:[...series.values],
      backgroundColor:radial?chart.categories.map((_,i)=>i===0?series.color:palette[i%palette.length]):chart.kind==='bar'?series.color:series.color+(series.color.length===7?'55':''),
      borderColor:radial?'#ffffff':series.color,borderWidth:radial?2:chart.kind==='bar'?0:3,
      borderRadius:chart.kind==='bar'?5:0,tension:o.smooth?.35:0,fill:chart.kind==='radar'||o.fill,pointRadius:4,pointHoverRadius:7,
      hoverOffset:radial?8:0,spanGaps:false}));
    const style=typeof getComputedStyle==='function'?getComputedStyle(figure):null;
    const font={family:style?.fontFamily||document.theme?.fontFamily||'sans-serif',size:14};
    const config={type:chart.kind,data:{labels:[...chart.categories],datasets},plugins:[valueLabelPlugin],options:{responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',
      animation:shouldAnimate&&!reducedMotion&&o.animated?{duration:o.duration,easing:'easeOutQuart'}:false,
      events:interactive?['mousemove','mouseout','click','touchstart','touchmove']:[],
      plugins:{legend:{display:chart.showLegend,position:o.legendPosition,labels:{font,usePointStyle:true,padding:18}},tooltip:{enabled:interactive&&o.showTooltip,titleFont:font,bodyFont:font,callbacks:{label:context=>(context.dataset.label?context.dataset.label+': ':'')+(context.raw===null?'—':formatValue(context.raw,labels))}},vividlyValueLabels:{show:false,...labels}},
      interaction:{mode:radial?'nearest':'index',intersect:radial},layout:{padding:12},font}};
    if(['bar','line'].includes(chart.kind)){
      const valueAxis={stacked:o.stacked,beginAtZero:axes.minimum==null&&axes.maximum==null,grid:{display:axes.showGrid!==false,color:'#dce3ef'},ticks:{font,color:'#66758d',callback:value=>formatValue(value,labels),maxTicksLimit:9},title:{display:Boolean(axes.valueTitle),text:axes.valueTitle||'',font,color:'#53627a'}},categoryAxis={stacked:o.stacked,grid:{display:false},ticks:{display:axes.showCategoryLabels!==false,font,color:'#66758d'},title:{display:Boolean(axes.categoryTitle),text:axes.categoryTitle||'',font,color:'#53627a'}};
      if(axes.minimum!=null)valueAxis.min=axes.minimum;if(axes.maximum!=null)valueAxis.max=axes.maximum;if(axes.step!=null)valueAxis.ticks.stepSize=axes.step;
      const totals=chart.categories.map(()=>({positive:0,negative:0})),extent=[0];
      for(const series of chart.series)series.values.forEach((value,index)=>{if(value===null)return;const key=value>=0?'positive':'negative';if(o.stacked)totals[index][key]+=value;extent.push(o.stacked?totals[index][key]:value);});
      if(axes.minimum!=null&&axes.maximum==null&&Math.max(...extent)<=axes.minimum)valueAxis.max=axes.minimum+1;
      if(axes.maximum!=null&&axes.minimum==null&&Math.min(...extent)>=axes.maximum)valueAxis.min=axes.maximum-1;
      config.options.scales=horizontal?{x:valueAxis,y:categoryAxis}:{x:categoryAxis,y:valueAxis};
    }
    if(['radar','polarArea'].includes(chart.kind))config.options.scales={r:{beginAtZero:true,grid:{color:'#dce3ef'},angleLines:{color:'#dce3ef'},pointLabels:{font,color:'#53627a'},ticks:{font:{...font,size:11},backdropColor:'transparent'}}};
    return config;
  }
  function remove(id,restore=false){const record=records.get(id);if(!record)return;record.chart.destroy();if(restore&&record.output.isConnected&&record.output.contains(record.canvas))record.output.innerHTML=record.fallback;records.delete(id);}
  function sync({slideId,variables:values=variables,animate:play=animate}={}){
    if(destroyed||typeof Chart!=='function')return;
    const currentValues={...initial,...values},scope=slideId?document.slides.filter(s=>s.id===slideId):document.slides;
    const elements=new Map(scope.flatMap(s=>s.elements.filter(e=>e.type==='chart'&&!e.hidden).map(e=>[e.id,e])));
    const hosts=new Map([...root.querySelectorAll('[data-element-id]')].map(node=>[node.dataset.elementId,node]));
    for(const [id,record]of records)if(!elements.has(id)||!record.canvas.isConnected||!hosts.get(id)?.contains(record.canvas))remove(id);
    for(const [id,element]of elements){
      const host=hosts.get(id),figure=host?.querySelector('.business-chart'),output=figure?.querySelector('[data-chart-output]');
      if(!output)continue;
      const signature=JSON.stringify({chart:element.chart,variables:element.chart.variants?currentValues[element.chart.variants.variableId]:null});
      const prior=records.get(id);
      if(prior&&prior.output===output&&output.contains(prior.canvas)){
        if(prior.signature!==signature){const config=configuration(element,figure,currentValues,play);prior.chart.data=config.data;prior.chart.options=config.options;prior.chart.update(play?undefined:'none');prior.signature=signature;}
        continue;
      }
      if(prior)remove(id);
      const fallback=output.innerHTML,canvas=output.ownerDocument.createElement('canvas'),table=output.querySelector('.business-chart-data');
      canvas.className='vividly-chart-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',element.name||'데이터 차트');canvas.dataset.runtimeChartInteractive=String(interactive);
      canvas.style.cssText='display:block;width:100%;height:100%;'+(interactive?'':'pointer-events:none;');
      output.replaceChildren(canvas);if(table)output.append(table);
      try{const chart=new Chart(canvas,configuration(element,figure,currentValues,play));records.set(id,{chart,canvas,output,fallback,signature});figure.dataset.chartEngine='chartjs';}
      catch(error){output.innerHTML=fallback;delete figure.dataset.chartEngine;throw error;}
    }
  }
  return{sync,destroy(){if(destroyed)return;for(const id of [...records.keys()])remove(id,true);destroyed=true;},get instances(){return [...records.values()].map(r=>r.chart);}};
}
