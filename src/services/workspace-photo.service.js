import cloudinary, { assertCloudinaryConfigured } from "../config/cloudinary.js";

export function uploadWorkspacePhoto(buffer) {
  assertCloudinaryConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: "letsdo/workspaces",
      resource_type: "image",
      transformation: [{ width: 800, height: 800, crop: "limit", quality: "auto", fetch_format: "auto" }],
    }, (error, result) => {
      if (error) return reject(error);
      if (!result?.secure_url || !result.public_id) return reject(new Error("Cloudinary returned an incomplete upload result."));
      return resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.end(buffer);
  });
}

export function deleteWorkspacePhoto(publicId) {
  assertCloudinaryConfigured();
  return cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: "image" });
}