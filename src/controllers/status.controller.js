import { getJob } from "../services/status.service.js";
export const getStatus = async (req, res) => {
  const { id } = req.params;
  const job = getJob(id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
};
