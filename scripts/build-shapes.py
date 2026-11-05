"""Compile the checked-in LibreOffice DrawingML preset data into the bounded runtime catalog.

No network, executable formulas or document-provided geometry is accepted. The original
XML and its MPL-2.0 notice are in assets/vendor/shapes/.
"""
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/vendor/shapes/presetShapeDefinitions.xml'
TEMPLATE = ROOT / 'assets/vendor/shapes/runtime-template.js'
OUTPUT = ROOT / 'src/shapes.js'

LABELS = {
 'rect':'직사각형','ellipse':'타원','roundRect':'둥근 모서리 사각형','round1Rect':'한쪽 모서리 둥근 사각형','round2DiagRect':'대각 모서리 둥근 사각형','round2SameRect':'위쪽 모서리 둥근 사각형',
 'snip1Rect':'한 모서리 잘린 사각형','snip2DiagRect':'대각 모서리 잘린 사각형','snip2SameRect':'위쪽 모서리 잘린 사각형','snipRoundRect':'잘리고 둥근 사각형',
 'triangle':'이등변 삼각형','rtTriangle':'직각 삼각형','parallelogram':'평행사변형','trapezoid':'사다리꼴','nonIsoscelesTrapezoid':'비대칭 사다리꼴','diamond':'마름모',
 'pentagon':'오각형','hexagon':'육각형','heptagon':'칠각형','octagon':'팔각형','decagon':'십각형','dodecagon':'십이각형','pie':'원형 부채꼴','pieWedge':'부채꼴','chord':'활꼴','teardrop':'눈물방울',
 'frame':'액자','halfFrame':'반쪽 액자','corner':'직각 모서리','diagStripe':'대각선 줄무늬','plus':'십자','plaque':'명판','can':'원기둥','cube':'정육면체','bevel':'입체 테두리','donut':'도넛',
 'noSmoking':'금지 표시','blockArc':'굵은 원호','foldedCorner':'접힌 모서리','smileyFace':'웃는 얼굴','heart':'하트','lightningBolt':'번개','sun':'태양','moon':'초승달','cloud':'구름','funnel':'깔때기','gear6':'톱니바퀴 6개','gear9':'톱니바퀴 9개',
 'arc':'원호','line':'직선','lineInv':'반대 대각선','straightConnector1':'직선 연결선',
 'rightArrow':'오른쪽 화살표','leftArrow':'왼쪽 화살표','upArrow':'위쪽 화살표','downArrow':'아래쪽 화살표','leftRightArrow':'좌우 화살표','upDownArrow':'상하 화살표','quadArrow':'네 방향 화살표','leftRightUpArrow':'좌우 위 화살표','leftUpArrow':'왼쪽 위 화살표',
 'bentArrow':'꺾인 화살표','bentUpArrow':'위로 꺾인 화살표','uturnArrow':'유턴 화살표','curvedRightArrow':'오른쪽 굽은 화살표','curvedLeftArrow':'왼쪽 굽은 화살표','curvedUpArrow':'위쪽 굽은 화살표','curvedDownArrow':'아래쪽 굽은 화살표',
 'stripedRightArrow':'줄무늬 오른쪽 화살표','notchedRightArrow':'홈 있는 오른쪽 화살표','homePlate':'오각형 화살표','chevron':'갈매기형 화살표','circularArrow':'시계 방향 원형 화살표','leftCircularArrow':'반시계 방향 원형 화살표','leftRightCircularArrow':'양방향 원형 화살표','swooshArrow':'휘어진 화살표',
 'irregularSeal1':'폭발 배지 1','irregularSeal2':'폭발 배지 2','ribbon':'리본','ribbon2':'뒤집힌 리본','ellipseRibbon':'둥근 리본','ellipseRibbon2':'뒤집힌 둥근 리본','leftRightRibbon':'양쪽 리본','verticalScroll':'세로 두루마리','horizontalScroll':'가로 두루마리','wave':'물결','doubleWave':'이중 물결',
 'wedgeRectCallout':'사각형 말풍선','wedgeRoundRectCallout':'둥근 사각형 말풍선','wedgeEllipseCallout':'타원 말풍선','cloudCallout':'구름 말풍선','leftArrowCallout':'왼쪽 화살표 설명선','rightArrowCallout':'오른쪽 화살표 설명선','upArrowCallout':'위쪽 화살표 설명선','downArrowCallout':'아래쪽 화살표 설명선','leftRightArrowCallout':'좌우 화살표 설명선','upDownArrowCallout':'상하 화살표 설명선','quadArrowCallout':'네 방향 화살표 설명선',
 'leftBrace':'왼쪽 중괄호','rightBrace':'오른쪽 중괄호','bracePair':'양쪽 중괄호','leftBracket':'왼쪽 대괄호','rightBracket':'오른쪽 대괄호','bracketPair':'양쪽 대괄호','squareTabs':'사각 모서리 탭','plaqueTabs':'명판 모서리 탭','cornerTabs':'모서리 탭',
 'mathPlus':'더하기','mathMinus':'빼기','mathMultiply':'곱하기','mathDivide':'나누기','mathEqual':'같음','mathNotEqual':'같지 않음','chartPlus':'표시 틀 · 더하기','chartStar':'표시 틀 · 별','chartX':'표시 틀 · X',
}
FLOW = {'AlternateProcess':'대체 처리','Collate':'한 부씩 인쇄','Connector':'연결자','Decision':'판단','Delay':'지연','Display':'화면 표시','Document':'문서','Extract':'추출','InputOutput':'입출력','InternalStorage':'내부 저장소','MagneticDisk':'자기 디스크','MagneticDrum':'자기 드럼','MagneticTape':'자기 테이프','ManualInput':'수동 입력','ManualOperation':'수동 처리','Merge':'병합','Multidocument':'여러 문서','OfflineStorage':'오프라인 저장소','OffpageConnector':'다른 페이지 연결','OnlineStorage':'온라인 저장소','Or':'또는','PredefinedProcess':'정의된 처리','Preparation':'준비','Process':'처리','PunchedCard':'천공 카드','PunchedTape':'천공 테이프','Sort':'정렬','SummingJunction':'합류점','Terminator':'시작·끝'}
ACTION = {'BackPrevious':'뒤로·이전','Beginning':'처음','Blank':'빈 버튼','Document':'문서','End':'마지막','ForwardNext':'앞으로·다음','Help':'도움말','Home':'홈','Information':'정보','Movie':'동영상','Return':'돌아가기','Sound':'소리'}
CATEGORIES = [('basic','기본 도형'),('rectangle','사각형'),('arrows','화살표'),('flowchart','순서도'),('stars','별·리본'),('callouts','설명선·말풍선'),('math','수식·기호'),('action','동작 버튼'),('lines','선·괄호')]

def metadata(name):
    category='basic'
    label=LABELS.get(name)
    if name.startswith('flowChart'):
        category='flowchart';label='순서도 · '+FLOW[name[9:]]
    elif name.startswith('actionButton'):
        category='action';label='동작 버튼 · '+ACTION[name[12:]]
    elif name.startswith('math') or name.startswith('chart'):
        category='math'
    elif name.startswith('star'):
        category='stars';label=name[4:]+'각 별'
    elif name in ['rect','roundRect','round1Rect','round2DiagRect','round2SameRect','snip1Rect','snip2DiagRect','snip2SameRect','snipRoundRect']:
        category='rectangle'
    elif 'Callout' in name or 'callout' in name:
        category='callouts'
        if label is None:
            prefix='테두리·강조선 ' if name.startswith('accentBorder') else '강조선 ' if name.startswith('accent') else '테두리 ' if name.startswith('border') else ''
            label=prefix+'꺾은 설명선 '+name[-1]
    elif 'Arrow' in name or name in ['homePlate','chevron']:
        category='arrows'
    elif 'Connector' in name or name in ['arc','line','lineInv','leftBrace','rightBrace','bracePair','leftBracket','rightBracket','bracketPair']:
        category='lines'
        if label is None:label=('곡선 연결선 ' if name.startswith('curved') else '꺾은 연결선 ')+name[-1]
    elif 'Ribbon' in name or 'ribbon' in name or 'Scroll' in name or name in ['irregularSeal1','irregularSeal2','wave','doubleWave']:
        category='stars'
    if not label:raise ValueError('Missing Korean label '+name)
    identifier='rectangle' if name=='rect' else 'right-triangle' if name=='rtTriangle' else re.sub(r'([a-zA-Z])([0-9])',r'\1-\2',re.sub(r'([a-z])([A-Z])',r'\1-\2',name)).lower()
    width,height=(320,220)
    if name in ['rect','ellipse']:width,height=(400,220)
    elif category in ['basic','stars','math','action']:width,height=(240,240)
    elif category=='lines':width,height=(320,180)
    elif name in ['upArrow','downArrow','upDownArrow','bentUpArrow']:width,height=(200,300)
    return {'id':identifier,'label':label,'category':category,'sourcePreset':name,'defaultWidth':width,'defaultHeight':height}

def local(tag):return tag.split('}')[-1]
def compile_node(shape):
    guides=[];paths=[];rect=None;adjustments=[];handles=[]
    for child in shape:
        tag=local(child.tag)
        if tag in ['avLst','gdLst']:
            guides.extend([[g.attrib['name'],g.attrib['fmla'].split()] for g in child])
            if tag=='avLst':adjustments.extend(g.attrib['name'] for g in child)
        elif tag=='ahLst':
            for index,handle in enumerate(child):
                kind=local(handle.tag)
                if kind not in ['ahXY','ahPolar']:raise ValueError('Unknown adjustment handle '+kind)
                position=next(iter(handle))
                handles.append({'id':'handle-'+str(index),'type':'xy' if kind=='ahXY' else 'polar',**dict(handle.attrib),'pos':[position.attrib['x'],position.attrib['y']]})
        elif tag=='rect':rect=[child.attrib[k] for k in ['l','t','r','b']]
        elif tag=='pathLst':
            for p in child:
                commands=[]
                for command in p:
                    name=local(command.tag)
                    if name in ['moveTo','lnTo','quadBezTo','cubicBezTo']:
                        commands.append([{'moveTo':'M','lnTo':'L','quadBezTo':'Q','cubicBezTo':'C'}[name],*[v for pt in command for v in [pt.attrib['x'],pt.attrib['y']]]])
                    elif name=='arcTo':commands.append(['A',*[command.attrib[k] for k in ['wR','hR','stAng','swAng']]])
                    elif name=='close':commands.append(['Z'])
                    else:raise ValueError('Unknown path command '+name)
                paths.append({**{k:v for k,v in p.attrib.items() if k in ['fill','stroke','w','h']},'commands':commands})
    return {'guides':guides,'rect':rect,'paths':paths,'adjustments':adjustments,'handles':handles}

if __name__=='__main__':
    shapes=ET.parse(SOURCE).getroot()
    entries=[(metadata(s.tag),compile_node(s)) for s in shapes]
    rank={name:i for i,(name,_) in enumerate(CATEGORIES)}
    entries.sort(key=lambda item:(rank[item[0]['category']],0 if item[0]['id']=='rectangle' else 1 if item[0]['id']=='ellipse' else 2,item[0]['label']))
    definitions=[meta for meta,data in entries]
    data={meta['id']:geometry for meta,geometry in entries}
    data_json=json.dumps(data,separators=(',',':'),ensure_ascii=False)
    header='''/**
 * DrawingML standard preset geometry, compiled from LibreOffice core.
 * Source commit: 9dea406ab7695df6325b11b0e19fdca8db4b7276.
 * This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See assets/vendor/shapes/LICENSE.txt and original presetShapeDefinitions.xml.
 * Rebuild: python scripts/build-shapes.py. Never evaluate document-supplied formulas.
 */
'''
    output=header+'export const SHAPE_CATEGORIES = Object.freeze('+json.dumps([{'id':a,'label':b} for a,b in CATEGORIES],ensure_ascii=False)+'.map(Object.freeze));\n'
    output+='export const SHAPE_DEFINITIONS = Object.freeze('+json.dumps(definitions,separators=(',',':'),ensure_ascii=False)+'.map(Object.freeze));\n'
    output+='const PRESETS = '+data_json+';\n'+TEMPLATE.read_text(encoding='utf-8')
    OUTPUT.write_text(output,encoding='utf-8',newline='\n')
    print(json.dumps({'shapes':len(definitions),'categories':{name:sum(d['category']==name for d in definitions) for name,_ in CATEGORIES},'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'outputBytes':len(output.encode())}))
