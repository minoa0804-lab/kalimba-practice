const {test}=require('node:test');
const assert=require('node:assert/strict');
const {geometry,keyBounds}=require('./layout.js');

test('all 17 keys stay below the strike line and within short landscape canvases',()=>{
  for(const [width,height] of [[650,131],[550,170],[650,210],[826,260],[896,280],[700,330],[700,390],[1000,420],[350,420],[1200,600]]) {
    const g=geometry(width,height);
    assert.ok(g.line-g.top>=(height<170?40:50),`visible fall distance at ${width} x ${height}`);
    for(let lane=0;lane<17;lane++) {
      const k=keyBounds(lane,width,height);
      assert.ok(k.x>=0 && k.x+k.width<=width);
      assert.ok(k.top>g.line && k.bottom<height);
      assert.ok(k.bottom-k.top>=44,'tine tall enough to tap');
      const labelTop=k.bottom-(g.compact?37:47)-5;
      assert.ok(labelTop>g.boardTop+12,'octave dots clear the metal bracket');
      assert.ok(Math.abs((k.x+k.width/2)-(g.padding+(lane+.5)*g.laneWidth))<1e-8,'marker and key share a center');
    }
  }
});
