import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestConnectorPort,elementWorldPoint,constrainPoint45,translatedConnector,insertConnectorWaypoint} from '../src/drawing-geometry.js';
import {resolveConnectorGeometry} from '../src/business-model.js';
import {CommandController} from '../src/controller.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
const near=(a,b,epsilon=.001)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<epsilon,JSON.stringify({a,b}));
test('continuous ports attach at the actual clicked coordinate along a rotated rectangle edge',()=>{
  const element={type:'shape',shape:'rectangle',geometry:{x:100,y:80,width:200,height:100},rotation:37},cursor=elementWorldPoint(element,{x:73,y:3}),port=nearestConnectorPort(element,cursor);
  assert.deepEqual(port.position,{x:.365,y:0});near(port.point,elementWorldPoint(element,{x:73,y:0}));assert.equal(port.inside,true);assert.ok(port.distance<3.001);
});
test('ellipse and freeform ports follow their real perimeter instead of the bounding box',()=>{
  const ellipse={type:'shape',shape:'ellipse',geometry:{x:20,y:30,width:240,height:100},rotation:25},port=nearestConnectorPort(ellipse,elementWorldPoint(ellipse,{x:205,y:15}));
  assert.ok(Math.abs(((port.position.x-.5)/.5)**2+((port.position.y-.5)/.5)**2-1)<.00001);assert.ok(port.position.x<1&&port.position.y>0);
  const shape={type:'shape',shape:'freeform',geometry:{x:0,y:0,width:100,height:100},path:{closed:true,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]}};near(nearestConnectorPort(shape,{x:45,y:48}).point,{x:46.5,y:46.5});
});
test('a whole-line translation detaches both ends and offsets every authored route point without source mutation',()=>{
  const connector={from:{elementId:'a',anchor:'custom',position:{x:1,y:.3}},to:{elementId:'b',anchor:'left'},route:'polyline',waypoints:[{x:220,y:90},{x:220,y:260}],control:{x:200,y:160},stroke:{color:'#2563eb',width:3},arrow:'end'},before=structuredClone(connector),resolved={from:{x:100,y:30},to:{x:400,y:260},control:{x:200,y:160}};
  const moved=translatedConnector(connector,resolved,45,-20);assert.deepEqual(moved.from,{point:{x:145,y:10}});assert.deepEqual(moved.to,{point:{x:445,y:240}});assert.deepEqual(moved.waypoints,[{x:265,y:70},{x:265,y:240}]);assert.deepEqual(moved.control,{x:245,y:140});assert.deepEqual(connector,before);
});
test('double-click route conversion inserts a bounded waypoint while preserving attached endpoint identities',()=>{
  const connector={from:{point:{x:10,y:20}},to:{point:{x:410,y:120}},route:'curve',control:{x:170,y:220},stroke:{color:'#2563eb',width:3},arrow:'end'},element={id:'line',type:'connector',connector},slide={elements:[element]},resolved=resolveConnectorGeometry(element,slide),result=insertConnectorWaypoint(connector,resolved,{x:190,y:145});
  assert.equal(result.connector.route,'polyline');assert.ok(result.connector.waypoints.length<=32);assert.deepEqual(result.connector.from,connector.from);assert.deepEqual(result.connector.to,connector.to);assert.ok(result.index>=0);assert.equal(connector.route,'curve');
  const tooMany={...connector,route:'polyline',waypoints:Array.from({length:32},(_,i)=>({x:20+i*10,y:50}))};assert.throws(()=>insertConnectorWaypoint(tooMany,resolveConnectorGeometry({...element,connector:tooMany},slide),{x:150,y:55}),/32/);
});
test('custom ports and waypoint edits remain one Undo and round trip in editable HTML',()=>{
  const c=new CommandController(),a=c.addShape('rectangle'),b=c.addShape('ellipse');c.setGeometry(a,{x:100,y:100,width:160,height:90});c.setGeometry(b,{x:650,y:300,width:180,height:120});const id='pointer-line';c.run('elements.insert',{slideId:c.activeSlideId,assets:[],elements:[{id,type:'connector',geometry:{x:0,y:0,width:1,height:1},connector:{from:{elementId:a,anchor:'custom',position:{x:1,y:.2}},to:{elementId:b,anchor:'custom',position:{x:0,y:.6}},route:'polyline',waypoints:[{x:500,y:118},{x:500,y:372}],stroke:{color:'#2563eb',width:3},arrow:'end'}}]});const before=c.snapshot(),history=c.undoCount,e=c.activeSlide.elements.find(e=>e.id===id),moved=translatedConnector(e.connector,resolveConnectorGeometry(e,c.activeSlide),20,30);c.setConnector(id,moved);assert.equal(c.undoCount,history+1);const after=c.snapshot();assert.deepEqual(parsePresentation(exportPresentation(after)),after);c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);
});
test('Shift constrains free pointer positions to exact 45 degree directions',()=>{
  const origin={x:10,y:20},p=constrainPoint45(origin,{x:100,y:35});assert.equal(p.y,origin.y);const diagonal=constrainPoint45(origin,{x:100,y:100});assert.ok(Math.abs(diagonal.x-origin.x-(diagonal.y-origin.y))<1e-8);
});
