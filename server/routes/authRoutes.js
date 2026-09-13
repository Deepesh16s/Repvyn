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
  loginRegisterLimiter,
  forgotPasswordLimiter,
  usernameCheckLimiter,
} = require("../middleware/authRateLimiters");
const uploadProfilePictureMiddleware = require("../middleware/uploadProfilePicture");

router.post("/register", loginRegisterLimiter, registerUser);
router.post("/login", loginRegisterLimiter, loginUser);
router.post("/google", loginRegisterLimiter, googleLogin);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password/:token", resetPassword);

router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.post("/profile-picture", protect, uploadProfilePictureMiddleware, uploadProfilePicture);
router.delete("/profile-picture", protect, deleteProfilePicture);
router.put("/change-password", protect, changePassword);
router.delete("/account", protect, deleteAccount);

router.get("/username-available", usernameCheckLimiter, checkUsernameAvailable);
router.put("/username", protect, updateUsername);
router.put("/username-prompt-dismissed", protect, dismissUsernamePrompt);
router.put("/profile-visibility", protect, updateProfileVisibility);

module.exports = router;