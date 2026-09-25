// Runs game jobs across a pool of worker threads; resolves with all results.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Worker } = require('worker_threads');

function runJobs(jobs, { workers, onResult } = {}) {
  const n = Math.max(1, Math.min(workers || os.cpus().length - 2, jobs.length));
  return new Promise((resolve, reject) => {
    const results = [];
    let next = 0, active = 0;
    const pool = [];
    function feed(w) {
      if (next >= jobs.length) {
        w.terminate();
        if (--active === 0) resolve(results.sort((a, b) => a.id - b.id));
        return;
      }
      w.postMessage(jobs[next++]);
    }
    for (let i = 0; i < n; i++) {
      const w = new Worker(path.join(__dirname, 'game-worker.js'));
      active++;
      w.on('message', r => { results.push(r); if (onResult) onResult(r, results.length, jobs.length); feed(w); });
      w.on('error', reject);
      pool.push(w);
      feed(w);
    }
  });
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function saveResults(file, data) {
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 1));
  return p;
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

module.exports = { runJobs, arg, saveResults, fmtDuration };
