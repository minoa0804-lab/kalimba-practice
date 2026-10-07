const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('./music.js');

test('17-key layout matches the photographed instrument', () => {
  assert.equal(M.keys.length,17);assert.equal(new Set(M.keys.map(k=>k.midi)).size,17);
  assert.equal(M.keys[8].name,'C4');assert.equal(M.keys[0].name,'D6');assert.equal(M.keys[16].name,'E6');
  for(const note of M.song.notes) assert.equal(M.keys[note.lane].name,note.name);
});
test('all 38 measures have 3 beats and span 76 seconds at 90 BPM',()=>{
  assert.equal(M.bars.length,38);
  M.bars.forEach(bar=>assert.equal(bar.reduce((sum,n)=>sum+n[1],0),3));
  assert.equal(M.song.totalBeats,114);assert.equal(M.song.totalBeats*60/M.song.bpm,76);
  assert.equal(Math.min(...M.song.notes.map(n=>n.midi)),60);
  assert.equal(Math.max(...M.song.notes.map(n=>n.midi)),74);
});
test('ties are sustained, with no duplicate strike at the following bar',()=>{
  for(const [beat,duration] of [[18,5],[66,5],[103,4],[108,6]]) {
    const note=M.song.notes.find(n=>n.beat===beat);
    assert.ok(note);assert.equal(note.duration,duration);
    assert.ok(!M.song.notes.some(n=>n.beat>beat&&n.beat<beat+duration));
  }
});
test('rests remain silent, and the following eighth notes retain their offsets',()=>{
  assert.deepEqual(M.song.rests,[{beat:87,duration:1},{beat:93,duration:.5}]);
  assert.ok(!M.song.notes.some(n=>n.beat===87 || n.beat===93));
  assert.equal(M.song.notes.find(n=>n.beat===88).name,'B4');
  assert.equal(M.song.notes.find(n=>n.beat===93.5).name,'C4');
});
test('beat/audio conversions invert at multiple speeds and through count-in',()=>{
  for(const speed of [.25,.5,.75,1,1.25])for(const beat of [-3,0,1.5,38,114]) {
    const time=M.timeAt(beat,-3,7.2,90,speed);
    assert.ok(Math.abs(M.beatAt(-3,7.2,time,90,speed)-beat)<1e-10);
    assert.equal(M.noteY(beat,beat,90,speed,5,40,300),300);
  }
});
test('changing tempo by re-anchoring preserves the current musical position',()=>{
  const before=M.beatAt(12,10,14,90,1);
  assert.equal(before,18);assert.equal(M.beatAt(before,14,14,90,.5),18);
  assert.equal(M.beatAt(before,14,18,90,.5),21);
});
test('loop boundaries include the whole selected ending bar and sanitize input',()=>{
  assert.deepEqual(M.loopRange(1,8),{start:0,end:24,first:1,last:8});
  assert.deepEqual(M.loopRange(38,1),{start:111,end:114,first:38,last:38});
  assert.deepEqual(M.loopRange('',999),{start:0,end:114,first:1,last:38});
});
test('malformed measures and invalid ties are rejected',()=>{
  assert.throws(()=>M.compile([[['G4',2]]]));
  assert.throws(()=>M.compile([[['G4',3,true]]]));
  assert.throws(()=>M.compile([[['F#4',3]]]));
});
