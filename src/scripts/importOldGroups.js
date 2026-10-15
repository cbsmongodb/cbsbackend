// Copies each group's PREPARATIONS and MEMBERS from the old CRM into our groups.
// Only ADDS (drugs to Group.drugs, people to Group.members) - never removes anything.
//   node src/scripts/importOldGroups.js           (dry run)
//   node src/scripts/importOldGroups.js --apply   (writes)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Group from "../models/Group.js";
import Employee from "../models/Employee.js";
import Drug from "../models/Drug.js";
import "../models/Section.js";
import { bestMatch, prepareDrugs } from "../utils/drugNameMatch.js";

const APPLY = process.argv.includes("--apply");
const OLD = {
"H3":{"m":["Tamuna Gotciridze","Lana Otarashvili","Nino Basilidze","Nata Javakhishvili","Salome Lomidze"],"d":["livox-500","sweet wash","Vesizim 10","nuroplex forte","Nuroplex B12","KONSTILAC","Calcury","Cranberry","პროსნიქს D / PROSNIX D","Chela-mag b6® mother","gyno-fast"]},
"P3":{"m":["Inga Kuchava","Rusudan Tigishvili","Tamar Alibegashvili","Tamar Gongadze","Mariam Khinveli"],"d":["Tintin","benzoxide gel","Olix ointment 0.03%","agnuskast plus","Zeedoxy","Ipovin forte","Neoprotect","clearwin plus gel","Psoramist Cream","Atomist cream","Dermoklin cream","axytop shampoo 100g","clovex cream","axytop cream 30 g","Olix Ointment 0,01%"]},
"H- REGIONS":{"m":["Maka Osiashvili","Maia Tavdgiridze","Ketevan Kardava","Darejan Buadze","Lika Kikabidze","Ketevan Jalaghonia","Elene Khulordava","Tamar Balabanashvili","Division 3 FOND","Miranda Janjgava"],"d":["Telzisart 40","Telzisart h 80","Dulozim","Citizen-500","zebol-50","rozday 20","amlopril","Zimocard MR","Nuroplex B12","cholekard","citizen plus"]},
"H1":{"m":["Maka Odisharia","Cici Merabishvili","Ana Meskhishvili","Ia Tsitsilashvili","Tamar Maisuradze"],"d":["Telzisart 40","Telzisart h 80","Dulozim","Citizen-500","zebol-50","rozday 20","amlopril","Brainnour","Kalipro","Bifipro","Neuroflavin","cholekard","citizen plus","Tryptosed"]},
"P2":{"m":["Diana Fruidze","Nana Khecuriani","Natalia Archvadze","Nazi Pareshishvili","Megi Tenadze"],"d":["Radofen","Gold l-carnitine","Tranedex tab.","glyzee-m","Mamokast Cream","Ioril","Memor Active","Biflex","Lipoglu","Selezitol","Lipovit-D","Glidap M","Deril","Glidap","VASCUBAN 2.5","VASCUBAN 5"]},
"H2":{"m":["Mari Djaniashvili","Nino Tordia","Liza Gulashvili","Tamar Goderdzishvili","Shorena Papashvili","Khatuna Moseshvili"],"d":["Finevit ODS 2000","Finevit ODS 60000","katrexin","HERBODENT PASTE PREMIUM 50 ML","MineralKalci","SELBIZINC PLUS","Argiqu","Dynapar","Lutein Max Complex","Levcethin ods 5"]},
"M1":{"m":["Sopho Qadjaia","Eliso Lekishvili","Qristine Vekua","Tamar Beriashvili","Tamar Glakhoshvili","Mariam Gelashvili"],"d":["Cefichew 400","V GLIPT 50","Sepin","ketzy injection","Rewive","FIBRASERTA","V GLIPT MET 850","Liveto","Kogneo","V GLIPT MET 1000","Fibraserta","Korvaz","Etricib 90","Omdeca","KONCEPTIN","Bactovag"]},
"M3":{"m":["Tamuna Liparteliani","Lika Ciskarishvili","EKA QUPHARASHVILI","Ia Vakhtangishvili","Tinatin Parckhaladze","Tamta Ezieshvili"],"d":["Potas Mag","Cefzy 1000","potas","LIPOFER FORTE","SONOFITO DROPS","Shelco caps","Inspira","Rebacto","milkden","THYROKOMB","Beoli","Licophyl","Veziton","shelco syrop","Medoxaban 20 mg","ELMAX","Medoxaban 15 klinika","Medoxaban 20 klinika","Kofol sf syrup","gastrochol","Medoxaban 15 mg"]},
"M-REGIONS":{"m":["Rusudan Abzianidze","Maia Sikhashvili","Maia Kartvelishvili","Nino Giorgadze","Cira Bakaradze","Teona Gigashvili","Maia Karalashvili","Marika Kupatadze","Nana Nakaidze","Division 2 FOND","Tamar Natchkebia","Gaiane Iriciani"],"d":["etricib","Shelcal syrup","Cefichew 400","Potas Mag","Cefzy 1000","V GLIPT 50","Sepin","potas","ketzy injection","LIPOFER FORTE","Rewive","SONOFITO DROPS","Inspira","V GLIPT MET 850","Liveto","Rebacto","V GLIPT MET 1000","milkden","THYROKOMB","Beoli","Fibraserta","Korvaz","Etricib 90","Veziton","Medoxaban 20 mg","Omdeca","ELMAX","Kofol sf syrup","gastrochol","Medoxaban 15 mg","Megashelzee","KONCEPTIN","Bactovag"]},
"P1":{"m":["Tea Shubitidze","Ludmila Gagnidze","Lana Kakhidze","Natia Tsulaia","Nana Berianidze"],"d":["Qimoral forte","aceflex injection","CHYMORAL #30","aceflex-th","Vomistop","Menopauzin Forte","Immunofix","Zetroxone SL","Tusturi Herbal","Uro D mann plus","Gastropace","Synalar Otici","Destress"]},
"Test":{"m":["ASHUTOSH RAWAT"],"d":[]},
"M REGIONAL MANAGER":{"m":["Nino Giorgadze","Cira Bakaradze","Teona Gigashvili","Maia Karalashvili","Marika Kupatadze","Gaiane Iriciani"],"d":[]},
"Virt. Regional Manager Division 1":{"m":["Nino Sulakadze","Khatia Djavaxadze","Tamar Saginashvili","Natia Pataridze","Ana Shaverdashvili","Natia Gagua","Melano Kuchava","Tamuna Jinjolava","Imereti PR1","Nino Zhividze","Samegrelo PR3","Kakheti PR1","Achara PR2","Virt. Regional Manager Division 1"],"d":["Qimoral forte","aceflex injection","Tintin","Radofen","benzoxide gel","Olix ointment 0.03%","agnuskast plus","Gold l-carnitine","Tranedex tab.","glyzee-m","Mamokast Cream","Zeedoxy","CHYMORAL #30","Ioril","Ipovin forte","aceflex-th","Vomistop","Memor Active","Biflex","Neoprotect","Lipoglu","clearwin plus gel","Menopauzin Forte","Immunofix","Selezitol","Zetroxone SL","Lipovit-D","Psoramist Cream","Tusturi Herbal","Glidap M","Deril","Atomist cream","Glidap","Dermoklin cream","axytop shampoo 100g","clovex cream","axytop cream 30 g","Gold Carnitine with Chrome N10","Olix Ointment 0,01%","Destress"]},
"P - REGIONS":{"m":["Nino Sulakadze","Khatia Djavaxadze","Tamar Saginashvili","Natia Pataridze","Ana Shaverdashvili","Natia Gagua","Melano Kuchava","Tamuna Jinjolava","Imereti PR1","Nino Zhividze","Samegrelo PR3","Kakheti PR1","Achara PR2","Virt. Regional Manager Division 1","Division 1 FOND"],"d":["Qimoral forte","Tintin","benzoxide gel","Tranedex tab.","Zeedoxy","CHYMORAL #30","Vomistop","clearwin plus gel","Menopauzin Forte","Immunofix","Zetroxone SL","Tusturi Herbal"]},
"DIVISION I FUND":{"m":["Tamuna Jinjolava","Division 1 FOND"],"d":[]},
"DIVISION III FUND":{"m":["Ketevan Jalaghonia","Division 3 FOND"],"d":[]},
"DIVISION II FUND":{"m":["Rusudan Abzianidze","Division 2 FOND"],"d":[]},
"M2":{"m":[],"d":["zito suspension","LIPOFER FORTE","Zito-500","SONOFITO DROPS","Elfero","Shelco caps","Inspira","OFLAB-OZ","Rebacto","milkden","shelco syrop","Kofol sf syrup"]}
};

const norm = (s) => String(s || "").toLowerCase()
  .replace(/x/g, "kh").replace(/w/g, "ts").replace(/q/g, "k").replace(/c/g, "ts").replace(/y/g, "k")
  .replace(/[^a-z\u10d0-\u10ff0-9]/g, "");

async function run() {
  await connectDB();
  console.log(`mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  const groups = await Group.find().populate("section", "name");
  const gMap = new Map(groups.map((g) => [norm(g.name), g]));
  const emps = await Employee.find({}, { firstName: 1, lastName: 1, group: 1 }).lean();
  const eMap = new Map();
  for (const e of emps) {
    eMap.set(norm(`${e.firstName} ${e.lastName}`), e);
    eMap.set(norm(`${e.lastName} ${e.firstName}`), e);
  }
  const drugsA = prepareDrugs(await Drug.find({}, { name: 1 }).lean());
  const missDrug = new Map(), missEmp = new Set(), guessed = new Map(), missGroup = [];
  let addDrugs = 0, addMembers = 0;

  for (const [gName, { m, d }] of Object.entries(OLD)) {
    const g = gMap.get(norm(gName));
    if (!g) { missGroup.push(gName); continue; }
    const drugIds = [];
    for (const name of d) {
      const r = bestMatch(name, drugsA);
      if (!r.drug) { missDrug.set(name, (missDrug.get(name) || []).concat(gName)); continue; }
      if (r.guessed) guessed.set(name, r.drug.name);
      drugIds.push(String(r.drug._id));
    }
    const memberIds = [];
    for (const name of m) {
      const e = eMap.get(norm(name));
      if (!e) { missEmp.add(name); continue; }
      memberIds.push(String(e._id));
    }
    const haveD = new Set((g.drugs || []).map(String));
    const haveM = new Set((g.members || []).map(String));
    const newD = [...new Set(drugIds)].filter((id) => !haveD.has(id));
    const newM = [...new Set(memberIds)].filter((id) => !haveM.has(id));
    addDrugs += newD.length; addMembers += newM.length;
    console.log(`${g.section?.name || "NO DIVISION"} / ${g.name}: +${newD.length} drugs (old CRM ${d.length}), +${newM.length} members (old CRM ${m.length})`);
    if (APPLY && (newD.length || newM.length)) {
      await Group.updateOne({ _id: g._id }, { $addToSet: { drugs: { $each: newD }, members: { $each: newM } } });
    }
  }

  if (missGroup.length) console.log(`\nGroups NOT found in our CRM: ${missGroup.join(", ")}`);
  if (missDrug.size) {
    console.log(`\nDrugs NOT found in our CRM (${missDrug.size}) - add them on the Drugs page, then re-run:`);
    for (const [n, gs] of missDrug) console.log(`  ${n}   [${gs.join(", ")}]`);
  }
  if (guessed.size) {
    console.log(`\nDrugs matched by similar name - check these (${guessed.size}):`);
    for (const [a, b] of guessed) console.log(`  ${a}  =>  ${b}`);
  }
  if (missEmp.size) console.log(`\nPeople NOT found (skipped): ${[...missEmp].join(", ")}`);
  console.log(`\n${APPLY ? "DONE" : "DRY RUN"}: ${addDrugs} drug links, ${addMembers} member links ${APPLY ? "added" : "would be added"}.`);
  await mongoose.disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
