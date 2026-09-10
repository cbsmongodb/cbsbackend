import { sendAsExcel } from "./excel.js";

export function getAll(Model, defaultPopulate = "", searchFields = ["name"]) {
  return async (req, res) => {
    try {
      const { page, limit, search } = req.query;

      function buildFilter() {
        if (!search || !search.trim() || searchFields.length === 0) return {};
        const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escaped, "i");
        return { $or: searchFields.map((field) => ({ [field]: regex })) };
      }

      const filter = buildFilter();

      if (!page && !limit) {
        const docs = await Model.find(filter).populate(defaultPopulate).sort({ createdAt: -1 });
        return res.json(docs);
      }

      const pageNum = Math.max(parseInt(page) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
      const skip = (pageNum - 1) * limitNum;

      const [docs, total] = await Promise.all([
        Model.find(filter).populate(defaultPopulate).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
        Model.countDocuments(filter),
      ]);

      res.json({
        docs,
        total,
        page: pageNum,
        pages: Math.max(Math.ceil(total / limitNum), 1),
        limit: limitNum,
      });
    } catch (err) {
      console.error(`getAll ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function getOne(Model, defaultPopulate = "") {
  return async (req, res) => {
    try {
      const doc = await Model.findById(req.params.id).populate(defaultPopulate);
      if (!doc) return res.status(404).json({ error: `${Model.modelName} not found` });
      res.json(doc);
    } catch (err) {
      console.error(`getOne ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function createOne(Model) {
  return async (req, res) => {
    try {
      const doc = await Model.create(req.body);
      res.status(201).json(doc);
    } catch (err) {
      if (err.name === "ValidationError") {
        const messages = Object.values(err.errors).map((e) => e.message);
        return res.status(400).json({ error: messages.join(", ") });
      }
      console.error(`createOne ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function updateOne(Model) {
  return async (req, res) => {
    try {
      const doc = await Model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!doc) return res.status(404).json({ error: `${Model.modelName} not found` });
      res.json(doc);
    } catch (err) {
      if (err.name === "ValidationError") {
        const messages = Object.values(err.errors).map((e) => e.message);
        return res.status(400).json({ error: messages.join(", ") });
      }
      console.error(`updateOne ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function deleteOne(Model) {
  return async (req, res) => {
    try {
      const doc = await Model.findByIdAndDelete(req.params.id);
      if (!doc) return res.status(404).json({ error: `${Model.modelName} not found` });
      res.json({ success: true });
    } catch (err) {
      console.error(`deleteOne ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function exportExcel(Model, columns, defaultPopulate = "") {
  return async (req, res) => {
    try {
      const docs = await Model.find().populate(defaultPopulate).sort({ createdAt: -1 });
      const rows = docs.map((doc) => doc.toObject());
      await sendAsExcel(res, {
        filename: `${Model.modelName}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        columns,
        rows,
      });
    } catch (err) {
      console.error(`exportExcel ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function crud(Model, defaultPopulate = "", searchFields = ["name"]) {
  return {
    getAll: getAll(Model, defaultPopulate, searchFields),
    getOne: getOne(Model, defaultPopulate),
    createOne: createOne(Model),
    updateOne: updateOne(Model),
    deleteOne: deleteOne(Model),
  };
}
