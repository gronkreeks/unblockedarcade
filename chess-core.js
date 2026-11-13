// Chess rules and bot for EduArcade chess.html. No DOM, so it can be tested in Node (perft).
// Board: 10x12 mailbox. Square 21 = a8 … 98 = h1; anything else is off the board.
// Pieces: 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king; positive = white, negative = black.
// Moves are ints: from | to << 7 | promo << 14 | flag << 17 (flag 1 en passant, 2 castle, 4 double push).
(function (root) {
  'use strict';
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6, OFF = 7;
  const WK_C = 1, WQ_C = 2, BK_C = 4, BQ_C = 8;
  const F_EP = 1, F_CASTLE = 2, F_DOUBLE = 4;
  const KNIGHT = [-21, -19, -12, -8, 8, 12, 19, 21], DIAG = [-11, -9, 9, 11], ORTHO = [-10, -1, 1, 10], ALL = DIAG.concat(ORTHO);
  const to120 = new Int8Array(64), to64 = new Int8Array(120).fill(-1);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { to120[r * 8 + f] = 21 + r * 10 + f; to64[21 + r * 10 + f] = r * 8 + f; }
  const FILES = 'abcdefgh';
  const sqName = s => FILES[to64[s] % 8] + (8 - (to64[s] >> 3));
  const sqFrom = name => to120[(8 - +name[1]) * 8 + FILES.indexOf(name[0])];
  const mFrom = m => m & 127, mTo = m => (m >> 7) & 127, mPromo = m => (m >> 14) & 7, mFlag = m => m >> 17;
  const mk = (f, t, pr, fl) => f | t << 7 | (pr || 0) << 14 | (fl || 0) << 17;
  // Castling rights lost when anything moves from or to these squares
  const CASTLE_MASK = new Int8Array(120).fill(15);
  CASTLE_MASK[95] = 15 & ~(WK_C | WQ_C); CASTLE_MASK[98] = 15 & ~WK_C; CASTLE_MASK[91] = 15 & ~WQ_C;
  CASTLE_MASK[25] = 15 & ~(BK_C | BQ_C); CASTLE_MASK[28] = 15 & ~BK_C; CASTLE_MASK[21] = 15 & ~BQ_C;

  // Zobrist keys (32-bit) for repetition checks
  let seed = 0x9e3779b9;
  const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const ZP = []; for (let p = 0; p < 13; p++) { ZP[p] = new Uint32Array(120); for (let s = 0; s < 120; s++) ZP[p][s] = rnd32(); }
  const ZSIDE = rnd32(), ZC = new Uint32Array(16).map(rnd32), ZEP = new Uint32Array(120).map(rnd32);
  const pz = p => p + 6;

  function hashOf(pos) {
    let h = 0;
    for (let i = 0; i < 64; i++) { const s = to120[i], p = pos.b[s]; if (p) h ^= ZP[pz(p)][s]; }
    if (pos.side < 0) h ^= ZSIDE;
    return (h ^ ZC[pos.castle] ^ (pos.ep ? ZEP[pos.ep] : 0)) >>> 0;
  }

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  function fromFEN(fen) {
    const [board, side, castle, ep, half, full] = fen.trim().split(/\s+/);
    const b = new Int8Array(120).fill(OFF);
    for (let i = 0; i < 64; i++) b[to120[i]] = 0;
    let r = 0, f = 0;
    for (const ch of board) {
      if (ch === '/') { r++; f = 0; continue; }
      if (/\d/.test(ch)) { f += +ch; continue; }
      const t = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
      b[to120[r * 8 + f]] = ch === ch.toUpperCase() ? t : -t; f++;
    }
    const pos = { b, side: side === 'b' ? -1 : 1, castle: 0, ep: 0, half: +half || 0, full: +full || 1, kings: [0, 0], stack: [], hist: [] };
    if (castle && castle !== '-') for (const c of castle) pos.castle |= { K: WK_C, Q: WQ_C, k: BK_C, q: BQ_C }[c] || 0;
    if (ep && ep !== '-') pos.ep = sqFrom(ep);
    for (let s = 21; s < 99; s++) { if (b[s] === K) pos.kings[0] = s; if (b[s] === -K) pos.kings[1] = s; }
    pos.hash = hashOf(pos);
    return pos;
  }
  function toFEN(pos) {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let e = 0;
      for (let f = 0; f < 8; f++) {
        const p = pos.b[to120[r * 8 + f]];
        if (!p) { e++; continue; }
        if (e) { out += e; e = 0; }
        const c = ' pnbrqk'[Math.abs(p)]; out += p > 0 ? c.toUpperCase() : c;
      }
      if (e) out += e;
      if (r < 7) out += '/';
    }
    let c = (pos.castle & WK_C ? 'K' : '') + (pos.castle & WQ_C ? 'Q' : '') + (pos.castle & BK_C ? 'k' : '') + (pos.castle & BQ_C ? 'q' : '');
    return `${out} ${pos.side > 0 ? 'w' : 'b'} ${c || '-'} ${pos.ep ? sqName(pos.ep) : '-'} ${pos.half} ${pos.full}`;
  }
  const clone = pos => ({ ...pos, b: pos.b.slice(), kings: pos.kings.slice(), stack: [], hist: pos.hist.slice() });

  // Is square s attacked by side `by` (1 white, -1 black)?
  function attacked(pos, s, by) {
    const b = pos.b;
    // pawns: a white pawn attacks up the board (towards lower indexes)
    if (by > 0) { if (b[s + 9] === P || b[s + 11] === P) return true; }
    else if (b[s - 9] === -P || b[s - 11] === -P) return true;
    for (const d of KNIGHT) if (b[s + d] === N * by) return true;
    for (const d of ALL) if (b[s + d] === K * by) return true;
    for (const d of DIAG) { let t = s + d; while (b[t] === 0) t += d; if (b[t] === B * by || b[t] === Q * by) return true; }
    for (const d of ORTHO) { let t = s + d; while (b[t] === 0) t += d; if (b[t] === R * by || b[t] === Q * by) return true; }
    return false;
  }
  const inCheck = (pos, side) => attacked(pos, pos.kings[side > 0 ? 0 : 1], -side);

  // Pseudo-legal moves (may leave own king in check). capsOnly: captures and promotions only.
  function gen(pos, capsOnly) {
    const b = pos.b, us = pos.side, out = [];
    for (let i = 0; i < 64; i++) {
      const s = to120[i], p = b[s];
      if (!p || (p > 0) !== (us > 0)) continue;
      const t = p * us;
      if (t === P) {
        const fwd = -10 * us, start = us > 0 ? (s >= 81 && s <= 88) : (s >= 31 && s <= 38), last = us > 0 ? s + fwd <= 28 : s + fwd >= 91;
        const add = (to, fl) => { if (last) for (const pr of [Q, N, R, B]) out.push(mk(s, to, pr, fl)); else out.push(mk(s, to, 0, fl)); };
        if (b[s + fwd] === 0) {
          if (!capsOnly || last) add(s + fwd, 0);
          if (!capsOnly && start && b[s + 2 * fwd] === 0) out.push(mk(s, s + 2 * fwd, 0, F_DOUBLE));
        }
        for (const d of [fwd - 1, fwd + 1]) {
          const q = b[s + d];
          if (q !== OFF && q !== 0 && (q > 0) !== (us > 0)) add(s + d, 0);
          else if (s + d === pos.ep && pos.ep) out.push(mk(s, s + d, 0, F_EP));
        }
      } else if (t === N || t === K) {
        for (const d of t === N ? KNIGHT : ALL) {
          const q = b[s + d];
          if (q === OFF || (q && (q > 0) === (us > 0))) continue;
          if (capsOnly && !q) continue;
          out.push(mk(s, s + d));
        }
        if (t === K && !capsOnly) {
          if (us > 0 && s === 95) {
            if ((pos.castle & WK_C) && !b[96] && !b[97] && b[98] === R && !attacked(pos, 95, -1) && !attacked(pos, 96, -1) && !attacked(pos, 97, -1)) out.push(mk(95, 97, 0, F_CASTLE));
            if ((pos.castle & WQ_C) && !b[94] && !b[93] && !b[92] && b[91] === R && !attacked(pos, 95, -1) && !attacked(pos, 94, -1) && !attacked(pos, 93, -1)) out.push(mk(95, 93, 0, F_CASTLE));
          } else if (us < 0 && s === 25) {
            if ((pos.castle & BK_C) && !b[26] && !b[27] && b[28] === -R && !attacked(pos, 25, 1) && !attacked(pos, 26, 1) && !attacked(pos, 27, 1)) out.push(mk(25, 27, 0, F_CASTLE));
            if ((pos.castle & BQ_C) && !b[24] && !b[23] && !b[22] && b[21] === -R && !attacked(pos, 25, 1) && !attacked(pos, 24, 1) && !attacked(pos, 23, 1)) out.push(mk(25, 23, 0, F_CASTLE));
          }
        }
      } else {
        for (const d of t === B ? DIAG : t === R ? ORTHO : ALL) {
          let to = s + d;
          while (b[to] === 0) { if (!capsOnly) out.push(mk(s, to)); to += d; }
          if (b[to] !== OFF && (b[to] > 0) !== (us > 0)) out.push(mk(s, to));
        }
      }
    }
    return out;
  }

  function make(pos, m) {
    const b = pos.b, f = mFrom(m), t = mTo(m), fl = mFlag(m), pr = mPromo(m), p = b[f], us = pos.side;
    let cap = b[t], capSq = t;
    if (fl & F_EP) { capSq = t + 10 * us; cap = b[capSq]; }
    pos.stack.push({ m, cap, castle: pos.castle, ep: pos.ep, half: pos.half, hash: pos.hash });
    pos.hist.push(pos.hash);
    let h = pos.hash ^ ZC[pos.castle] ^ (pos.ep ? ZEP[pos.ep] : 0);
    if (cap) { h ^= ZP[pz(cap)][capSq]; b[capSq] = 0; }
    h ^= ZP[pz(p)][f]; b[f] = 0;
    const np = pr ? pr * us : p;
    b[t] = np; h ^= ZP[pz(np)][t];
    if (fl & F_CASTLE) {
      const [rf, rt] = t === 97 ? [98, 96] : t === 93 ? [91, 94] : t === 27 ? [28, 26] : [21, 24];
      b[rt] = b[rf]; b[rf] = 0; h ^= ZP[pz(R * us)][rf] ^ ZP[pz(R * us)][rt];
    }
    if (p === K) pos.kings[0] = t; else if (p === -K) pos.kings[1] = t;
    pos.castle &= CASTLE_MASK[f] & CASTLE_MASK[t];
    pos.ep = fl & F_DOUBLE ? (f + t) >> 1 : 0;
    pos.half = (Math.abs(p) === P || cap) ? 0 : pos.half + 1;
    if (us < 0) pos.full++;
    pos.side = -us;
    h ^= ZSIDE ^ ZC[pos.castle] ^ (pos.ep ? ZEP[pos.ep] : 0);
    pos.hash = h >>> 0;
  }
  function unmake(pos) {
    const u = pos.stack.pop(); pos.hist.pop();
    const b = pos.b, m = u.m, f = mFrom(m), t = mTo(m), fl = mFlag(m), pr = mPromo(m);
    pos.side = -pos.side;
    const us = pos.side;
    if (us < 0) pos.full--;
    const p = pr ? P * us : b[t];
    b[f] = p; b[t] = 0;
    if (fl & F_EP) b[t + 10 * us] = u.cap; else b[t] = u.cap;
    if (fl & F_CASTLE) {
      const [rf, rt] = t === 97 ? [98, 96] : t === 93 ? [91, 94] : t === 27 ? [28, 26] : [21, 24];
      b[rf] = b[rt]; b[rt] = 0;
    }
    if (p === K) pos.kings[0] = f; else if (p === -K) pos.kings[1] = f;
    pos.castle = u.castle; pos.ep = u.ep; pos.half = u.half; pos.hash = u.hash;
  }
  function legal(pos) {
    const out = [];
    for (const m of gen(pos, false)) { make(pos, m); if (!inCheck(pos, -pos.side)) out.push(m); unmake(pos); }
    return out;
  }
  function perft(pos, d) {
    if (!d) return 1;
    let n = 0;
    for (const m of gen(pos, false)) { make(pos, m); if (!inCheck(pos, -pos.side)) n += perft(pos, d - 1); unmake(pos); }
    return n;
  }

  // ── Game status ──
  function insufficient(pos) {
    const minors = [];
    for (let i = 0; i < 64; i++) {
      const s = to120[i], t = Math.abs(pos.b[s]);
      if (t === P || t === R || t === Q) return false;
      if (t === N || t === B) minors.push({ t, light: ((i >> 3) + i) % 2 === 0 });
    }
    if (minors.length <= 1) return true;
    return minors.every(m => m.t === B) && minors.every(m => m.light === minors[0].light);
  }
  const repeats = pos => { let n = 0; for (let i = pos.hist.length - 2; i >= 0 && i >= pos.hist.length - pos.half - 1; i -= 2) if (pos.hist[i] === pos.hash) n++; return n; };
  // → null while the game goes on, else { result: '1-0' | '0-1' | '1/2-1/2', reason }
  function status(pos) {
    const moves = legal(pos);
    if (!moves.length) return inCheck(pos, pos.side) ? { result: pos.side > 0 ? '0-1' : '1-0', reason: 'checkmate' } : { result: '1/2-1/2', reason: 'stalemate' };
    if (insufficient(pos)) return { result: '1/2-1/2', reason: 'insufficient material' };
    if (pos.half >= 100) return { result: '1/2-1/2', reason: '50-move rule' };
    if (repeats(pos) >= 2) return { result: '1/2-1/2', reason: 'threefold repetition' };
    return null;
  }

  // ── Notation ──
  function san(pos, m) {
    const f = mFrom(m), t = mTo(m), p = Math.abs(pos.b[f]), fl = mFlag(m);
    let s;
    if (fl & F_CASTLE) s = (t === 97 || t === 27) ? 'O-O' : 'O-O-O';
    else {
      const cap = pos.b[t] || (fl & F_EP);
      if (p === P) s = (cap ? FILES[to64[f] % 8] + 'x' : '') + sqName(t) + (mPromo(m) ? '=' + ' PNBRQK'[mPromo(m)] : '');
      else {
        let dis = '';
        const others = legal(pos).filter(o => o !== m && mTo(o) === t && Math.abs(pos.b[mFrom(o)]) === p);
        if (others.length) {
          const sameFile = others.some(o => to64[mFrom(o)] % 8 === to64[f] % 8), sameRank = others.some(o => to64[mFrom(o)] >> 3 === to64[f] >> 3);
          dis = !sameFile ? FILES[to64[f] % 8] : !sameRank ? sqName(f)[1] : sqName(f);
        }
        s = ' PNBRQK'[p] + dis + (cap ? 'x' : '') + sqName(t);
      }
    }
    make(pos, m);
    if (inCheck(pos, pos.side)) s += legal(pos).length ? '+' : '#';
    unmake(pos);
    return s;
  }

  // ── Evaluation (material + piece-square tables, white's view, a8 first) ──
  const VAL = [0, 100, 320, 330, 500, 900, 0];
  const PST = [null,
    [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  ];
  const KING_END = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];
  function evaluate(pos) {   // from the side to move's view
    let score = 0, phase = 0;
    const b = pos.b;
    for (let i = 0; i < 64; i++) { const t = Math.abs(b[to120[i]]); if (t >= N && t <= Q) phase += [0, 0, 1, 1, 2, 4][t]; }
    const end = phase <= 6;
    for (let i = 0; i < 64; i++) {
      const p = b[to120[i]];
      if (!p) continue;
      const t = Math.abs(p), j = p > 0 ? i : (7 - (i >> 3)) * 8 + (i & 7);
      const v = VAL[t] + (t === K && end ? KING_END[j] : PST[t][j]);
      score += p > 0 ? v : -v;
    }
    return score * pos.side;
  }

  // ── Search ──
  const MATE = 100000;
  function orderScore(pos, m) {
    const cap = mFlag(m) & F_EP ? P : Math.abs(pos.b[mTo(m)]);
    return (cap ? 10 * VAL[cap] - VAL[Math.abs(pos.b[mFrom(m)])] + 10000 : 0) + (mPromo(m) ? 9000 : 0);
  }
  function search(pos, depth, alpha, beta, ply, S) {
    if (++S.nodes % 2048 === 0 && Date.now() > S.deadline) S.stop = true;
    if (S.stop) return 0;
    if (ply && (pos.half >= 100 || repeats(pos) >= 1)) return 0;
    const check = inCheck(pos, pos.side);
    if (check) depth++;
    if (depth <= 0) return quiesce(pos, alpha, beta, ply, S);
    const moves = gen(pos, false).sort((x, y) => orderScore(pos, y) - orderScore(pos, x));
    let any = false;
    for (const m of moves) {
      make(pos, m);
      if (inCheck(pos, -pos.side)) { unmake(pos); continue; }
      any = true;
      const v = -search(pos, depth - 1, -beta, -alpha, ply + 1, S);
      unmake(pos);
      if (S.stop) return 0;
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    if (!any) return check ? -MATE + ply : 0;
    return alpha;
  }
  function quiesce(pos, alpha, beta, ply, S) {
    if (++S.nodes % 2048 === 0 && Date.now() > S.deadline) S.stop = true;
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 40) return alpha;
    const moves = gen(pos, true).sort((x, y) => orderScore(pos, y) - orderScore(pos, x));
    for (const m of moves) {
      make(pos, m);
      if (inCheck(pos, -pos.side)) { unmake(pos); continue; }
      const v = -quiesce(pos, -beta, -alpha, ply + 1, S);
      unmake(pos);
      if (S.stop) return alpha;
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }
  // Scores every legal move at the given depth (from the mover's view), deepening until time runs out.
  function scoreMoves(pos, depth, ms) {
    const p = clone(pos), S = { nodes: 0, stop: false, deadline: Date.now() + (ms || 1500) };
    let moves = legal(p).map(m => ({ m, v: 0 })), done = 0;
    for (let d = 1; d <= depth; d++) {
      const next = [];
      for (const x of moves) {
        make(p, x.m);
        const v = -search(p, d - 1, -MATE - 1, MATE + 1, 1, S);
        unmake(p);
        if (S.stop) break;
        next.push({ m: x.m, v });
      }
      if (S.stop) break;
      moves = next.sort((a, b) => b.v - a.v); done = d;
    }
    return { moves, depth: done, nodes: S.nodes };
  }

  // Bot levels, built to play like people: a search depth, plus "noise" (how far off its judgement of
  // each move is, in centipawns) and a blunder chance (sometimes it just plays a plausible worse move
  // that loses up to `margin`). Even the top level keeps a little of both.
  // elo: estimated rating, from 680 games (Nov 2026) against Stockfish 19 at fixed UCI_Elo (1320-2200,
  // 200 ms a move) and against each other. Gold and up are anchored on Stockfish; Stockfish can't play
  // below 1320, so Bronze and Silver are extrapolated from their games against the higher bots.
  const LEVELS = [
    { name: 'Bronze',   depth: 1, noise: 190, blunder: 0.36, margin: 800, elo: 300 },
    { name: 'Silver',   depth: 2, noise: 120, blunder: 0.24, margin: 500, elo: 650 },
    { name: 'Gold',     depth: 2, noise: 65,  blunder: 0.13, margin: 320, elo: 950 },
    { name: 'Platinum', depth: 3, noise: 45,  blunder: 0.09, margin: 250, elo: 1200 },
    { name: 'Diamond',  depth: 3, noise: 28,  blunder: 0.06, margin: 180, elo: 1350 },
    { name: 'Champion', depth: 4, noise: 16,  blunder: 0.035, margin: 130, elo: 1600 },
  ];
  const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  function botMove(pos, level, random) {
    const L = typeof level === 'number' ? LEVELS[level] : level, r = random || Math.random;
    const { moves } = scoreMoves(pos, L.depth, 1800);
    if (moves.length === 1) return moves[0].m;
    const best = moves[0].v;
    // Never throw away a forced mate it has found, and never miss mate in one
    if (best > MATE - 100) return moves[0].m;
    if (r() < L.blunder) {
      const ok = moves.filter(x => x.v < best && x.v >= best - L.margin && x.v > -MATE + 100);
      if (ok.length) return ok[(r() * ok.length) | 0].m;
    }
    let pick = moves[0], top = -Infinity;
    for (const x of moves) { const v = x.v + gauss(r) * L.noise; if (v > top) { top = v; pick = x; } }
    return pick.m;
  }

  const api = Object.freeze({ START, fromFEN, toFEN, clone, legal, make, unmake, inCheck, status, san, perft, botMove, scoreMoves, evaluate, LEVELS,
    sqName, sqFrom, to64, to120, mFrom, mTo, mPromo, mFlag, F_EP, F_CASTLE, F_DOUBLE, P, N, B, R, Q, K });
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ChessCore = api;
})(typeof window !== 'undefined' ? window : this);
