import mongoose from "mongoose";
import User from "../models/user.model.js";

export const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not set in the environment");
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  const indexes = await User.collection.indexes().catch(() => []);
  const legacyGoogleIdIndex = indexes.find(
    (index) => index.key?.googleId === 1 && index.unique && !index.sparse
  );
  if (legacyGoogleIdIndex) await User.collection.dropIndex(legacyGoogleIdIndex.name);
  await User.init();
  console.log("MongoDB connected");
};


