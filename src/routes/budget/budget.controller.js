import Budget from "../../models/Budget.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import Doctor from "../../models/Doctor.js";

const POPULATE = "employee doctor region section group";

// auto-fills region/section/group from the employee's Group —
// mirrors Rails' Budget#update_region_group_section_fields
async function resolveOrgFields(employeeId) {
  const employee = await Employee.findById(employeeId).populate("group");
  if (!employee?.group) return { region: null, section: null, group: null };

  const group = await Group.findById(employee.group).populate("region section");
  return {
    region: group?.region?._id || null,
    section: group?.section?._id || null,
    group: group?._id || null,
  };
}

// GET /api/budgets?employee=&doctor=&from=&to=
export async function getAllBudgets(req, res) {
  try {
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.doctor) filter.doctor = req.query.doctor;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) filter.date.$lte = new Date(req.query.to);
    }

    const budgets = await Budget.find(filter).populate(POPULATE).sort({ date: -1 });
    res.json(budgets);
  } catch (err) {
    console.error("getAllBudgets failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/budgets
export async function createBudget(req, res) {
  try {
    const orgFields = await resolveOrgFields(req.body.employee);
    const budget = await Budget.create({ ...req.body, ...orgFields });

    // Rails also flips doctor.isBudgeted = true on save
    await Doctor.findByIdAndUpdate(req.body.doctor, { isBudgeted: true });

    const populated = await budget.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("createBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateBudget(req, res) {
  try {
    // employee shouldn't normally change on update, but re-resolve org
    // fields in case it does
    const orgFields = req.body.employee ? await resolveOrgFields(req.body.employee) : {};
    const budget = await Budget.findByIdAndUpdate(
      req.params.id,
      { ...req.body, ...orgFields },
      { new: true, runValidators: true }
    ).populate(POPULATE);
    if (!budget) return res.status(404).json({ error: "Budget not found" });
    res.json(budget);
  } catch (err) {
    console.error("updateBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteBudget(req, res) {
  try {
    const budget = await Budget.findByIdAndDelete(req.params.id);
    if (!budget) return res.status(404).json({ error: "Budget not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/budgets/allotment?employee_id=&start_date=&end_date=
// Rails' budget_allotment — per-doctor paid_amount breakdown for one employee
export async function getBudgetAllotment(req, res) {
  try {
    const { employee_id, start_date, end_date } = req.query;
    if (!employee_id) return res.status(400).json({ error: "employee_id is required" });

    const filter = { employee: employee_id };
    if (start_date || end_date) {
      filter.date = {};
      if (start_date) filter.date.$gte = new Date(start_date);
      if (end_date) filter.date.$lte = new Date(end_date);
    }

    const rows = await Budget.aggregate([
      { $match: filter },
      { $group: { _id: "$doctor", paidAmount: { $sum: "$paidAmount" } } },
      {
        $lookup: { from: "doctors", localField: "_id", foreignField: "_id", as: "doctor" },
      },
      { $unwind: { path: "$doctor", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: {
            $ifNull: [
              { $concat: ["$doctor.firstName", " ", "$doctor.lastName"] },
              "Unknown Doctor",
            ],
          },
          value: { $round: ["$paidAmount", 2] },
        },
      },
    ]);

    res.json({ chartData: rows });
  } catch (err) {
    console.error("getBudgetAllotment failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
