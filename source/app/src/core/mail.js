'use strict';
// Email archives (.mbox from Google Takeout/Thunderbird, .eml/.emlx files) → document-index lines
// "file::N<TAB>YYYY-MM-DD<TAB>From … · To … · Subject … ¶ body", read in chunks so multi-GB mboxes fit.
const fs = require('fs');

const decoders = {};
function decodeBytes(buf, charset) {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^(x-|cp)/, (m) => (m === 'cp' ? 'windows-' : ''));
  try { decoders[cs] = decoders[cs] || new TextDecoder(cs); return decoders[cs].decode(buf); } catch (e) { return buf.toString('latin1'); }
}
function qpToBuf(s) {
  const out = []; s = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else out.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}
// RFC 2047 encoded words in headers: =?utf-8?B?...?= / =?iso-8859-1?Q?...?=
function decodeWords(v) {
  return String(v || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    const buf = /b/i.test(enc) ? Buffer.from(txt, 'base64') : qpToBuf(txt.replace(/_/g, ' '));
    return decodeBytes(buf, cs);
  });
}
function parseHeaders(text) {
  const h = {};
  for (const line of text.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(); if (!(k in h)) h[k] = m[2];
  }
  return h;
}
const param = (v, name) => { const m = String(v || '').match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i')); return m ? (m[2] ?? m[1]) : ''; };
const htmlToText = (s) => s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// One raw message (string, latin1-preserving) → { headers, text, attachments }
function parseMessage(raw) {
  const cut = raw.search(/\r?\n\r?\n/);
  const head = cut < 0 ? raw : raw.slice(0, cut); const body = cut < 0 ? '' : raw.slice(cut).replace(/^\r?\n\r?\n/, '');
  const h = parseHeaders(head);
  const texts = []; const html = []; const attachments = [];
  const walk = (hdr, content, depth) => {
    const type = String(hdr['content-type'] || 'text/plain').toLowerCase();
    const name = decodeWords(param(hdr['content-disposition'], 'filename') || param(hdr['content-type'], 'name'));
    if (type.startsWith('multipart/') && depth < 8) {
      const b = param(hdr['content-type'], 'boundary'); if (!b) return;
      const parts = content.split(new RegExp(`\\r?\\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
      for (const part of parts.slice(1)) {
        if (!part.trim()) continue;
        const c = part.search(/\r?\n\r?\n/); const ph = parseHeaders(c < 0 ? part : part.slice(0, c));
        walk(ph, c < 0 ? '' : part.slice(c).replace(/^\r?\n\r?\n/, ''), depth + 1);
      }
      return;
    }
    if (type.startsWith('message/rfc822') && depth < 8) { const inner = parseMessage(content); texts.push(inner.text); return; }
    if (name || /attachment/i.test(hdr['content-disposition'] || '') || !type.startsWith('text/')) { if (name) attachments.push(name); return; }
    const enc = String(hdr['content-transfer-encoding'] || '').toLowerCase();
    const buf = enc === 'base64' ? Buffer.from(content.replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? qpToBuf(content) : Buffer.from(content, 'latin1');
    const t = decodeBytes(buf, param(hdr['content-type'], 'charset'));
    (type.startsWith('text/html') ? html : texts).push(type.startsWith('text/html') ? htmlToText(t) : t);
  };
  walk(h, body, 0);
  const text = (texts.join('\n').trim() || html.join('\n')).replace(/^>.*$/gm, '').replace(/\n{3,}/g, '\n\n');
  return { headers: h, text, attachments };
}

function indexLine(key, raw) {
  const { headers: h, text, attachments } = parseMessage(raw);
  let date = ''; const d = new Date(h.date || ''); if (!isNaN(d)) date = d.toISOString().slice(0, 10);
  const head = [`From: ${decodeWords(h.from)}`, h.to ? `To: ${decodeWords(h.to)}` : '', h.cc ? `Cc: ${decodeWords(h.cc)}` : '', `Subject: ${decodeWords(h.subject)}`, attachments.length ? `Attachments: ${attachments.join(', ')}` : '']
    .filter(Boolean).join(' · ');
  const body = text.replace(/[\t\r]/g, ' ').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ¶ ').slice(0, 8000);
  return `${key}\t${date}\t${head} ¶ ${body}\n`;
}

// Messages of one mbox file, read in 8 MB chunks; calls onMessage(raw) for each.
function eachMboxMessage(file, onMessage) {
  const fd = fs.openSync(file, 'r'); const chunk = Buffer.alloc(8 * 1024 * 1024);
  let rest = ''; let cur = null; let pos = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos); pos += n;
      const text = rest + chunk.toString('latin1', 0, n);
      const lines = text.split('\n'); rest = n ? lines.pop() : '';
      for (const l of n ? lines : lines.concat(rest ? [rest] : [])) {
        if (/^From \S/.test(l) && (cur === null || /^From \S+ .*\d{4}\s*$|^From \S+\s*$|^From - /.test(l) || cur.endsWith('\n\n') || cur.endsWith('\r\n\r\n'))) {
          if (cur !== null) onMessage(cur);
          cur = '';
        } else if (cur !== null) cur += `${l.replace(/^>(>*From )/, '$1')}\n`;
      }
      if (!n) break;
    }
    if (cur) onMessage(cur);
  } finally { fs.closeSync(fd); }
}

// Files → lines to append and a summary (mbox: every message; .eml/.emlx: one message each).
function mailIndex(files, file, left) {
  let write = ''; let msgs = 0; const bad = [];
  const flush = (force) => { if (write.length > 4e6 || (force && write)) { fs.appendFileSync(file, write, 'utf8'); write = ''; } };
  for (const f of files) {
    try {
      if (/\.mbox$|\/mbox$|\\mbox$/i.test(f) || !/\.(eml|emlx)$/i.test(f)) {
        let n = 0; eachMboxMessage(f, (raw) => { n++; write += indexLine(`${f}::${n}`, raw); flush(); });
        msgs += n; if (!n) bad.push(f);
      } else {
        let raw = fs.readFileSync(f).toString('latin1');
        if (/\.emlx$/i.test(f)) raw = raw.replace(/^\d+\s*\r?\n/, '').replace(/<\?xml[\s\S]*$/, '');
        write += indexLine(f, raw); msgs++; flush();
      }
    } catch (e) { bad.push(f); }
  }
  flush(true);
  const summary = [`Indexed ${msgs} email${msgs === 1 ? '' : 's'} from ${files.length - bad.length} file${files.length - bad.length === 1 ? '' : 's'}.`,
    bad.length ? `${bad.length} file(s) had no readable email: ${bad.slice(0, 5).join(', ')}` : null,
    left > 0 ? `${left} more files still to index — run docs_mail again with the same folder and index file to continue.` : 'Every email file in the folder is now in the index.',
    `Index file: ${file}. Use docs_search to find emails (it also searches documents and recordings in the same index) and docs_read with the "file::N" key to read one.`].filter(Boolean).join('\n');
  return { summary };
}

module.exports = { mailIndex, parseMessage, decodeWords, eachMboxMessage };
