export function getSingleton(Model) {
  return async (req, res) => {
    try {
      let doc = await Model.findOne();
      if (!doc) doc = await Model.create({});
      res.json(doc);
    } catch (err) {
      console.error(`getSingleton ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function updateSingleton(Model) {
  return async (req, res) => {
    try {
      let doc = await Model.findOne();
      if (!doc) {
        doc = await Model.create(req.body);
      } else {
        Object.assign(doc, req.body);
        await doc.save();
      }
      res.json(doc);
    } catch (err) {
      if (err.name === "ValidationError") {
        const messages = Object.values(err.errors).map((e) => e.message);
        return res.status(400).json({ error: messages.join(", ") });
      }
      console.error(`updateSingleton ${Model.modelName} failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}
