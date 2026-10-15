// Fills in map coordinates for hospitals that don't have them yet.
// Slow on purpose (stays under LocationIQ's per-minute limit), safe to stop
// with Ctrl+C and run again — it continues with whatever is still missing.
//   node src/scripts/geocodeHospitals.js
import "dotenv/config";
import axios from "axios";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Hospital from "../models/Hospital.js";

const DELAY_MS = 1300; // ~46 requests per minute
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(q) {
  const res = await axios.get("https://us1.locationiq.com/v1/search", {
    params: { key: process.env.LOCATIONIQ_API_KEY, q, format: "json", limit: 1, countrycodes: "ge" },
    validateStatus: () => true,
  });
  if (res.status === 200 && Array.isArray(res.data) && res.data.length) {
    return { lat: parseFloat(res.data[0].lat), lng: parseFloat(res.data[0].lon) };
  }
  const err = res.data?.error || `HTTP ${res.status}`;
  if (/rate limited day/i.test(err)) throw new Error("DAILY_LIMIT");
  if (/rate limited/i.test(err)) return "RETRY";
  return null;
}

async function run() {
  await connectDB();
  const todo = await Hospital.find({ $or: [{ lat: null }, { lng: null }] }).select("name address");
  console.log(`Hospitals without coordinates: ${todo.length}`);
  let found = 0, notFound = 0;
  for (const [i, h] of todo.entries()) {
    // coordinates already written inside the address
    const m = String(h.address || "").match(/(4[1-3]\.\d{3,})\s*,\s*(4[0-7]\.\d{3,})/);
    if (m) {
      await Hospital.updateOne({ _id: h._id }, { $set: { lat: +m[1], lng: +m[2] } });
      found++;
      continue;
    }
    if (!h.address) { notFound++; continue; }
    let result;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(DELAY_MS);
        result = await lookup(h.address);
        if (result !== "RETRY") break;
        await sleep(60000); // per-minute limit hit: wait a minute
      }
    } catch (e) {
      if (e.message === "DAILY_LIMIT") {
        console.log(`\nDaily limit reached — stopped. Run again tomorrow to continue. Found so far: ${found}`);
        break;
      }
      throw e;
    }
    if (result && result !== "RETRY") {
      await Hospital.updateOne({ _id: h._id }, { $set: { lat: result.lat, lng: result.lng } });
      found++;
    } else {
      notFound++;
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1} / ${todo.length}  (found ${found}, not found ${notFound})`);
  }
  console.log(`\nDONE — coordinates found: ${found}, not found: ${notFound}`);
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
