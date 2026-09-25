// Minimal test runner shared by the quick test suites (no dependencies).
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { Chess } = require(path.join(ROOT, 'chessjs.js'));
const Evaluation = require(path.join(ROOT, 'evaluation.js'));
const Engine = require(path.join(ROOT, 'engine.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'expected equal') + `: got ${a}, expected ${b}`); }
function done(suite) {
  console.log(`${suite}: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  return { passed, failed };
}

// Deterministic PRNG (mulberry32) so every "random" test is reproducible from its seed.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Play `plies` random legal moves from the start (stops early if the game ends).
function randomPosition(rand, plies) {
  const c = new Chess();
  for (let i = 0; i < plies && !c.isGameOver(); i++) {
    const ms = c.moves();
    c.move(ms[Math.floor(rand() * ms.length)]);
  }
  return c;
}

module.exports = { Chess, Evaluation, Engine, test, assert, eq, done, rng, randomPosition, ROOT };
