import BudgetRequird from "../../models/BudgetRequird.js";
import BudgetRequest from "../../models/BudgetRequest.js";
import Notification from "../../models/Notification.js";

export async function getAllBudgetRequireds(req, res) {
  try {
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.status) filter.status = req.query.status;

    const requests = await BudgetRequird.find(filter)
      .populate("employee", "firstName lastName")
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    console.error("getAllBudgetRequireds failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getBudgetRequird(req, res) {
  try {
    const request = await BudgetRequird.findById(req.params.id).populate(
      "employee",
      "firstName lastName"
    );
    if (!request) return res.status(404).json({ error: "Not found" });
    res.json(request);
  } catch (err) {
    console.error("getBudgetRequird failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function createBudgetRequird(req, res) {
  try {
    const request = await BudgetRequird.create({
      employee: req.body.employee || req.employee._id,
      items: req.body.items || [],
      status: "pending",
    });
    res.status(201).json(request);
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("createBudgetRequird failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateBudgetRequird(req, res) {
  try {
    const request = await BudgetRequird.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!request) return res.status(404).json({ error: "Not found" });
    res.json(request);
  } catch (err) {
    console.error("updateBudgetRequird failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateBudgetRequirdStatus(req, res) {
  try {
    const { status } = req.body;
    const allowed = ["manager_approved", "manager_rejected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    }

    const request = await BudgetRequird.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!request) return res.status(404).json({ error: "Not found" });

    if (status === "manager_approved") {
      await BudgetRequest.create({
        budgetRequird: request._id,
        divisionManager: req.employee._id,
        financeStatus: "pending",
      });
    }

    await Notification.create({
      employee: request.employee,
      notifiableType: "BudgetRequird",
      notifiableId: request._id,
      message: `The status for your Budget Request has been updated to '${status.replace(
        "_",
        " "
      )}'.`,
    });

    res.json(request);
  } catch (err) {
    console.error("updateBudgetRequirdStatus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getAllBudgetRequests(req, res) {
  try {
    const requests = await BudgetRequest.find()
      .populate({
        path: "budgetRequird",
        populate: { path: "employee", select: "firstName lastName" },
      })
      .populate("divisionManager", "firstName lastName")
      .populate("financeManager", "firstName lastName")
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    console.error("getAllBudgetRequests failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateFinanceStatus(req, res) {
  try {
    const { status, cancelReason } = req.body;
    const allowed = ["finance_approved", "finance_rejected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    }

    const budgetRequest = await BudgetRequest.findByIdAndUpdate(
      req.params.id,
      { financeStatus: status, financeManager: req.employee._id, cancelReason },
      { new: true }
    );
    if (!budgetRequest) return res.status(404).json({ error: "Not found" });

    const budgetRequird = await BudgetRequird.findByIdAndUpdate(
      budgetRequest.budgetRequird,
      { status },
      { new: true }
    );

    if (budgetRequird) {
      await Notification.create({
        employee: budgetRequird.employee,
        notifiableType: "BudgetRequest",
        notifiableId: budgetRequest._id,
        message: `The finance status for your Budget Request has been updated to '${status.replace(
          "_",
          " "
        )}'.`,
      });
    }

    res.json(budgetRequest);
  } catch (err) {
    console.error("updateFinanceStatus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
