(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KalimbaMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const pitches = [86, 83, 79, 76, 72, 69, 65, 62, 60, 64, 67, 71, 74, 77, 81, 84, 88];
  const names = ['D6','B5','G5','E5','C5','A4','F4','D4','C4','E4','G4','B4','D5','F5','A5','C6','E6'];
  const degrees = { C: 1, D: 2, E: 3, F: 4, G: 5, A: 6, B: 7 };
  const solfege = { C: 'ド', D: 'レ', E: 'ミ', F: 'ファ', G: 'ソ', A: 'ラ', B: 'シ' };
  const keys = names.map((name, i) => ({ name, midi: pitches[i], lane: i, degree: degrees[name[0]], dots: Number(name[1]) - 4, solfege: solfege[name[0]] }));
  // Transcribed from the user's supplied "Kalimba Class / Moon River" score.
  // Each entry is [pitch, quarter-note beats, optional tie from previous measure].
  const bars = [
    [['G4',3]],
    [['D5',1],['C5',2]],
    [['B4',1.5],['A4',.5],['G4',.5],['F4',.5]],
    [['G4',2],['C4',1]],
    [['B4',1.5],['A4',.5],['G4',.5],['F4',.5]],
    [['G4',2],['C4',1]],
    [['D4',3]],
    [['D4',2,true],['E4',1]],
    [['C4',3]],
    [['G4',1],['E4',1.5],['D4',.5]],
    [['C4',3]],
    [['G4',1],['E4',1.5],['D4',.5]],
    [['C4',1],['E4',1],['G4',1]],
    [['C5',1],['B4',1.5],['A4',.5]],
    [['B4',1],['A4',1],['G4',1]],
    [['A4',3]],
    [['G4',3]],
    [['D5',1],['C5',2]],
    [['B4',1.5],['A4',.5],['G4',.5],['F4',.5]],
    [['G4',2],['C4',1]],
    [['B4',1.5],['A4',.5],['G4',.5],['F4',.5]],
    [['G4',2],['C4',1]],
    [['D4',3]],
    [['D4',2,true],['E4',1]],
    [['C4',3]],
    [['E4',2],['G4',1]],
    [['C5',3]],
    [['D5',1],['C5',2]],
    [['G4',3]],
    [[null,1],['B4',.5],['A4',.5],['G4',.5],['F4',.5]],
    [['G4',3]],
    [[null,.5],['C4',.5],['B4',.5],['A4',.5],['G4',.5],['F4',.5]],
    [['G4',3]],
    [['C4',3]],
    [['F4',1],['D4',2]],
    [['D4',2,true],['E4',1]],
    [['C4',3]],
    [['C4',3,true]],
  ];
  function compile(measures) {
    const notes = [], rests = [];
    measures.forEach((bar, i) => {
      let offset = 0;
      for (const [name, duration, tie] of bar) {
        if (!(duration > 0)) throw new Error('Invalid note duration');
        const beat = i * 3 + offset;
        if (name === null) rests.push({beat, duration});
        else {
          const key = keys.find(k => k.name === name);
          if (!key) throw new Error('Unsupported pitch: ' + name);
          if (tie) {
            const previous = notes[notes.length - 1];
            if (!previous || previous.name !== name || Math.abs(previous.beat + previous.duration - beat) > 1e-9) throw new Error('Invalid tie');
            previous.duration += duration;
          } else notes.push({...key, beat, duration, measure: i + 1});
        }
        offset += duration;
      }
      if (Math.abs(offset - 3) > 1e-9) throw new Error('Measure ' + (i + 1) + ' must contain 3 beats');
    });
    return {notes, rests, totalBeats: measures.length * 3};
  }
  const song = {title: 'Moon River', composer: 'Henry Mancini', source: 'ご提供の Kalimba Class 楽譜', bpm: 90, beatsPerBar: 3, bars: bars.length, ...compile(bars)};
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  function beatAt(anchorBeat, anchorTime, now, bpm, rate) { return anchorBeat + (now - anchorTime) * bpm * rate / 60; }
  function timeAt(beat, anchorBeat, anchorTime, bpm, rate) { return anchorTime + (beat - anchorBeat) * 60 / (bpm * rate); }
  function noteY(noteBeat, currentBeat, bpm, rate, leadSeconds, top, line) {
    return line - (noteBeat - currentBeat) * 60 / (bpm * rate * leadSeconds) * (line - top);
  }
  function loopRange(start, end) {
    const a = clamp(Math.round(Number(start) || 1), 1, song.bars);
    const b = clamp(Math.round(Number(end) || a), a, song.bars);
    return {start: (a - 1) * 3, end: b * 3, first: a, last: b};
  }
  return {keys, bars, song, compile, clamp, beatAt, timeAt, noteY, loopRange};
});
