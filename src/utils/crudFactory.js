import { sendAsExcel } from "./excel.js";

// forms send "" for an empty dropdown (e.g. no group head) — for reference
// fields (ObjectId) that is "nothing", not an id; Mongo would fail with a
// CastError ("Server error"). Empty -> null (update) / left out (create).
function cleanRefs(Model, body, forCreate) {
  if (!body || typeof body !== "object") return body;
  const out = { ...body };
  for (const [key, val] of Object.entries(out)) {
    const path = Model.schema.path(key);
    if (!path) continue;
    const isRef = path.instance === "ObjectId";
    const isRefArray = path.instance === "Array" && path.caster?.instance === "ObjectId";
    if (isRef && (val === "" || val === undefined)) {
      if (forCreate) delete out[key];
      else out[key] = null;
    } else if (isRefArray && Array.isArray(val)) {
      out[key] = val.filter((v) => v !== "" && v !== null && v !== undefined);
    }
  }
  return out;
}

// readable message for bad ids instead of "Server error"
function castMessage(err) {
  return `არასწორი მნიშვნელობა ველში "${err.path || "?"}"`;
}

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

      const filter = { ...buildFilter(), ...(req.scopeFilter || {}) };

      // ?lite=1 -> only the name field(s), no populate — for dropdowns
      if (req.query.lite && !page && !limit) {
        const docs = await Model.find(filter).select(searchFields.join(" ")).sort({ createdAt: -1 }).lean();
        return res.json(docs);
      }

      if (!page && !limit) {
        const docs = await Model.find(filter).populate(defaultPopulate).sort({ createdAt: -1 }).lean();
        return res.json(docs);
      }

      const pageNum = Math.max(parseInt(page) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
      const skip = (pageNum - 1) * limitNum;

      const [docs, total] = await Promise.all([
        Model.find(filter).populate(defaultPopulate).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
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
      const doc = await Model.findById(req.params.id).populate(defaultPopulate).lean();
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
      const doc = await Model.create(cleanRefs(Model, req.body, true));
      res.status(201).json(doc);
    } catch (err) {
      if (err.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0];
        return res.status(400).json({ error: `"${err.keyValue?.[field]}" უკვე არსებობს` });
      }
      if (err.name === "ValidationError") {
        const messages = Object.values(err.errors).map((e) => e.message);
        return res.status(400).json({ error: messages.join(", ") });
      }
      if (err.name === "CastError") return res.status(400).json({ error: castMessage(err) });
      console.error(`createOne ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function updateOne(Model) {
  return async (req, res) => {
    try {
      const doc = await Model.findByIdAndUpdate(req.params.id, cleanRefs(Model, req.body, false), {
        new: true,
        runValidators: true,
      });
      if (!doc) return res.status(404).json({ error: `${Model.modelName} not found` });
      res.json(doc);
    } catch (err) {
      if (err.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0];
        return res.status(400).json({ error: `"${err.keyValue?.[field]}" უკვე არსებობს` });
      }
      if (err.name === "ValidationError") {
        const messages = Object.values(err.errors).map((e) => e.message);
        return res.status(400).json({ error: messages.join(", ") });
      }
      if (err.name === "CastError") return res.status(400).json({ error: castMessage(err) });
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
      const rows = await Model.find().populate(defaultPopulate).sort({ createdAt: -1 }).lean();
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
