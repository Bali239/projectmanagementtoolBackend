import multer from "multer";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(request, file, callback) {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new Error("Choose a JPEG, PNG, WebP, or GIF image."));
      return;
    }
    callback(null, true);
  },
});

export function uploadWorkspacePhoto(request, response, next) {
  upload.single("photo")(request, response, (error) => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      return response.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "Workspace photos must be 5 MB or smaller." : "Only one workspace photo can be uploaded at a time.",
      });
    }
    if (error) return response.status(400).json({ error: error.message });
    return next();
  });
}