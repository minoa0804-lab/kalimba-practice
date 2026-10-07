(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KalimbaLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function geometry(width, height) {
    const compact = height < 330;
    const shallow = height < 170;
    const padding = compact ? Math.max(16, width * .025) : Math.max(18, width * .042);
    const laneWidth = (width - padding * 2) / 17;
    const boardBottom = height - (shallow ? 8 : compact ? 12 : 17);
    const boardTop = compact ? boardBottom - (shallow ? 64 : 76) : height * .63 + 24;
    const line = compact ? boardTop - (shallow ? 12 : 18) : height * .63;
    return {padding, laneWidth, top:shallow ? 6 : compact ? 12 : 42, line, boardTop, boardBottom, compact, shallow};
  }
  function keyBounds(lane, width, height) {
    const g = geometry(width, height);
    const labelSpace = g.compact ? 64 : 74;
    const slope = Math.max(0, Math.min(g.shallow ? 0 : g.compact ? 1 : 5, (g.boardBottom - g.boardTop - labelSpace) / 8));
    const x = g.padding + lane * g.laneWidth + g.laneWidth * .15;
    return {x, width:g.laneWidth * .7, top:g.boardTop - 5, bottom:g.boardBottom - 9 - Math.abs(lane - 8) * slope};
  }
  return {geometry, keyBounds};
});
