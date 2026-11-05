import test from 'node:test';
import assert from 'node:assert/strict';
import { colorToHex, expandGraphemeRange, graphemeOffsets, richDocumentToText, safeRichHref, textToRichDocument } from '../src/rich-text-conversion.js';

const style = {fontFamily:'Malgun Gothic',fontSize:32,lineHeight:1.2,color:'#182037',align:'left',verticalAlign:'top'};

test('text inserted across formatting boundaries preserves joined graphemes and leading character marks',()=>{
  const source={paragraphs:[''],textStyle:style},document={type:'doc',content:[{type:'paragraph',content:[
    {type:'text',text:'e',marks:[{type:'bold'}]},{type:'text',text:'\u0301'},
    {type:'text',text:' 👨',marks:[{type:'italic'}]},{type:'text',text:'\u200d👩\u200d👧\u200d👦',marks:[{type:'underline'}]},
  ]}]};
  const result=richDocumentToText(document,source);
  assert.deepEqual(result.paragraphs,['e\u0301 👨\u200d👩\u200d👧\u200d👦']);
  assert.deepEqual(result.runs,[{paragraph:0,start:0,end:2,bold:true},{paragraph:0,start:2,end:14,italic:true}]);
  assert.deepEqual(richDocumentToText(textToRichDocument(result),result),result);
});

test('plain text adapter preserves legacy paragraphs, LF, blanks, whitespace and literal markup without rich metadata',()=>{
  for(const paragraphs of [[],[''],['한글 😀 e\u0301','', '  <script>&"\n둘째 줄  ']]){
    const source={paragraphs,textStyle:style};
    assert.deepEqual(richDocumentToText(textToRichDocument(source),source),source);
  }
});

test('supported rich marks and paragraph lists survive the engine adapter, including an unbold range in a bold object',()=>{
  const source={paragraphs:['한글 😀 cafe\u0301','다음\n줄',''],textStyle:{...style,bold:true},
    runs:[{paragraph:0,start:0,end:2,bold:false,italic:true,underline:true,color:'#336699',fontSize:28,href:'https://example.com/presentation?q=1'},
      {paragraph:0,start:3,end:5,color:'#f008'}, {paragraph:1,start:0,end:4,underline:true}],
    paragraphStyles:[{list:'bullet',level:0,spaceBefore:8,spaceAfter:12},{list:'number',level:2,spaceBefore:0,spaceAfter:4},{list:'none',level:0,spaceBefore:0,spaceAfter:0}]};
  assert.deepEqual(richDocumentToText(textToRichDocument(source),source),source);
  const json=textToRichDocument(source);
  assert.equal(json.content[0].content[0].marks.some(mark=>mark.type==='bold'),false);
  assert.equal(json.content[0].content.find(node=>node.text==='😀').marks.some(mark=>mark.type==='bold'),true);
});

test('text engine JSON edits become sparse merged ranges and preserve the original author text style',()=>{
  const source={paragraphs:['원래'],textStyle:style};
  const document={type:'doc',content:[{type:'paragraph',attrs:{list:'none',level:0,spaceBefore:0,spaceAfter:0},content:[{type:'text',text:'한',marks:[{type:'bold'}]},{type:'text',text:'글',marks:[{type:'bold'}]},{type:'text',text:' tail'}]}]};
  assert.deepEqual(richDocumentToText(document,source),{paragraphs:['한글 tail'],textStyle:style,runs:[{paragraph:0,start:0,end:2,bold:true}]});
  assert.deepEqual(source,{paragraphs:['원래'],textStyle:style});
});

test('human range expansion never formats a partial emoji, combining character or Hangul grapheme',()=>{
  const text='A👨‍👩‍👧‍👦e\u0301한Z',points=graphemeOffsets(text);
  assert.equal(points.length,6);
  for(let start=0;start<text.length;start++)for(let end=start+1;end<=text.length;end++){
    const range=expandGraphemeRange(text,start,end);
    assert.ok(points.includes(range.start));assert.ok(points.includes(range.end));assert.ok(range.start<=start);assert.ok(range.end>=end);
  }
  assert.throws(()=>expandGraphemeRange(text,-1,3));
});

test('link adapter accepts only the closed external protocol set and treats HTML-looking labels as literal text',()=>{
  for(const value of ['https://example.com/a?q=%EC%95%88','http://example.com/','mailto:team@example.com'])assert.equal(safeRichHref(value),value);
  for(const value of ['javascript:alert(1)','data:text/html,x','file:///C:/a','tel:123','//example.com','https://example.com/\nfoo'])assert.throws(()=>safeRichHref(value));
  const source={paragraphs:['<button onclick="bad()">한글</button>'],textStyle:style};
  assert.equal(textToRichDocument(source).content[0].content[0].text,source.paragraphs[0]);
});

test('native pasted CSS colors are normalized to bounded HEX and unsupported paint expressions are not copied as styles',()=>{
  assert.equal(colorToHex('rgb(51, 102, 153)'),'#336699');assert.equal(colorToHex('rgba(51, 102, 153, 0.5)'),'#33669980');
  assert.equal(colorToHex('#f008'),'#f008');
  for(const value of ['url(https://example.com/x)','var(--untrusted)','rgb(300,0,0)','expression(x)'])assert.equal(colorToHex(value),null);
});
