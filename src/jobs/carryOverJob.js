import DoctorEntryItem from "../models/DoctorEntryItem.js";

function normalizeToMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function runCarryOverJob() {
  try {
    const now = new Date();
    const thisMonth = normalizeToMonthStart(now);
    const lastMonth = new Date(thisMonth);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const previousItems = await DoctorEntryItem.find({ period: lastMonth });

    let created = 0;
    for (const item of previousItems) {
      const exists = await DoctorEntryItem.findOne({
        employee: item.employee,
        doctor: item.doctor,
        drug: item.drug,
        period: thisMonth,
      });
      if (exists) continue;

      await DoctorEntryItem.create({
        employee: item.employee,
        doctor: item.doctor,
        drug: item.drug,
        hospital: item.hospital,
        period: thisMonth,
        bank: item.bank,
        budget: item.budget,
        quota: 0,
        prescription: 0,
        sale: 0,
      });
      created += 1;
    }

    console.log(`[carryOverJob] created ${created} carried-over entries for ${thisMonth.toISOString().slice(0, 7)}`);
  } catch (err) {
    console.error("[carryOverJob] failed:", err);
  }
}
