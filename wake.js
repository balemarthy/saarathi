// Loose wake-word matcher. Whisper spells the name many ways ("Sarathi",
// "Saarthi", "Sarathy", ...), so compare by edit distance instead of exact text.
const WAKE = 'sarathi';
const MAX_LEADING_WORDS = 3; // the name must be at the start ("Hey Saarathi, ...")

// Spellings whisper actually produced for this user's voice (from calibration).
// Only honoured in the first few words, so ordinary sentences don't trigger.
const ALIASES = new Set([
  'saturday', 'saudi', 'sadehi', 'sadadee', 'sari', 'saredi', 'saradi', 'sardi',
  'sadi', 'sadhi', 'saadhi', 'sarthi', 'sarti', 'sarathy', 'sarathee',
]);
const MAX_RELATIVE_DISTANCE = 0.4; // edit distance / longer word length

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Returns { command } (text after the wake word, possibly empty) or null.
function matchWake(text) {
  const tokens = [];
  const re = /[A-Za-zÀ-ɏ']+/g;
  let m;
  while ((m = re.exec(text)) && tokens.length < MAX_LEADING_WORDS) {
    const word = m[0].normalize('NFD').replace(/[̀-ͯ']/g, '').toLowerCase();
    tokens.push({ word, end: m.index + m[0].length });
  }
  for (let i = 0; i < tokens.length; i++) {
    // Try one word, or two words joined ("sara thi", "sarah tea").
    for (let n = 1; n <= 2 && i + n <= tokens.length; n++) {
      if (n === 2 && tokens[i + 1].word.length > 3) continue; // only a short trailing syllable
      const joined = tokens.slice(i, i + n).map((t) => t.word).join('');
      if (joined.length < 4 || joined.length > 12) continue;
      const isAlias = i <= 1 && ALIASES.has(joined); // aliases: first two words only
      // Core sound of the name: starts with S, and has a T/D sound after an R.
      // This keeps "Sarah", "Sara" and "Karthi" out while allowing whisper's spellings.
      if (!isAlias && !/^s.*r.*[td]/.test(joined)) continue;
      if (isAlias || editDistance(joined, WAKE) / Math.max(joined.length, WAKE.length) <= MAX_RELATIVE_DISTANCE) {
        const command = text.slice(tokens[i + n - 1].end).replace(/^[\s,.:;!?-]+/, '').trim();
        return { command };
      }
    }
  }
  return null;
}

module.exports = { matchWake };
