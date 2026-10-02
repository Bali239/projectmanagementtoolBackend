import jwt from "jsonwebtoken";

const createAccessToken = (userId) => {
  return jwt.sign(
    {
      userId,
      emailVerified: true,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "15m",
    }
  );
};

export default createAccessToken;