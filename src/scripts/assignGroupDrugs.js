// Assigns a curated drug list to each Group, by name — so you don't have
// to click through the multiselect in the Groups admin page by hand.
//
// HOW TO USE THIS FOR MORE GROUPS LATER:
//   Just add another entry to GROUP_DRUGS below (group name -> array of
//   drug names, copied exactly as they appear in the Drugs list) and
//   re-run. Already-assigned groups are simply overwritten with the new
//   list you give them — so always list the FULL set of drugs for that
//   group, not just what you're adding.
//
// Usage:
//   node src/scripts/assignGroupDrugs.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Group from "../models/Group.js";
import Drug from "../models/Drug.js";

const GROUP_DRUGS = {
  H3: [
    "livox-500",
    "sweet wash",
    "Vesizim 10",
    "nuroplex forte",
    "Nuroplex B12",
    "KONSTILAC",
    "Calcury",
    "Cranberry",
    "პროსნიქს D / PROSNIX D",
    "Chela-mag b6® mother",
    "gyno-fast",
  ],
  // Add more groups here, e.g.:
  // P1: ["Drug A", "Drug B"],
};

async function run() {
  await connectDB();

  for (const [groupName, drugNames] of Object.entries(GROUP_DRUGS)) {
    const group = await Group.findOne({ name: groupName });
    if (!group) {
      console.log(`Warning: no Group found named "${groupName}" — skipped.`);
      continue;
    }

    const drugIds = [];
    const notFound = [];

    for (const drugName of drugNames) {
      const escaped = drugName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const drug = await Drug.findOne({ name: new RegExp(`^${escaped}$`, "i") });
      if (drug) {
        drugIds.push(drug._id);
      } else {
        notFound.push(drugName);
      }
    }

    if (notFound.length) {
      console.log(`Warning: for group "${groupName}", could not find these drugs by name — skipped them:`);
      notFound.forEach((n) => console.log(`    - ${n}`));
    }

    group.drugs = drugIds;
    await group.save();

    console.log(`${groupName}: assigned ${drugIds.length} drug(s).`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
