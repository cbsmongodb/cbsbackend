import Hospital from "../models/Hospital.js";
import PlanConfiguration from "../models/PlanConfiguration.js";
import Address from "../models/Address.js";

// Where is each hospital really? Answer from the reps' own GPS at check-in / check-out
// ("I went" / "I left") of completed visits there. One stray point (a rep who checked in
// from the car or from home) must not move a hospital, so we keep only the tight cluster
// around the median and trust it only when most points agree.

const DONE = ["i_went", "i_left", "completed"];
const CLUSTER_M = 400; // points this close to the centre count as "at the hospital"
const MIN_POINTS = 2; // need at least 2 agreeing visits
const MIN_SHARE = 0.5; // and at least half of all points must agree

// Georgia (with a margin): drops 0,0 and broken GPS readings
const inGeorgia = (p) => p.lat > 40.9 && p.lat < 43.8 && p.lng > 39.8 && p.lng < 46.9;

export function distanceM(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const median = (arr) => {
  const v = [...arr].sort((x, y) => x - y);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const center = (pts) => ({ lat: median(pts.map((p) => p.lat)), lng: median(pts.map((p) => p.lng)) });

function suggest(points) {
  const pts = points.filter(inGeorgia);
  if (pts.length < MIN_POINTS) return null;
  const c0 = center(pts);
  const cluster = pts.filter((p) => distanceM(p, c0) <= CLUSTER_M);
  if (cluster.length < MIN_POINTS || cluster.length / pts.length < MIN_SHARE) return null;
  const c = center(cluster);
  return { lat: c.lat, lng: c.lng, points: cluster.length, total: pts.length };
}

// Map<hospitalId, { visits, lastVisit, points: [{lat,lng}] }>
async function repPointsByHospital(hospitalIds) {
  const planFilter = { status: { $in: DONE }, hospital: { $ne: null } };
  if (hospitalIds) planFilter.hospital = { $in: hospitalIds };
  const plans = await PlanConfiguration.find(planFilter).select("hospital period").lean();

  const planToHospital = new Map();
  const stats = new Map();
  for (const p of plans) {
    const key = String(p.hospital);
    planToHospital.set(String(p._id), key);
    const s = stats.get(key) || { visits: 0, lastVisit: null, points: [] };
    s.visits++;
    if (!s.lastVisit || p.period > s.lastVisit) s.lastVisit = p.period;
    stats.set(key, s);
  }
  if (!planToHospital.size) return stats;

  const addrFilter = {
    addressableType: "PlanConfiguration",
    addressType: { $in: ["performer_i_went_location", "performer_i_left_location"] },
    lat: { $ne: null },
    lng: { $ne: null },
  };
  if (hospitalIds) addrFilter.addressableId = { $in: [...planToHospital.keys()] };
  const cursor = Address.find(addrFilter).select("addressableId lat lng").lean().cursor();
  for await (const a of cursor) {
    const key = planToHospital.get(String(a.addressableId));
    if (key) stats.get(key).points.push({ lat: a.lat, lng: a.lng });
  }
  return stats;
}

// Every hospital whose location the reps' GPS can fix:
//   missing   – no location at all
//   displaced – saved pin is more than `minDistance` metres from where the reps actually stand
export async function findRepLocationFixes({ minDistance = 300 } = {}) {
  const [hospitals, stats] = await Promise.all([
    Hospital.find().select("name address region lat lng").populate("region", "name").lean(),
    repPointsByHospital(null),
  ]);

  const missing = [];
  const displaced = [];
  let missingNoData = 0;

  for (const h of hospitals) {
    const s = stats.get(String(h._id));
    const sug = s ? suggest(s.points) : null;
    const hasLoc = h.lat != null && h.lng != null;
    if (!sug) {
      if (!hasLoc) missingNoData++;
      continue;
    }
    const row = {
      _id: h._id,
      name: h.name,
      address: h.address,
      region: h.region?.name || null,
      visits: s.visits,
      lastVisit: s.lastVisit,
      current: hasLoc ? { lat: h.lat, lng: h.lng } : null,
      suggested: sug,
    };
    if (!hasLoc) missing.push(row);
    else {
      row.distance = Math.round(distanceM(row.current, sug));
      if (row.distance > minDistance) displaced.push(row);
    }
  }

  displaced.sort((a, b) => b.distance - a.distance);
  missing.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  return { missing, displaced, missingNoData, minDistance };
}

// Apply the GPS location to the given hospitals (recomputed here — never trusts the browser).
// The old point is kept in prevLocation so the change can be undone.
export async function applyRepLocations(ids) {
  const hospitals = await Hospital.find({ _id: { $in: ids } }).select("name lat lng").lean();
  const stats = await repPointsByHospital(hospitals.map((h) => h._id));
  const ops = [];
  const updated = [];
  for (const h of hospitals) {
    const s = stats.get(String(h._id));
    const sug = s ? suggest(s.points) : null;
    if (!sug) continue;
    ops.push({
      updateOne: {
        filter: { _id: h._id },
        update: {
          $set: {
            lat: sug.lat,
            lng: sug.lng,
            prevLocation: { lat: h.lat ?? null, lng: h.lng ?? null },
            locationSource: "rep_gps",
            locationFixedAt: new Date(),
          },
        },
      },
    });
    updated.push({ _id: h._id, name: h.name });
  }
  if (ops.length) await Hospital.bulkWrite(ops);
  return { updated: updated.length, items: updated };
}

// Put the previous point back (only for hospitals fixed by applyRepLocations)
export async function undoRepLocations(ids) {
  const hospitals = await Hospital.find({ _id: { $in: ids }, locationSource: "rep_gps" })
    .select("prevLocation").lean();
  const ops = hospitals.map((h) => ({
    updateOne: {
      filter: { _id: h._id },
      update: {
        $set: { lat: h.prevLocation?.lat ?? null, lng: h.prevLocation?.lng ?? null },
        $unset: { prevLocation: 1, locationSource: 1, locationFixedAt: 1 },
      },
    },
  }));
  if (ops.length) await Hospital.bulkWrite(ops);
  return { restored: ops.length };
}
