// Recognises a ready-made payload pasted into the form.

export const READY_MADE = [
  [/^BEGIN:VCARD/i, 'contact card'],
  [/^MECARD:/i, 'contact card'],
  [/^BEGIN:VCALENDAR/i, 'calendar event'],
  [/^mailto:/i, 'email link'],
  [/^(tel|sms|smsto):/i, 'phone link'],
  [/^geo:/i, 'location'],
];

// Splits WIFI:T:..;S:..;P:..;H:..;; into its fields, honouring backslash escapes, or null.
export function parseWifi(text) {
  const body = text.trim();
  if (!/^WIFI:/i.test(body))
    return null;
  const fields = {};
  let key = '';
  let value = '';
  let inValue = false;
  for (let i = 5; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      value += body[++i];
    } else if (c === ';') {
      if (key !== '')
        fields[key.toUpperCase()] = value;
      key = '';
      value = '';
      inValue = false;
    } else if (c === ':' && !inValue) {
      key = value;
      value = '';
      inValue = true;
    } else {
      value += c;
    }
  }
  if (!fields.S)
    return null;
  const kind = (fields.T ?? '').toUpperCase();
  const security = kind === 'WEP' ? 'WEP' : kind === 'NOPASS' || kind === '' ? 'nopass' : 'WPA';
  return { ssid: fields.S, password: fields.P ?? '', security, hidden: (fields.H ?? '').toLowerCase() === 'true' };
}

export function readyMadeKind(text) {
  const match = READY_MADE.find(([pattern]) => pattern.test(text.trim()));
  return match ? match[1] : null;
}
