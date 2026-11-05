// Division 3 drugs (10.2026 list): check names + prices, fix prices, add what is missing.
//   node src/scripts/syncDiv3Drugs.js                    (check only)
//   node src/scripts/syncDiv3Drugs.js --apply            (fix prices + put found drugs into their group)
//   node src/scripts/syncDiv3Drugs.js --apply --create   (also create drugs that are not in the system)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Drug from "../models/Drug.js";
import Group from "../models/Group.js";

const APPLY = process.argv.includes("--apply");
const CREATE = process.argv.includes("--create");
// [group, name in the list, price (NEW PRICE -36%, rounded to tetri), name in the system if different]
const LIST = [
  ["H1", "BIFIPRO", 20.56],
  ["H1", "BRAIN NIUR #30", 34.17, "Brainnour"],
  ["H1", "CHOLEKARD", 28.15],
  ["H1", "CITIZEN PLUS", 39.43],
  ["H1", "DULOZIM- 30", 10.43, "Dulozim"],
  ["H1", "KALIPRO", 24.79],
  ["H1", "NEIROFLAVIN", 31.35, "Neuroflavin"],
  ["H1", "ROZDAY 20", 15.58],
  ["H1", "TELZISART 40 MG", 7.8, "Telzisart 40"],
  ["H1", "TELZISART H 80 MG", 13.62, "Telzisart H 80"],
  ["H1", "TRYPTOSED", 20.5],
  ["H1", "ZEBOL", 11.39, "Zebol 50"],
  ["H1", "ZIMOCARD", 11.84],
  ["H2", "ARGIQU N14 SACHET", 53.59, "Argiqu"],
  ["H2", "GLUBERIN", 37.86],
  ["H2", "DYNAPAR AQ", 5.29, "Dynapar"],
  ["H2", "FINEVIT 2000", 9.86, "Finevit Ods 2000"],
  ["H2", "FINEVIT 60000", 22.34, "Finevit Ods 60000"],
  ["H2", "Herbodent Charcoal Pasta 100 ML", 7.7, "Herbodent Charcoal 100mg"],
  ["H2", "Herbodent Sensitivi Pasta 100 ML", 8.08, "Herbodent Sensitive 100mg"],
  ["H2", "Herbodent Premium Pasta 100 ML", 8.08, "Herbodent Paste Premium 100"],
  ["H2", "Herbodent Premium Pasta 50 ML", 5.04, "Herbodent Paste Premium 50 Ml"],
  ["H2", "Herbodent Natural Pasta 100 ML", 8.08, "Herbodent Paste Natural"],
  ["H2", "KATREXIN", 36.28],
  ["H2", "LEVCETHIN", 5.26, "Levcethin Ods 5"],
  ["H2", "LUTEIN ALFA", 41.47, "Lutein Apha"],
  ["H2", "MINERALKALCI", 24.3],
  ["H2", "SELBICINC PLUS", 24.3, "Selbizinc Plus"],
  ["H2", "SITEME-50", 19.14],
  ["H2", "SITEME - XR", 28.67],
  ["H2", "LUTEIN MAX-COMPLEX", 28.8],
  ["H3", "CALCURY", 22.91],
  ["H3", "CHELA-MAG B6 MAMA #30 KAPS", 24.84, "Chela Mag B6 Mother"],
  ["H3", "CRANBERRY PREMIUM", 22.67, "Cranberry"],
  ["H3", "FLOXSAFE 400", 20.8],
  ["H3", "GYNO-FAST", 29.31],
  ["H3", "KONSTILAC", 13.45],
  ["H3", "NUROPLEX B12", 24.84],
  ["H3", "NUROPLEX FORTE", 24.84],
  ["H3", "PROSNIX D", 22.2, "Prosnix D"],
  ["H3", "SWEET WASH 200 ML", 15.73, "Sweet Wash"],
  ["H3", "VESIZIM", 11.61, "Vesizim 10"],
  ["H3", "VAGINOVA", 31.23],
  ["H3", "LIVOX #5", 12.08, "Livox 500"],
];
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

await connectDB();
const drugs = await Drug.find({}).select("name price productType isActive").lean();
const byNorm = new Map();
drugs.forEach((d) => byNorm.set(norm(d.name), d));
const groups = await Group.find({ name: { $in: ["H1", "H2", "H3"] } }).lean();
const G = new Map(groups.map((g) => [g.name, g]));
for (const n of ["H1", "H2", "H3"]) if (!G.has(n)) console.log(`⚠️ group ${n} not found`);

let same = 0, priced = 0, missing = 0, added = 0;
const createList = [];
const findDrug = (name, alias) => {
  if (alias) {
    const a = norm(alias);
    return byNorm.get(a) || drugs.find((x) => norm(x.name).endsWith(a) || norm(x.name) === a);
  }
  return byNorm.get(norm(name));
};
for (const [gName, name, price, alias] of LIST) {
  const g = G.get(gName);
  const d = findDrug(name, alias);
  if (!d) {
    missing++;
    const key = norm(name).slice(0, 5);
    const near = drugs.filter((x) => norm(x.name).startsWith(key)).map((x) => x.name);
    console.log(`❌ ${gName} ${name} (${price}) - არ არის სისტემაში${near.length ? `  | მსგავსი: ${near.join(", ")}` : ""}`);
    createList.push({ gName, name, price });
    continue;
  }
  const inGroup = g && (g.drugs || []).some((x) => String(x) === String(d._id));
  const notes = [];
  if (Number(d.price) !== price) notes.push(`ფასი ${d.price} -> ${price}`);
  if (!inGroup) notes.push(`${gName}-ს მიება`);
  if (!d.isActive) notes.push("გააქტიურდება");
  if (!notes.length) { same++; console.log(`✅ ${gName} ${d.name} - ${price} (სწორია)`); continue; }
  priced++;
  console.log(`💲 ${gName} ${d.name}${alias ? ` (სიაში: ${name})` : ""} - ${notes.join(", ")}`);
  if (APPLY) {
    await Drug.updateOne({ _id: d._id }, { $set: { price, isActive: true } });
    if (g && !inGroup) await Group.updateOne({ _id: g._id }, { $addToSet: { drugs: d._id } });
  }
}
// drugs in H1-H3 that are not in the list
const listed = new Set(LIST.map(([, n, , a]) => norm(n)));
LIST.forEach(([, n, , a]) => { const d = findDrug(n, a); if (d) listed.add(norm(d.name)); });
const extra = [];
for (const g of groups) {
  for (const id of g.drugs || []) {
    const d = drugs.find((x) => String(x._id) === String(id));
    if (d && !listed.has(norm(d.name))) extra.push(`${g.name} ${d.name} (${d.price})`);
  }
}
if (extra.length) {
  console.log("\nჯგუფებში არის, სიაში არ არის (არაფერი შეიცვლება):");
  extra.forEach((x) => console.log(`   · ${x}`));
}
if (APPLY && CREATE && createList.length) {
  // product type: the one most drugs of these groups use
  const count = new Map();
  groups.flatMap((g) => g.drugs || []).forEach((id) => {
    const d = drugs.find((x) => String(x._id) === String(id));
    if (d?.productType) count.set(String(d.productType), (count.get(String(d.productType)) || 0) + 1);
  });
  const pt = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || drugs.find((x) => x.productType)?.productType;
  for (const c of createList) {
    const d = await Drug.create({ name: c.name, price: c.price, productType: pt, isActive: true });
    const g = G.get(c.gName);
    if (g) await Group.updateOne({ _id: g._id }, { $addToSet: { drugs: d._id } });
    added++;
    console.log(`➕ შეიქმნა: ${c.gName} ${c.name} - ${c.price}`);
  }
}
console.log(`\nსწორია: ${same}, შესასწორებელი: ${priced}, სისტემაში არ არის: ${missing}${added ? `, დაემატა: ${added}` : ""}`);
if (!APPLY) console.log("შეამოწმე და გაუშვი --apply (ფასები) / --apply --create (ახლების დამატებაც)");
await mongoose.disconnect();
