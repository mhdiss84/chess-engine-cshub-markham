// Runs the quick correctness suites in order (each is a separate process).
// Long-running validation (self-play, tournament) is run separately:
//   node tests/selfplay.js      node tests/tournament.js
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['rules layer (perft + chess rules)', 'perft.test.js'],
  ['evaluation', 'eval.test.js'],
  ['search (minimax, alpha-beta, iterative deepening)', 'search.test.js'],
  ['UI (jsdom)', 'ui.test.js'],
];

let failed = 0;
for (const [name, file] of SUITES) {
  console.log(`\n### ${name}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nALL QUICK SUITES PASSED');
process.exitCode = failed ? 1 : 0;
