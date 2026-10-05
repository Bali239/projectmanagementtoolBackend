import mongoose from "mongoose";

const jobLockSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true },
  leaseUntil: { type: Date, required: true },
  completed: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
}, { versionKey: false });

jobLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const JobLock = mongoose.model("JobLock", jobLockSchema);

export default JobLock;