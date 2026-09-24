const express = require("express");
const router = express.Router();

const { getFeed } = require("../controllers/activityController");
const { protect } = require("../middleware/authMiddleware");
const { heavyReadLimiter } = require("../middleware/apiRateLimiters");

router.get("/", protect, heavyReadLimiter, getFeed);

module.exports = router;
