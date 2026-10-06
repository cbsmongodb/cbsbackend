// Fuzzy matching of drug names from the accountant's stock Excel to the
// drugs in the system. Names rarely match exactly:
//   "ACEFLEX_TH,TAB N10"       -> "Aceflex Th"
//   "DERMOKLIN CREAM 10mg"     -> "Dermoklin Cream"
//   "VASCUBAN 2.5mg"           -> "Vascuban 2.5"  (never "Vascuban 5")
//   "KETZY INJ.N1"             -> not "Ketzy Tab"  (different dosage form)
// Pack sizes (N30, №1) and units (mg, g, ml) are ignored; the brand (first
// word) must agree; strength numbers and dosage forms must not contradict.
// Anything that is not an exact match is returned as guessed=true so the
// person uploading confirms it in the preview.
const norm = (s) => String(s ?? "").toLowerCase().replace(/["'«»„“”]/g, "").replace(/\s+/g, " ").trim();
const compact = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, "");
const UNITS = new Set(["mg", "g", "gr", "ml", "mcg", "iu", "ui", "kg", "l"]);
const FORM_ALIASES = {
  tab: "tab", tabs: "tab", tablet: "tab", tablets: "tab", th: null,
  cap: "caps", caps: "caps", capsule: "caps", capsules: "caps",
  inj: "inj", injection: "inj", amp: "inj", vial: "inj",
  susp: "susp", suspension: "susp", syrup: "syrup", syr: "syrup",
  cream: "cream", gel: "gel", ointment: "ointment", oint: "ointment",
  shampoo: "shampoo", drops: "drops", spray: "spray", wash: "wash",
  strip: "strips", strips: "strips", sachet: "sachet", sachets: "sachet",
};
const IGNORE = new Set(["n", "new", "chew", "x", "pcs", "plus_"]);

function analyze(name) {
  // drop pack sizes: "N30", "N 1", "№1"
  const s = norm(name).replace(/(?:\bn|№)\s*\d+\b/g, " ");
  const raw = s.match(/\d+(?:[.,]\d+)?|\p{L}+/gu) || [];
  const toks = raw.map((t) => t.replace(",", "."));
  const words = [], numbers = new Set(), doses = new Set(), forms = new Set();
  toks.forEach((t, i) => {
    if (/^\d/.test(t)) {
      const next = toks[i + 1];
      if (next && (UNITS.has(next) || next === "%")) doses.add(t);
      else numbers.add(t);
      return;
    }
    if (UNITS.has(t) || IGNORE.has(t)) return;
    if (t in FORM_ALIASES) { if (FORM_ALIASES[t]) forms.add(FORM_ALIASES[t]); return; }
    words.push(t);
  });
  return { words, numbers, doses, forms, compact: compact(name) };
}

function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const m = new Map();
  for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  let inter = 0;
  for (let i = 0; i < b.length - 1; i++) { const g = b.slice(i, i + 2); const c = m.get(g); if (c) { inter++; m.set(g, c - 1); } }
  return (2 * inter) / (a.length + b.length - 2);
}

function score(f, d) {
  if (d.words.length === 0 || f.words.length === 0) return 0;
  // the brand (first word) must agree
  const firstOk = d.words[0] === f.words[0] || f.compact.startsWith(d.words[0]) || d.compact.startsWith(f.words[0]) || dice(d.words[0], f.words[0]) >= 0.8;
  if (!firstOk) return 0;
  const inF = (w) => f.words.includes(w) || (w.length >= 3 && f.compact.includes(w));
  const inD = (w) => d.words.includes(w) || (w.length >= 3 && d.compact.includes(w));
  const dNums = new Set([...d.numbers, ...d.doses]);
  const fNums = new Set([...f.numbers, ...f.doses]);
  const dItems = [...d.words, ...dNums];
  const dHit = d.words.filter(inF).length + [...dNums].filter((n) => fNums.has(n)).length;
  const fItems = [...f.words, ...f.numbers];
  const fHit = f.words.filter(inD).length + [...f.numbers].filter((n) => dNums.has(n)).length;
  let s = 0.55 * (dHit / dItems.length) + 0.25 * (fHit / Math.max(fItems.length, 1)) + 0.2 * dice(f.compact, d.compact);
  // strength numbers must not contradict ("Vascuban 2.5" vs "VASCUBAN 5")
  if ([...dNums].some((n) => !fNums.has(n))) s *= 0.5;
  if (dNums.size > 0 && [...f.numbers].some((n) => !dNums.has(n))) s *= 0.5;
  // dosage forms must not contradict ("Ketzy Tab" vs "KETZY INJ")
  if (d.forms.size && f.forms.size && ![...d.forms].some((x) => f.forms.has(x))) s *= 0.4;
  return s;
}

const MIN_SCORE = 0.75;
export function bestMatch(fileName, drugsA) {
  const f = analyze(fileName);
  let best = null, bestScore = 0;
  for (const d of drugsA) {
    if (d.a.compact === f.compact) return { drug: d.drug, guessed: false, score: 1 };
    const sc = score(f, d.a);
    if (sc > bestScore) { bestScore = sc; best = d.drug; }
  }
  return bestScore >= MIN_SCORE ? { drug: best, guessed: true, score: bestScore } : { drug: null, guessed: false, score: bestScore };
}
export function prepareDrugs(drugs) { return drugs.map((drug) => ({ drug, a: analyze(drug.name) })); }
