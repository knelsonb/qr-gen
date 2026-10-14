// What a reader will do with the payload, and the shapes that are commonly abused. Findings
// are hints for the person making the code; none of them proves a link safe or unsafe.

const SHORTENERS = ['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rb.gy', 'tiny.cc'];
const BLOCKED_SCHEMES = ['javascript', 'data', 'vbscript', 'file'];
const KNOWN_SCHEMES = ['http', 'https', 'mailto', 'tel', 'sms', 'smsto', 'geo', 'bitcoin', 'ethereum'];

function hostScripts(host) {
  const scripts = new Set();
  if (/[a-z]/i.test(host)) scripts.add('Latin');
  if (/[\u0400-\u04ff]/.test(host)) scripts.add('Cyrillic');
  if (/[\u0370-\u03ff]/.test(host)) scripts.add('Greek');
  return scripts;
}

export function inspectUrl(text) {
  const findings = [];
  const scheme = (text.match(/^([a-z][a-z0-9+.-]*):/i) || [])[1]?.toLowerCase();
  if (!scheme)
    return findings;
  if (BLOCKED_SCHEMES.includes(scheme)) {
    findings.push({ level: 'block', text: `A ${scheme}: link runs code or opens a file instead of a web page. Readers refuse these, and so does this page.` });
    return findings;
  }
  if (!KNOWN_SCHEMES.includes(scheme)) {
    findings.push({ level: 'warn', text: `${scheme}: is not a web link. Most phones will show it as text and do nothing with it.` });
    return findings;
  }
  if (scheme !== 'http' && scheme !== 'https')
    return findings;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    findings.push({ level: 'warn', text: 'This does not parse as a web address. Check for spaces or a missing dot.' });
    return findings;
  }
  if (scheme === 'http')
    findings.push({ level: 'warn', text: 'Plain http: pages can be altered on the way to the phone. Use https: if the site has it.' });
  if (parsed.username || parsed.password)
    findings.push({ level: 'warn', text: `The address carries a login before the @ sign, a classic way to make ${parsed.hostname} look like something else.` });
  if (/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) || parsed.hostname.startsWith('['))
    findings.push({ level: 'warn', text: 'The host is a bare IP address. Readers will show it as such, and people are rightly wary of those.' });
  if (parsed.hostname.split('.').some(label => label.startsWith('xn--')))
    findings.push({ level: 'warn', text: `The host ${parsed.hostname} is an internationalised name in its encoded form. Make sure it is the site you mean.` });
  if (hostScripts(parsed.hostname).size > 1)
    findings.push({ level: 'warn', text: 'The host mixes alphabets, which is how look-alike domains are made.' });
  if (SHORTENERS.includes(parsed.hostname.replace(/^www\./, '').replace(/\.$/, '')))
    findings.push({ level: 'info', text: 'A shortener hides the destination until scanned, and stops working if the service does. A direct link is better on print.' });
  if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')
    findings.push({ level: 'warn', text: 'The host has no dot in it, so phones will not treat it as a website.' });
  return findings;
}

// Characters that show as nothing or reorder what follows, replaced by their code point so the
// payload preview shows what is really there.
export function revealControls(text) {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,
    c => `\u2039U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}\u203a`);
}

export function inspect(type, payload) {
  const findings = [];
  if (payload === '')
    return findings;
  if (type === 'url')
    findings.push(...inspectUrl(payload));
  if (type === 'text' && new RegExp(`^(${BLOCKED_SCHEMES.join('|')}):`, 'i').test(payload.trim()))
    findings.push({ level: 'block', text: 'This starts like a script or file link. Readers refuse those, and so does this page.' });
  if (type === 'wifi' && /;P:/.test(payload))
    findings.push({ level: 'info', text: 'The network password is in the code in plain text. Anyone who scans it can join.' });
  if (type === 'contact')
    findings.push({ level: 'info', text: 'Everything in the card is readable by anyone who scans it.' });
  if (/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(payload))
    findings.push({ level: 'warn', text: 'The text contains invisible or direction-changing characters. They are shown below as code points.' });
  const bytes = new TextEncoder().encode(payload).length;
  if (bytes > 1000)
    findings.push({ level: 'warn', text: `${bytes} bytes makes a dense code. Phones need it printed large and flat to read it.` });
  return findings;
}
