const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  googleLogin,
  getMe,
  updateProfile,
  uploadProfilePicture,
  deleteProfilePicture,
  changePassword,
  deleteAccount,
  forgotPassword,
  resetPassword,
  checkUsernameAvailable,
  updateUsername,
  dismissUsernamePrompt,
  updateProfileVisibility,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");
const {
  registerLimiter,
  loginLimiter,
  loginAccountLimiter,
  googleLoginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  usernameCheckLimiter,
} = require("../middleware/authRateLimiters");
const { passwordChangeLimiter, accountDeletionLimiter } = require("../middleware/apiRateLimiters");
const uploadProfilePictureMiddleware = require("../middleware/uploadProfilePicture");

router.post("/register", registerLimiter, registerUser);
router.post("/login", loginLimiter, loginAccountLimiter, loginUser);
router.post("/google", googleLoginLimiter, googleLogin);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password/:token", resetPasswordLimiter, resetPassword);

router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.post("/profile-picture", protect, uploadProfilePictureMiddleware, uploadProfilePicture);
router.delete("/profile-picture", protect, deleteProfilePicture);
router.put("/change-password", protect, passwordChangeLimiter, changePassword);
router.delete("/account", protect, accountDeletionLimiter, deleteAccount);

router.get("/username-available", usernameCheckLimiter, checkUsernameAvailable);
router.put("/username", protect, updateUsername);
router.put("/username-prompt-dismissed", protect, dismissUsernamePrompt);
router.put("/profile-visibility", protect, updateProfileVisibility);

module.exports = router;