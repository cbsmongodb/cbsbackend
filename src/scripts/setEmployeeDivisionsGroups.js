// One-off script — assigns each employee to their real Division and
// Group, based on the "Staff List By Divisions" spreadsheet. Matches by
// each employee's official (already-in-database) email. Division
// managers / product managers get a division but no group (they're not
// inside a numbered group). Safe to re-run — always overwrites with the
// values below.
//
// Usage:
//   node src/scripts/setEmployeeDivisionsGroups.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Division from "../models/Division.js";

// [email, divisionName, groupNameOrNull]
const ROWS = [
  // Division 1 — managers (no group)
  ["tamunajinjolava@yahoo.com", "Division 1", null],
  ["tchkaduatamuna@gmail.com", "Division 1", null],
  // Division 1 / P1
  ["nanberianidze@gmail.com", "Division 1", "P1"],
  ["natushkiculaia@mail.ru", "Division 1", "P1"],
  ["milagagnidze@mail.ru", "Division 1", "P1"],
  ["l.kakhidze@cbs.ge", "Division 1", "P1"],
  ["t.shubitidze@cbs.ge", "Division 1", "P1"],
  // Division 1 / P2
  ["m.tenadze@cbs.ge", "Division 1", "P2"],
  ["nana.xecuriani@inbox.ru", "Division 1", "P2"],
  ["pruidzediko@gmail.com", "Division 1", "P2"],
  ["n.archvadze@cbs.ge", "Division 1", "P2"],
  ["n.phareshishvili@gmail.com", "Division 1", "P2"],
  // Division 1 / P3
  ["t.gongadze@mail.ru", "Division 1", "P3"],
  ["ingakuchava@gmail.com", "Division 1", "P3"],
  ["mkhinveli@mail.ru", "Division 1", "P3"],
  ["tatalibegashvili@gmail.com", "Division 1", "P3"],
  ["r.tigishvili@cbs.ge", "Division 1", "P3"],
  // Division 1 / regions (P4/P5 R) -> P - REGIONS
  ["a.shaverdashvili@cbs.ge", "Division 1", "P - REGIONS"],
  ["m.kuchava@cbs.ge", "Division 1", "P - REGIONS"],
  ["kh.djavakhadze@cbs.ge", "Division 1", "P - REGIONS"],
  ["n.gagua@cbs.ge", "Division 1", "P - REGIONS"],
  ["n.zhividze@cbs.ge", "Division 1", "P - REGIONS"],
  ["tamuna.saguinashvili@mail.ru", "Division 1", "P - REGIONS"],
  ["n.sulakadze@cbs.ge", "Division 1", "P - REGIONS"],
  ["n.pataridze@cbs.ge", "Division 1", "P - REGIONS"],

  // Division 2 — manager (no group)
  ["rusa_2004@mail.ru", "Division 2", null],
  // Division 2 / M1
  ["sofo.qajaia82@mail.ru", "Division 2", "M1"],
  ["takoberiashvili@mail.ru", "Division 2", "M1"],
  ["e.lekishvili@cbs.ge", "Division 2", "M1"],
  ["mariko@europe.com", "Division 2", "M1"],
  ["vekua_kristine@gmail.com", "Division 2", "M1"],
  ["tamarglakhoshvili@gmail.com", "Division 2", "M1"],
  // Division 2 / M2
  ["tamuna.tamuna79@yahoo.com", "Division 2", "M2"],
  ["tamtaezieshvili53@gmail.com", "Division 2", "M2"],
  ["tinatini_parcxaladze@yahoo.com", "Division 2", "M2"],
  ["l.ciskarishvili@cbs.ge", "Division 2", "M2"],
  ["e.qupharashvili@cbs.ge", "Division 2", "M2"],
  ["i.vakhtangishvili@cbs.ge", "Division 2", "M2"],
  // Division 2 / regional manager + regions
  ["nana_nakaidze@mail.ru", "Division 2", "M REGIONAL MANAGER"],
  ["maia.kartvelishvili1@gmail.com", "Division 2", "M-REGIONS"],
  ["m.sikhashvili@cbs.ge", "Division 2", "M-REGIONS"],
  ["n.giorgadze@cbs.ge", "Division 2", "M-REGIONS"],
  ["t.gigashvili@cbs.ge", "Division 2", "M-REGIONS"],
  ["m.kupatadze@cbs.ge", "Division 2", "M-REGIONS"],
  ["m.karalashvili@cbs.ge", "Division 2", "M-REGIONS"],

  // Division 3 — managers (no group)
  ["kjalaghonia@yahoo.com", "Division 3", null],
  ["natiabadridze@gmail.com", "Division 3", null],
  // Division 3 / H1
  ["cici.merabishvili@mail.ru", "Division 3", "H1"],
  ["tsitsila@mail.ru", "Division 3", "H1"],
  ["makaodisharia91@gmail.com", "Division 3", "H1"],
  ["ana.mesxishvili.89@gmail.com", "Division 3", "H1"],
  ["t.maisuradze@cbs.ge", "Division 3", "H1"],
  // Division 3 / H2
  ["gulashvililizi@gmail.com", "Division 3", "H2"],
  ["janiashvili_m@mail.ru", "Division 3", "H2"],
  ["tordia-84@mail.ru", "Division 3", "H2"],
  ["shorena_papashvili@mail.ru", "Division 3", "H2"],
  ["t.goderdzishvili@cbs.ge", "Division 3", "H2"],
  ["xato.mose@mail.ru", "Division 3", "H2"],
  // Division 3 / H3
  ["gotciridzetamuna@mail.ru", "Division 3", "H3"],
  ["lana.otarashvili@mail.ru", "Division 3", "H3"],
  ["n.basilidze@cbs.ge", "Division 3", "H3"],
  ["nata.javakhishvili@yahoo.com", "Division 3", "H3"],
  ["t.tessa2021@gmail.com", "Division 3", "H3"],
  // Division 3 / regions
  ["k.kardava@cbs.ge", "Division 3", "H- REGIONS"],
  ["darejanbuadze@gmail.com", "Division 3", "H- REGIONS"],
  ["kikanini09@gmail.com", "Division 3", "H- REGIONS"],
  ["m.osiashvili@cbs.ge", "Division 3", "H- REGIONS"],
  ["maia.tavdgiridze85@gmail.com", "Division 3", "H- REGIONS"],
  ["e.khulordava@cbs.ge", "Division 3", "H- REGIONS"],
  ["t.balabanashvili@cbs.ge", "Division 3", "H- REGIONS"],
];

async function run() {
  await connectDB();

  const divisionCache = new Map();
  const groupCache = new Map();
  let updated = 0;
  let notFoundEmployee = 0;
  let notFoundDivision = 0;
  let notFoundGroup = 0;

  for (const [email, divisionName, groupName] of ROWS) {
    const employee = await Employee.findOne({ email: email.toLowerCase() });
    if (!employee) {
      console.log(`  Warning: no employee found for ${email}`);
      notFoundEmployee++;
      continue;
    }

    let divisionId = divisionCache.get(divisionName);
    if (!divisionId) {
      const division = await Division.findOne({ name: divisionName });
      if (!division) {
        console.log(`  Warning: no division found named "${divisionName}"`);
        notFoundDivision++;
        continue;
      }
      divisionId = division._id;
      divisionCache.set(divisionName, divisionId);
    }

    let groupId = null;
    if (groupName) {
      groupId = groupCache.get(groupName);
      if (!groupId) {
        const group = await Group.findOne({ name: groupName });
        if (!group) {
          console.log(`  Warning: no group found named "${groupName}" (for ${email})`);
          notFoundGroup++;
        } else {
          groupId = group._id;
          groupCache.set(groupName, groupId);
        }
      }
    }

    employee.division = divisionId;
    if (groupId) employee.group = groupId;
    await employee.save();
    updated++;
    console.log(`Updated: ${employee.firstName} ${employee.lastName} -> ${divisionName}${groupName ? " / " + groupName : ""}`);
  }

  console.log(`\nDone. Updated: ${updated}, employee not found: ${notFoundEmployee}, division not found: ${notFoundDivision}, group not found: ${notFoundGroup}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
