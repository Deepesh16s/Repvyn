const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isTokenCurrent } = require("../utils/authToken");

const SAFE_USER_FIELDS = "-password -resetPasswordToken -resetPasswordExpires";

function readBearerToken(req) {
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    return req.headers.authorization.split(" ")[1];
  }
  return undefined;
}

exports.protect = async (req, res, next) => {
  try {
    const token = readBearerToken(req);

    if (!token) {
      return res.status(401).json({
        message: "Not authorized, no token",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select(SAFE_USER_FIELDS);

    if (!user || !isTokenCurrent(decoded, user)) {
      return res.status(401).json({
        message: "Not authorized",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name !== "JsonWebTokenError" && error.name !== "TokenExpiredError") {
      console.error("Auth middleware error:", error);
    }
    res.status(401).json({
      message: "Not authorized",
    });
  }
};

exports.optionalAuth = async (req, res, next) => {
  try {
    const token = readBearerToken(req);

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select(SAFE_USER_FIELDS);
      if (user && isTokenCurrent(decoded, user)) req.user = user;
    }
  } catch {
    req.user = undefined;
  }

  next();
};
