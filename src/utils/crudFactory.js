import { sendAsExcel } from "./excel.js";

export function getAll(Model, defaultPopulate = "") {
  return async (req, res) => {
    try {
      const docs = await Model.find().populate(defaultPopulate).sort({ createdAt: -1 });
      res.json(docs);
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

export function crud(Model, defaultPopulate = "") {
  return {
    getAll: getAll(Model, defaultPopulate),
    getOne: getOne(Model, defaultPopulate),
    createOne: createOne(Model),
    updateOne: updateOne(Model),
    deleteOne: deleteOne(Model),
  };
}
