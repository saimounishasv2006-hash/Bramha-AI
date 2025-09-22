const jobs = new Map(); // jobId -> {status, steps:[], data:{}}

export const createJob = (jobId) => {
  const job = { status: "queued", steps: [], data: {} };
  jobs.set(jobId, job);
  return job;
};

export const step = (jobId, label, payload = {}) => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.steps.push({ ts: Date.now(), label, payload });
};

export const setStatus = (jobId, status) => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
};

export const setData = (jobId, patch) => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.data = { ...job.data, ...patch };
};

export const getJob = (jobId) => jobs.get(jobId) || null;
