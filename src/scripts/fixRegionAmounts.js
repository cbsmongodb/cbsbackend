// One-off fix — seedRegions.js SKIPPED updating any region that already
// existed (e.g. auto-created earlier via a hospital's "+ create" field
// with reimbursementAmt defaulting to 0). This forces the correct
// amount onto every region in the list, whether it already existed or
// not. Safe to re-run.
//
// Usage:
//   node src/scripts/fixRegionAmounts.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Region from "../models/Region.js";

// [name, parentName or "", reimbursementAmt] — same data as seedRegions.js
const ROWS = [
  ["Sachkhere", "Imereti", 20.0], ["Guria", "", 10.0], ["Dusheti-tserovani", "Mtskheta_mtianeti", 15.0],
  ["Ozurgeti", "Guria", 4.0], ["Akhalgori", "Mtskheta_mtianeti", 4.0], ["Telavi", "Kakheti", 4.0],
  ["Marneuli-bolnisi-tsereteli", "Shida_kartli", 30.0], ["Tbilisi-mtskheta", "Mtskheta_mtianeti", 10.0],
  ["Sagarejo-iormunaglo", "Kvemo_kartli", 20.0], ["Martvili", "Samegrelo", 17.0], ["Chkhorotsku", "Samegrelo", 12.0],
  ["Tsalenjikha", "Samegrelo", 10.0], ["Khobi", "Samegrelo", 10.0], ["Lanchkhuti", "Guria", 12.0],
  ["Martvili 1", "Samegrelo", 20.0], ["Chkhorotsku 1", "Samegrelo", 18.0], ["Tsalenjikha 1", "Samegrelo", 22.0],
  ["Khobi 1", "Samegrelo", 10.0], ["Adigeni", "Samtskhe-javakheti", 4.0], ["Akhalqalaqi", "Samtskhe-javakheti", 4.0],
  ["Akhaltsikhe", "Samtskhe-javakheti", 4.0], ["Akhmeta", "Kakheti", 4.0], ["Aspindza", "Samtskhe-javakheti", 4.0],
  ["Baghdati", "Imereti", 4.0], ["Bakuriani", "Shida_kartli", 4.0], ["Batumi", "", 4.0],
  ["Borjomi", "Samtskhe-javakheti", 4.0], ["Chokhatauri", "Guria", 4.0], ["Dedoflistskaro", "Kakheti", 4.0],
  ["Dmanisi", "Kvemo_kartli", 4.0], ["Kazbegi", "Mtskheta_mtianeti", 4.0], ["Keda", "", 4.0],
  ["Gurjaani", "Kakheti", 4.0], ["Kakheti", "", 4.0], ["Kharagauli", "Imereti", 4.0], ["Khelvachauri", "", 4.0],
  ["Khulo", "", 4.0], ["Kvemo_kartli", "", 4.0], ["Lagodekhi", "Kakheti", 4.0], ["Ninotsminda", "", 4.0],
  ["Racha_svaneti", "", 4.0], ["Samtskhe-javakheti", "", 4.0], ["Shida_kartli", "", 4.0], ["Signagi", "Kakheti", 4.0],
  ["Tianeti", "Mtskheta_mtianeti", 4.0], ["Tkibuli", "Imereti", 4.0], ["Vani", "Imereti", 4.0], ["Tbilisi", "", 5.0],
  ["Chiatura", "Imereti", 4.0], ["Kvareli", "Kakheti", 4.0], ["Tetritskaro", "Kvemo_kartli", 4.0],
  ["Rustavi-gardabani", "Shida_kartli", 20.0], ["Sagarejo", "Kakheti", 20.0], ["Kaspi", "Shida_kartli", 20.0],
  ["Sagarejo-sartichala", "Kvemo_kartli", 20.0], ["Tsalka", "Kvemo_kartli", 35.0], ["Rustavi", "Shida_kartli", 15.0],
  ["Kutaisi", "", 4.0], ["Zestafoni", "", 12.0], ["Samtredia", "", 12.0], ["Khoni", "", 14.0], ["Terjola", "", 12.0],
  ["Abasha", "Samegrelo", 14.0], ["Senaki", "Samegrelo", 14.0], ["Bolnisi-marneuli", "Kvemo_kartli", 25.0],
  ["Kareli", "Shida_kartli", 25.0], ["Tbilisi 1", "Shida_kartli", 0.0], ["Samegrelo", "", 20.0],
  ["Zugdidi", "Samegrelo", 4.0], ["Tskaltubo", "", 10.0], ["Poti 1", "Samegrelo", 4.0], ["Poti", "Samegrelo", 4.0],
  ["Khashuri", "Shida_kartli", 30.0], ["Achara", "", 4.0], ["Kobuleti", "", 15.0], ["Tserovani", "Mtskheta_mtianeti", 10.0],
  ["Marneuli", "Kvemo_kartli", 25.0], ["Gori", "Shida_kartli", 25.0], ["Mtskheta", "Mtskheta_mtianeti", 15.0],
  ["Dusheti", "Mtskheta_mtianeti", 15.0], ["Mtskheta_mtianeti", "", 15.0], ["Kaspi -mtskheta", "Kvemo_kartli", 20.0],
  ["Otpusk", "", 0.0], ["Biuletin", "", 0.0], ["Zugdidi - rukhi", "", 12.0], ["Bagdati", "", 8.0],
  ["Senaki martvili", "", 12.0], ["Gardabani", "Kvemo_kartli", 20.0],
];

async function run() {
  await connectDB();

  let updated = 0;
  for (const [name, , amt] of ROWS) {
    const result = await Region.updateOne({ name }, { reimbursementAmt: amt, isActive: true });
    if (result.matchedCount > 0) {
      updated++;
    } else {
      console.log(`  Warning: no region found named "${name}" (not created yet?)`);
    }
  }

  console.log(`\nDone. Updated: ${updated}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
