// Plays an audio file on this computer's speakers with the system's own player, without blocking
// (used by actions with "playAfter", e.g. the speak tool reading an AI's reply aloud).
// macOS: afplay (built in). Windows: PowerShell + System.Media.SoundPlayer (built in, WAV).
// Linux: the first of paplay (PulseAudio/PipeWire), pw-play, aplay (ALSA), ffplay that exists.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function onPath(cmd, envPath = process.env.PATH || '') {
  return envPath.split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, cmd)));
}

// Pure: which command plays `file` on `platform`, given has(cmd) -> bool. Returns [cmd, args] or null.
function playerCommand(file, platform = process.platform, has = onPath) {
  if (platform === 'darwin') return ['afplay', [file]];
  if (platform === 'win32') {
    const p = file.replace(/'/g, "''");
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `(New-Object System.Media.SoundPlayer '${p}').PlaySync()`]];
  }
  for (const [cmd, args] of [['paplay', [file]], ['pw-play', [file]], ['aplay', ['-q', file]], ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]]]) {
    if (has(cmd)) return [cmd, args];
  }
  return null;
}

// Starts playback in the background. Resolves { ok, player } or { ok: false, error }.
function playAudio(file, opts = {}) {
  if (!file || !fs.existsSync(file)) return Promise.resolve({ ok: false, error: 'the audio file was not created' });
  const pc = playerCommand(file, opts.platform, opts.has);
  if (!pc) return Promise.resolve({ ok: false, error: 'no audio player found (install pulseaudio-utils or alsa-utils)' });
  return new Promise((resolve) => {
    let done = false;
    try {
      const child = spawn(pc[0], pc[1], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', (e) => { if (!done) { done = true; resolve({ ok: false, error: `${pc[0]}: ${e.message}` }); } });
      child.unref();
      setTimeout(() => { if (!done) { done = true; resolve({ ok: true, player: pc[0] }); } }, 300);
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

module.exports = { playAudio, playerCommand };
