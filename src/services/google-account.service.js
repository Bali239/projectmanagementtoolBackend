import User from "../models/user.model.js";

export async function resolveGoogleAccount(verifiedIdentity) {
  const { sub: googleId, email, name, picture } = verifiedIdentity;
  const normalizedEmail = email.toLowerCase();
  let user = await User.findOne({ googleId });

  if (!user) {
    user = await User.findOne({ email: normalizedEmail });
    if (user?.googleId && user.googleId !== googleId) {
      throw new Error("This email is linked to a different Google account");
    }
    if (!user) user = new User({ email: normalizedEmail });
    user.googleId = googleId;
  }

  user.email = normalizedEmail;
  user.emailVerified = true;
  user.name = name || user.name || normalizedEmail;
  user.picture = picture || user.picture || null;
  await user.save();
  return user;
}