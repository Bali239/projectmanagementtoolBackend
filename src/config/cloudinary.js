import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export class CloudinaryConfigurationError extends Error {
  constructor() {
    super("Workspace photo uploads are not configured. Add the Cloudinary credentials to the backend environment.");
    this.code = "CLOUDINARY_NOT_CONFIGURED";
  }
}

export function assertCloudinaryConfigured() {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new CloudinaryConfigurationError();
  }
}

export default cloudinary;