import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStyleTokens,normalizeCssDeclarations,parseCssDeclarations,resolveCssTokens}from'../src/design-css.js';
test('advanced CSS accepts layered gradients, shadows, typography and typed token arithmetic without resource fetches',()=>{
 const tokens=normalizeStyleTokens([{id:'accent',name:'강조',type:'color',value:'#2563eb'},{id:'gap',name:'간격',type:'length',value:'16px'},{id:'large-gap',name:'큰 간격',type:'length',value:'calc(var(--v-gap)*2)'}]);
 const css=parseCssDeclarations('background:linear-gradient(135deg,var(--v-accent),#fff);box-shadow:0 8px 20px #0003,0 1px 2px #0001;padding:var(--v-large-gap);letter-spacing:.05em;text-decoration:underline wavy;',tokens);
 const resolved=resolveCssTokens(css,tokens);assert.equal(resolved.padding,'calc(16px*2)');assert.equal(resolved.background,'linear-gradient(135deg,#2563eb,#fff)');assert.match(css.background,/var/);
});
test('token graph validates existence, types, uniqueness and cycles; stored references remain references',()=>{
 for(const tokens of [
  [{id:'a',name:'a',type:'color',value:'16px'}],
  [{id:'a',name:'a',type:'length',value:'var(--v-missing)'}],
  [{id:'a',name:'a',type:'length',value:'var(--v-b)'},{id:'b',name:'b',type:'length',value:'var(--v-a)'}],
  [{id:'a',name:'a',type:'number',value:'1'},{id:'a',name:'b',type:'number',value:'2'}],
 ])assert.throws(()=>normalizeStyleTokens(tokens));
 assert.deepEqual(normalizeCssDeclarations({color:'var(--v-accent)'}),{color:'var(--v-accent)'});
 assert.throws(()=>normalizeCssDeclarations({color:'var(--v-accent)'},[]));
});
test('declaration editor rejects app geometry, selectors, duplicate properties, important, malformed values and URL escape forms',()=>{
 for(const text of ['left:2px;','transform:scale(2);','color:red!important;','color:red;color:blue;','.editor{color:red}','__proto__:red;','color:16px;','background:url(https://example.com/x);','background:u\\72l(https://example.com/x);','background:image-set(url(x) 1x);','color:var(--app-secret);','padding:attr(data-x);'])assert.throws(()=>parseCssDeclarations(text),text);
 assert.deepEqual(parseCssDeclarations(''),{});
});
