// Preset ASCII art GIFs, picked from the GIF button beside Send. A message carries only the GIF's id
// (plus a text fallback for older apps), and every app plays it from this list.
// Frames are separated by a line holding just "=". The art is written flush left so the spacing is exact.
const PwcGifs = (() => {
  'use strict';
  const split = s => s.replace(/^\n/, '').replace(/\n$/, '').split('\n=\n');

  // A rocket that sits on the pad, lights up and climbs out of view
  function liftoff() {
    const ship = ['   /\\', '  |  |', '  |  |', ' /|__|\\'], sky = 8, out = [];
    for (let n = 0; n < 14; n++) {
      const top = n < 3 ? sky - 4 : sky - 4 - (n - 2);
      const rows = Array(sky).fill('');
      const put = (y, s) => { if (y >= 0 && y < sky) rows[y] = s; };
      ship.forEach((s, i) => put(top + i, s));
      if (n) { put(top + 4, n % 2 ? '   **' : "   ''"); put(top + 5, n % 2 ? "   ''" : '   ..'); }
      out.push([...rows, n && n < 4 ? '__.**.___' : '_________'].join('\n'));
    }
    return out;
  }
  // Two fish crossing a tank in opposite directions
  function tank() {
    const W = 22, N = 30, out = [];
    const at = (s, x) => (' '.repeat(Math.max(0, x)) + s.slice(Math.max(0, -x))).slice(0, W);
    for (let n = 0; n < N; n++) {
      const big = Math.round(-7 + n * (W + 7) / N), small = Math.round(W - n * (W + 3) / N);
      out.push(['~'.repeat(W), at('><(((o>', big), '', at('<><', small), '_,._.,_.,._,.__,._,_.,'].join('\n'));
    }
    return out;
  }
  // Confetti falling on someone celebrating
  function confetti() {
    const sky = ["  *   .   '  *  .", "  '  *   .   '  *", "  .   '  *   .  '"], arms = ['    \\(^o^)/', '    _(^o^)_'], out = [];
    for (let n = 0; n < 6; n++) out.push([0, 1, 2].map(r => sky[(r - n % 3 + 3) % 3]).concat(arms[n % 2], '      | |').join('\n'));
    return out;
  }

  const list = [
    { id: 'wave', name: 'Wave', ms: 400, frames: split(String.raw`
  o/  hi!
 /|
 / \
=
  o-  hi!
 /|
 / \
`) },
    { id: 'dance', name: 'Dance', ms: 300, frames: split(String.raw`
 \o
  |\
 / \
=
 \o/
  |
 / \
=
  o/
 /|
 / \
=
 \o/
  |
 / >
`) },
    { id: 'cat', name: 'Cat', ms: 500, frames: split(String.raw`
 /\_/\
( o.o )
 > ^ < ~
=
 /\_/\
( o.o )
 > ^ < /
=
 /\_/\
( -.- )
 > ^ < ~
=
 /\_/\
( o.o )
 > ^ < /
`) },
    { id: 'heart', name: 'Heart', ms: 220, frames: split(String.raw`
 /\  /\
/  \/  \
\      /
 \    /
  \  /
   \/
=


  /\/\
  \  /
   \/
=
 /\  /\
/  \/  \
\      /
 \    /
  \  /
   \/
=


  /\/\
  \  /
   \/
=
 /\  /\
/  \/  \
\      /
 \    /
  \  /
   \/
=
 /\  /\
/  \/  \
\      /
 \    /
  \  /
   \/
`) },
    { id: 'coffee', name: 'Coffee', ms: 450, frames: split(String.raw`
   ( (
    ) )
  .......
  |     |]
  \     /
   '---'
=
    ) )
   ( (
  .......
  |     |]
  \     /
   '---'
`) },
    { id: 'thinking', name: 'Thinking', ms: 450, frames: split(String.raw`
 (o_o)
  /|\
=
 (o_o)  .
  /|\
=
 (o_o)  . .
  /|\
=
 (-_-)  . . .
  /|\
`) },
    { id: 'lol', name: 'LOL', ms: 300, frames: split(String.raw`
L   L
  O
=
  O
L   L
`) },
    { id: 'party', name: 'Party', ms: 300, frames: confetti() },
    { id: 'rocket', name: 'Rocket', ms: 220, frames: liftoff() },
    { id: 'fish', name: 'Fish', ms: 160, frames: tank() },
  ];
  // Every frame of a GIF is padded to the same size, so it doesn't jump around while it plays
  for (const g of list) {
    const rows = g.frames.map(f => f.split('\n'));
    const h = Math.max(...rows.map(r => r.length)), w = Math.max(...rows.flat().map(l => l.length));
    g.frames = rows.map(r => Array.from({ length: h }, (_, i) => (r[i] || '').padEnd(w)).join('\n'));
  }
  return { list, byId: Object.fromEntries(list.map(g => [g.id, g])) };
})();
if (typeof module === 'object' && module.exports) module.exports = PwcGifs;
