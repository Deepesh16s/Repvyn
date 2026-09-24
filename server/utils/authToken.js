const jwt = require("jsonwebtoken");

const TOKEN_LIFETIME = "7d";

function signAuthToken(user) {
  return jwt.sign(
    { id: user._id, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_LIFETIME }
  );
}

function isTokenCurrent(decoded, user) {
  return (decoded.tv || 0) === (user.tokenVersion || 0);
}

module.exports = { signAuthToken, isTokenCurrent };
