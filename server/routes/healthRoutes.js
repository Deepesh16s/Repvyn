const express = require("express");
const router = express.Router();

const {
  getConnectionStatus,
  connectHealth,
  disconnectHealth,
  getSyncState,
  syncBatch,
  getHealthSummary,
  deleteHealthData,
} = require("../controllers/healthController");

const { protect } = require("../middleware/authMiddleware");
const { healthSyncLimiter } = require("../middleware/apiRateLimiters");

router.get("/connection-status", protect, getConnectionStatus);
router.post("/connect", protect, connectHealth);
router.delete("/connect", protect, disconnectHealth);
router.get("/sync-state", protect, getSyncState);
router.post("/sync", protect, healthSyncLimiter, syncBatch);
router.get("/summary", protect, getHealthSummary);
router.delete("/data", protect, deleteHealthData);

module.exports = router;
