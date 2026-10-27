// Georgian public holidays (Labour Code, art. 20), incl. the movable Orthodox Easter days.
export function orthodoxEaster(y) {
  const a = y % 4, b = y % 7, c = y % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day + 13)); // Julian -> Gregorian (valid 1900-2099)
}

export function georgianHolidays(y) {
  const fixed = ["01-01", "01-02", "01-07", "01-19", "03-03", "03-08", "04-09", "05-09", "05-12", "05-17", "05-26", "08-28", "10-14", "11-23"];
  const keys = new Set(fixed.map((md) => `${y}-${md}`));
  const easter = orthodoxEaster(y);
  // Good Friday, Holy Saturday, Easter Sunday, Easter Monday
  for (const off of [-2, -1, 0, 1]) keys.add(new Date(easter.getTime() + off * 86400000).toISOString().slice(0, 10));
  return keys;
}
