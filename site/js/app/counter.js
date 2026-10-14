// A count of codes made on this device, kept in local storage, shown in the title bar and the
// status bar. It counts codes that left the page: downloads, copies, shares, prints and batch
// files. Nothing is counted anywhere else.

const KEY = 'qr-count';

function read() {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : 0;
  } catch {
    return 0;
  }
}

function line(n) {
  if (n === 0) return 'NO CODES MADE HERE YET';
  if (n === 1) return '1 CODE MADE HERE. A START.';
  if (n === 13) return '13 CODES MADE HERE. A BAKER’S DOZEN.';
  if (n === 42) return '42 CODES MADE HERE. THE ANSWER.';
  if (n === 100) return '100 CODES MADE HERE. A PRINT SHOP NOW.';
  if (n === 1000) return '1000 CODES MADE HERE. WHO ARE YOU?';
  return `${n} CODES MADE HERE`;
}

export function showCount() {
  const n = read();
  document.getElementById('state-count').textContent = `CODES MADE HERE: ${String(n).padStart(4, '0')}`;
  document.getElementById('count-line').textContent = line(n);
}

export function bumpCount(by = 1) {
  try {
    localStorage.setItem(KEY, String(read() + by));
  } catch {
    // Storage may be unavailable; the count is decoration.
  }
  showCount();
}

export function resetCount() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
  showCount();
}
