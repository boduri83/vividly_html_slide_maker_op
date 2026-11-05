import { Editor, Extension, StarterKit, TextStyle, Color, FontSize, FontFamily, closeHistory, Slice } from '../assets/vendor/rich-text-engine.js';
import { textToRichDocument, richDocumentToText, expandGraphemeRange, safeRichHref, colorToHex } from './rich-text-conversion.js';
import {isFontFamily,fontStack} from './font-names.js';

const RICH_EDITOR_CSS = `
.rich-text-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 16px;background:#f3f7ff;border-bottom:1px solid #dce5f6;flex-shrink:0;min-height:44px}
.rich-text-toolbar button{border:1px solid #d4dff1;background:#fff;min-height:29px;padding:4px 9px;font-size:11px}.rich-text-toolbar button[aria-pressed=true]{background:#dce8ff;border-color:#8eaff7;color:#244eac}
.rich-text-toolbar label{display:flex;align-items:center;gap:4px;font-size:10px;color:#667791}.rich-text-toolbar input,.rich-text-toolbar select{height:28px;padding:3px 5px;font-size:11px}.rich-text-toolbar input[type=number]{width:60px}.rich-text-toolbar input[type=color]{width:35px;height:28px}.rich-text-toolbar input[type=url]{width:180px}.rich-text-toolbar .rt-status{font-size:10px;color:#71809d;margin-left:auto}.rich-text-toolbar [data-rt-finish]{background:#315fe9;color:#fff}
#text-editor.rich-text-mode{overflow:visible}#text-editor .rt-editor-host{width:100%;height:100%;overflow:auto;display:flex;flex-direction:column}.rt-content{width:100%;min-height:1.2em;flex-shrink:0;outline:0;font-weight:400;white-space:pre-wrap;overflow-wrap:anywhere;counter-reset:rt-n0 rt-n1 rt-n2 rt-n3 rt-n4}
.rt-content p{position:relative;min-height:1.2em;margin:0;white-space:pre-wrap}.rt-content p[data-list=none]{counter-reset:rt-n0 rt-n1 rt-n2 rt-n3 rt-n4}
.rt-content p[data-list=bullet],.rt-content p[data-list=number]{padding-left:calc((var(--rt-level,0) + 1) * 1.35em)}.rt-content p[data-list=bullet]::before,.rt-content p[data-list=number]::before{position:absolute;left:calc(var(--rt-level,0) * 1.35em);width:1.1em;text-align:right;white-space:nowrap}.rt-content p[data-list=bullet]::before{content:'•'}
.rt-content p[data-list=number][data-level="0"]{counter-increment:rt-n0;counter-reset:rt-n1 rt-n2 rt-n3 rt-n4}.rt-content p[data-list=number][data-level="0"]::before{content:counter(rt-n0) '.'}
.rt-content p[data-list=number][data-level="1"]{counter-increment:rt-n1;counter-reset:rt-n2 rt-n3 rt-n4}.rt-content p[data-list=number][data-level="1"]::before{content:counter(rt-n1) '.'}
.rt-content p[data-list=number][data-level="2"]{counter-increment:rt-n2;counter-reset:rt-n3 rt-n4}.rt-content p[data-list=number][data-level="2"]::before{content:counter(rt-n2) '.'}
.rt-content p[data-list=number][data-level="3"]{counter-increment:rt-n3;counter-reset:rt-n4}.rt-content p[data-list=number][data-level="3"]::before{content:counter(rt-n3) '.'}.rt-content p[data-list=number][data-level="4"]{counter-increment:rt-n4}.rt-content p[data-list=number][data-level="4"]::before{content:counter(rt-n4) '.'}
.rt-content a{color:#2b61d8;text-decoration:underline;cursor:text}.rt-content strong{font-weight:700}.rt-content em{font-style:italic}.rt-content u{text-decoration:underline}.rt-content s{text-decoration:line-through}.rt-content .ProseMirror-selectednode{outline:1px solid #85a9f4}
`;

function installStyles() {
  if (document.getElementById('rich-text-editor-style')) return;
  const style = document.createElement('style'); style.id = 'rich-text-editor-style'; style.textContent = RICH_EDITOR_CSS; document.head.append(style);
}
const boundedSpacing = value => {const number=Number.parseFloat(value);return /^\d+(?:\.\d+)?px$/i.test(value)&&number>=0&&number<=200?number:0;};

const paragraphAttributes = Extension.create({
  name: 'vividlyParagraphAttributes',
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: {
      list: { default: 'none', parseHTML: element => ['bullet','number'].includes(element.dataset.list) ? element.dataset.list : 'none', renderHTML: attrs => ({ 'data-list': attrs.list }) },
      level: { default: 0, parseHTML: element => Math.max(0, Math.min(4, Number(element.dataset.level) || 0)), renderHTML: attrs => ({ 'data-level': attrs.level, style: `--rt-level:${attrs.level}` }) },
      spaceBefore: { default: 0, parseHTML: element => boundedSpacing(element.style.marginTop), renderHTML: attrs => ({ style: `margin-top:${attrs.spaceBefore}px` }) },
      spaceAfter: { default: 0, parseHTML: element => boundedSpacing(element.style.marginBottom), renderHTML: attrs => ({ style: `margin-bottom:${attrs.spaceAfter}px` }) },
    } }];
  },
});

/** Tiptap is a draft editor. The caller alone commits a full text object to document history. */
export function createRichTextEditor({ mount, text, style, onUpdate, onComposition, onFinish, onStatus, onLayout }) {
  installStyles();
  const original = structuredClone(text);
  let destroyed = false, composing = false, edited = false, selection = null, compositionFrame = 0;
  const pendingFields=new Set();
  const toolbar = document.createElement('div'); toolbar.id = 'rt-toolbar'; toolbar.className = 'rich-text-toolbar'; toolbar.setAttribute('role','toolbar'); toolbar.setAttribute('aria-label','선택 문자 서식');
  toolbar.innerHTML = `<button id="rt-bold" aria-label="선택 문자 굵게" aria-pressed="false"><b>B</b></button><button id="rt-italic" aria-label="선택 문자 기울임" aria-pressed="false"><i>I</i></button><button id="rt-underline" aria-label="선택 문자 밑줄" aria-pressed="false"><u>U</u></button><button id="rt-strike" aria-label="선택 문자 취소선" aria-pressed="false"><s>S</s></button>
  <label>글꼴<input id="rt-font-family" type="text" maxlength="256" list="system-font-families" style="width:150px"></label><button id="rt-font-apply">글꼴 적용</button><label>크기<input id="rt-font-size" type="number" min="8" max="240" step="1" value="${Number(style.fontSize)||32}"></label><button id="rt-size-apply">크기 적용</button><label>색<input id="rt-color" type="color" value="#182037"></label>
  <label>목록<select id="rt-list"><option value="none">없음</option><option value="bullet">글머리표</option><option value="number">번호</option></select></label><button id="rt-outdent" aria-label="목록 단계 줄이기">⇤</button><button id="rt-indent" aria-label="목록 단계 늘리기">⇥</button>
  <label>문단 앞<input id="rt-space-before" type="number" min="0" max="200" value="0"></label><label>뒤<input id="rt-space-after" type="number" min="0" max="200" value="0"></label><button id="rt-spacing-apply">간격 적용</button>
  <label>링크<input id="rt-link" type="url" placeholder="https://…" maxlength="2048"></label><button id="rt-link-apply">연결</button><button id="rt-link-clear">연결 해제</button><button id="rt-clear">서식 지우기</button><button id="rt-new-paragraph">새 문단</button><button id="rt-undo">↶</button><button id="rt-redo">↷</button><button id="rt-done" data-rt-finish>편집 완료</button><span class="rt-status">Enter 줄바꿈 · Ctrl+Enter 문단 · Esc 확정</span>`;
  const bar = document.querySelector('.workbench-toolbar') || document.querySelector('.toolbar');
  if (bar) bar.after(toolbar); else mount.before(toolbar);
  const host = document.createElement('div'); host.className = 'rt-editor-host'; mount.replaceChildren(host); mount.classList.add('rich-text-mode');
  Object.assign(host.style, { fontFamily:style.fontFamily,fontSize:`${style.fontSize}px`,lineHeight:String(style.lineHeight),color:style.color,textAlign:style.align });
  const control = id => toolbar.querySelector(`#${id}`);
  const colorCanvas=document.createElement('canvas').getContext('2d');
  function parsedColor(value){
    const direct=colorToHex(value);if(direct)return direct;
    if(!value||!colorCanvas||!CSS.supports('color',value)||/var\(|currentColor|inherit|initial|unset/i.test(value))return null;
    colorCanvas.fillStyle='#010203';colorCanvas.fillStyle=value;return colorToHex(colorCanvas.fillStyle);
  }
  const supportedColor=Color.extend({addGlobalAttributes(){return [{types:['textStyle'],attributes:{color:{default:null,parseHTML:element=>parsedColor(element.style.color),renderHTML:attrs=>attrs.color?{style:`color:${attrs.color}`}:{}}}}];}});
  const supportedFontSize=FontSize.extend({addGlobalAttributes(){return [{types:['textStyle'],attributes:{fontSize:{default:null,parseHTML:element=>{const value=element.style.fontSize,number=Number.parseFloat(value);return /^\d+(?:\.\d+)?px$/i.test(value)&&number>=8&&number<=240?`${number}px`:null;},renderHTML:attrs=>attrs.fontSize?{style:`font-size:${attrs.fontSize}`}:{}}}}];}});
  const supportedFontFamily=FontFamily.extend({addGlobalAttributes(){return [{types:['textStyle'],attributes:{fontFamily:{default:null,parseHTML:element=>{const value=element.style.fontFamily.split(',').map(part=>part.trim().replace(/^(["'])(.*)\1$/,'$2')).join(',');return isFontFamily(value)?value:null;},renderHTML:attrs=>attrs.fontFamily&&isFontFamily(attrs.fontFamily)?{style:`font-family:${fontStack(attrs.fontFamily)}`}:{}}}}];}});
  let instance;
  const keybindings = Extension.create({
    name: 'vividlyDraftKeys', priority: 2000,
    addKeyboardShortcuts() { return {
      Enter: () => this.editor.commands.setHardBreak(),
      'Mod-Enter': () => this.editor.commands.splitBlock(),
      Escape: () => { if(composing || this.editor.view.composing)return false; publish();onFinish?.();return true; },
    }; },
  });
  function rememberSelection(synchronize=true) {
    if (destroyed || !instance) return;
    const dom=window.getSelection();
    if(dom?.anchorNode&&dom.focusNode&&instance.view.dom.contains(dom.anchorNode)&&instance.view.dom.contains(dom.focusNode)){
      try{const anchor=instance.view.posAtDOM(dom.anchorNode,dom.anchorOffset),focus=instance.view.posAtDOM(dom.focusNode,dom.focusOffset);selection={from:Math.min(anchor,focus),to:Math.max(anchor,focus)};}catch{}
    }else if(instance.view.hasFocus())selection={from:instance.state.selection.from,to:instance.state.selection.to};
    if(synchronize!==false)syncToolbar();
  }
  function safeSelection() {
    const wanted=selection||{from:instance.state.selection.from,to:instance.state.selection.to};
    const maximum=instance.state.doc.content.size;
    instance.commands.setTextSelection({from:Math.max(0,Math.min(maximum,wanted.from)),to:Math.max(0,Math.min(maximum,wanted.to))});
    const current=instance.state.selection,from=current.$from,to=current.$to;
    if(from.parent.type.name==='paragraph'&&to.parent.type.name==='paragraph'){
      const fromText=from.parent.textBetween(0,from.parent.content.size,'','\n'),toText=to.parent.textBetween(0,to.parent.content.size,'','\n');
      let start,end;
      if(from.sameParent(to)){const range=expandGraphemeRange(fromText,from.parentOffset,to.parentOffset);start=from.start()+range.start;end=to.start()+range.end;}
      else {start=from.start()+expandGraphemeRange(fromText,from.parentOffset,fromText.length).start;end=to.start()+expandGraphemeRange(toText,0,to.parentOffset).end;}
      instance.commands.setTextSelection({from:start,to:end});
    }
  }
  function publish() {
    if(destroyed || !instance || composing || instance.view.composing)return;
    try { onUpdate?.(edited?richDocumentToText(instance.getJSON(),original):structuredClone(original)); }
    catch(error){onStatus?.(error.message,true);}
  }
  function format(fn,focus=true){
    if(composing||instance.view.composing){onStatus?.('한글 조합이 끝난 뒤 서식을 바꿀 수 있습니다.',true);return;}
    try{safeSelection();instance.view.dispatch(closeHistory(instance.state.tr));fn();instance.view.dispatch(closeHistory(instance.state.tr));if(focus)instance.view.focus();rememberSelection();}
    catch(error){onStatus?.(error.message,true);}
  }
  function syncToolbar(){
    if(!instance||destroyed)return;
    for(const [id,mark]of [['rt-bold','bold'],['rt-italic','italic'],['rt-underline','underline'],['rt-strike','strike']])control(id).setAttribute('aria-pressed',String(instance.isActive(mark)));
    const active=document.activeElement,attrs=instance.getAttributes('paragraph');
    for(const [id,value]of [['rt-list',attrs.list||'none'],['rt-space-before',attrs.spaceBefore||0],['rt-space-after',attrs.spaceAfter||0]])if(active!==control(id)&&!pendingFields.has(id))control(id).value=value;
    if(active!==control('rt-link')&&!pendingFields.has('rt-link'))control('rt-link').value=instance.getAttributes('link').href||'';
    if(active!==control('rt-font-family')&&!pendingFields.has('rt-font-family'))control('rt-font-family').value=instance.getAttributes('textStyle').fontFamily||style.fontFamily;
    control('rt-undo').disabled=!instance.can().undo();control('rt-redo').disabled=!instance.can().redo();
    window.dispatchEvent(new CustomEvent('vividly:rich-format-state'));
  }
  instance = new Editor({
    element:host,content:textToRichDocument(text),injectCSS:false,enableInputRules:false,enablePasteRules:false,
    extensions:[StarterKit.configure({blockquote:false,bulletList:false,orderedList:false,listItem:false,listKeymap:false,code:false,codeBlock:false,heading:false,horizontalRule:false,gapcursor:false,dropcursor:false,trailingNode:false,
      link:{openOnClick:false,autolink:false,linkOnPaste:false,isAllowedUri:url=>{try{return Boolean(safeRichHref(url));}catch{return false;}}},undoRedo:{depth:100,newGroupDelay:500}}),TextStyle,supportedColor,supportedFontSize,supportedFontFamily,paragraphAttributes,keybindings],
    editorProps:{attributes:{id:'rt-content',class:'rt-content',role:'textbox','aria-label':'부분 서식 텍스트 편집','aria-multiline':'true'},
      handleDOMEvents:{compositionstart:()=>{composing=true;onComposition?.(true);return false;},compositionend:()=>{cancelAnimationFrame(compositionFrame);compositionFrame=requestAnimationFrame(()=>{if(destroyed)return;composing=false;publish();onComposition?.(false);rememberSelection();});return false;}},
      clipboardTextParser:(value,_context,_plain,view)=>{
        const schema=view.state.schema,marks=view.state.storedMarks||view.state.selection.$from.marks(),nodes=[];
        value.replace(/\r\n?/g,'\n').split('\n').forEach((part,index)=>{if(index)nodes.push(schema.nodes.hardBreak.create(null,null,marks));if(part)nodes.push(schema.text(part,marks));});
        const paragraph=schema.nodes.paragraph.create(null,nodes);return new Slice(schema.topNodeType.create(null,paragraph).content,1,1);
      },
    },
    onUpdate:()=>{edited=true;publish();rememberSelection();},onSelectionUpdate:rememberSelection,onTransaction:()=>syncToolbar(),
  });
  Object.assign(instance.view.dom.style,{marginTop:style.verticalAlign==='top'?'0':'auto',marginBottom:style.verticalAlign==='middle'?'auto':'0'});
  toolbar.addEventListener('pointerdown',()=>rememberSelection(false),true);
  instance.view.dom.addEventListener('blur',()=>rememberSelection(false),true);
  for(const field of toolbar.querySelectorAll('input,select'))field.addEventListener('input',()=>pendingFields.add(field.id));
  for(const button of toolbar.querySelectorAll('button'))button.addEventListener('pointerdown',event=>event.preventDefault());
  const button=(id,fn)=>control(id).addEventListener('click',()=>format(fn));
  button('rt-bold',()=>instance.commands.toggleBold());button('rt-italic',()=>instance.commands.toggleItalic());button('rt-underline',()=>instance.commands.toggleUnderline());button('rt-strike',()=>instance.commands.toggleStrike());
  control('rt-size-apply').addEventListener('click',()=>{const size=Number(control('rt-font-size').value);format(()=>{if(!Number.isFinite(size)||size<8||size>240)throw new Error('글자 크기는 8~240입니다.');instance.commands.setFontSize(`${size}px`);});});
  control('rt-font-apply').addEventListener('click',()=>{const family=control('rt-font-family').value.trim();format(()=>{if(!isFontFamily(family))throw Error('사용할 글꼴 이름을 입력하세요.');instance.commands.setFontFamily(family);pendingFields.delete('rt-font-family');});});
  control('rt-color').addEventListener('input',()=>format(()=>instance.commands.setColor(control('rt-color').value),false));
  control('rt-list').addEventListener('change',()=>{const list=control('rt-list').value;format(()=>{instance.commands.updateAttributes('paragraph',{list});pendingFields.delete('rt-list');});});
  button('rt-indent',()=>instance.commands.updateAttributes('paragraph',{level:Math.min(4,(instance.getAttributes('paragraph').level||0)+1)}));
  button('rt-outdent',()=>instance.commands.updateAttributes('paragraph',{level:Math.max(0,(instance.getAttributes('paragraph').level||0)-1)}));
  control('rt-spacing-apply').addEventListener('click',()=>{const spaceBefore=Number(control('rt-space-before').value),spaceAfter=Number(control('rt-space-after').value);format(()=>{if(![spaceBefore,spaceAfter].every(n=>Number.isFinite(n)&&n>=0&&n<=200))throw new Error('문단 간격은 0~200입니다.');instance.commands.updateAttributes('paragraph',{spaceBefore,spaceAfter});pendingFields.delete('rt-space-before');pendingFields.delete('rt-space-after');});});
  control('rt-link-apply').addEventListener('click',()=>{const href=control('rt-link').value;format(()=>{instance.commands.setLink({href:safeRichHref(href)});pendingFields.delete('rt-link');});});button('rt-link-clear',()=>{instance.commands.unsetLink();pendingFields.delete('rt-link');});
  button('rt-clear',()=>instance.chain().unsetAllMarks().run());button('rt-new-paragraph',()=>instance.commands.splitBlock());button('rt-undo',()=>instance.commands.undo());button('rt-redo',()=>instance.commands.redo());
  control('rt-done').addEventListener('click',()=>{if(composing||instance.view.composing){onStatus?.('한글 조합이 끝난 뒤 편집을 마칠 수 있습니다.',true);return;}publish();onFinish?.();});
  syncToolbar();onLayout?.();
  return {read(){return edited?richDocumentToText(instance.getJSON(),original):structuredClone(original);},focus(){instance.commands.setTextSelection(Math.max(0,instance.state.doc.content.size-1));instance.view.focus();rememberSelection();},get isComposing(){return composing||instance.view.composing;},get element(){return instance.view.dom;},
    toggleMark(mark){if(!['bold','italic','underline','strike'].includes(mark))throw new Error('지원하지 않는 글자 서식입니다.');format(()=>instance.commands.toggleMark(mark));},
    formatState(){return Object.fromEntries(['bold','italic','underline','strike'].map(name=>[name,instance.isActive(name)]));},
    captureSelection(){rememberSelection(false);const range=selection||instance.state.selection;return {from:range.from,to:range.to};},
    hasSelection(){const current=selection||instance.state.selection;return current.from!==current.to;},
    getLink(){return instance.getAttributes('link').href||'';},
    setLink(href){format(()=>instance.chain().extendMarkRange('link').setLink({href:safeRichHref(href)}).run());},
    clearLink(){format(()=>instance.chain().extendMarkRange('link').unsetLink().run());},
    selectRange({paragraph,start,end}){const document=instance.state.doc;if(!Number.isInteger(paragraph)||paragraph<0||paragraph>=document.childCount)throw new Error('문단을 찾을 수 없습니다.');const node=document.child(paragraph),value=node.textBetween(0,node.content.size,'','\n'),range=expandGraphemeRange(value,start,end);let offset=1;for(let i=0;i<paragraph;i++)offset+=document.child(i).nodeSize;selection={from:offset+range.start,to:offset+range.end};safeSelection();instance.view.focus();rememberSelection();},
    destroy(){if(destroyed)return;destroyed=true;cancelAnimationFrame(compositionFrame);instance.destroy();toolbar.remove();mount.classList.remove('rich-text-mode');onLayout?.();}};
}
