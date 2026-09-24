const express = require("express");
const router = express.Router();

const {
  getNotifications,
  markRead,
  markAllRead,
  dismiss,
  clearRead,
  generateFromClient,
  snooze,
} = require("../controllers/notificationController");

const { protect } = require("../middleware/authMiddleware");
const { notificationGenerateLimiter } = require("../middleware/apiRateLimiters");
const validateObjectId = require("../middleware/validateObjectId");

router.get("/", protect, getNotifications);
router.post("/generate", protect, notificationGenerateLimiter, generateFromClient);
router.put("/read-all", protect, markAllRead);
router.put("/clear-read", protect, clearRead);
router.put("/:id/read", protect, validateObjectId(), markRead);
router.put("/:id/dismiss", protect, validateObjectId(), dismiss);
router.put("/:id/snooze", protect, validateObjectId(), snooze);

module.exports = router;
