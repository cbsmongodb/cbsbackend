// Search that works the way people type names:
//  - several words, in any order ("inga afk", "afkhazava inga")
//  - Georgian letters find Latin-spelled names ("ინგა აფხ" -> "Inga Afkhazava")
// Every word must be found in at least one of the given fields.
const KA = {
  "ა": "a", "ბ": "b", "გ": "g", "დ": "d", "ე": "e", "ვ": "v", "ზ": "z", "თ": "(t|th)",
  "ი": "i", "კ": "k", "ლ": "l", "მ": "m", "ნ": "n", "ო": "o", "პ": "p", "ჟ": "(zh|j)",
  "რ": "r", "ს": "s", "ტ": "t", "უ": "u", "ფ": "(ph|p|f)", "ქ": "(k|q)", "ღ": "(gh|g)",
  "ყ": "(q|y|k)", "შ": "(sh|s)", "ჩ": "(tch|ch)", "ც": "(ts|c)", "ძ": "(dz|z)",
  "წ": "(ts|w|c|t)", "ჭ": "(tch|ch|w)", "ხ": "(kh|x|h)", "ჯ": "(dj|dzh|j)", "ჰ": "h",
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function wordPattern(word) {
  const plain = esc(word);
  if (!/[ა-ჰ]/.test(word)) return plain;
  const latin = [...word].map((ch) => KA[ch] || esc(ch)).join("");
  return `(${plain}|${latin})`;
}

export function nameSearchFilter(search, fields) {
  const words = String(search || "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return null;
  const and = words.map((w) => {
    const rx = new RegExp(wordPattern(w), "i");
    return { $or: fields.map((f) => ({ [f]: rx })) };
  });
  return and.length === 1 ? and[0] : { $and: and };
}
