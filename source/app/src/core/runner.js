'use strict';
// Spawns a tool and streams its output. No shell is involved, so user input is never interpreted.
const { spawn } = require('child_process');

// Strip ANSI colour/cursor codes and normalise carriage-return progress bars.
function clean(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

// stdin is closed by default: several CLIs (f2, croc) read file lists or data from stdin when it
// is not a terminal, and would wait forever on an open pipe. Pass {stdin: true} only for tools
// that genuinely take input.
// Pass {input: '...'} to send a fixed text on stdin and then close it.
function runTool(exe, argv, { env = {}, cwd, onOutput, onExit, stdin = false, input } = {}) {
  const child = spawn(exe, argv, {
    cwd,
    env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', ...env },
    windowsHide: true,
    stdio: [stdin || input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  const emit = (stream) => (d) => onOutput && onOutput({ stream, text: clean(d.toString()) });
  child.stdout.on('data', emit('stdout'));
  child.stderr.on('data', emit('stderr'));
  child.on('error', (e) => onOutput && onOutput({ stream: 'stderr', text: `Could not start tool: ${e.message}\n` }));
  child.on('close', (code, signal) => onExit && onExit({ code, signal }));
  return {
    pid: child.pid,
    write: (s) => { if (child.stdin) child.stdin.write(s); },
    cancel: () => { try { child.kill(process.platform === 'win32' ? undefined : 'SIGINT'); } catch (_) { /* already gone */ } },
  };
}

module.exports = { runTool, clean };
