const Block = require("../models/Block");

async function isBlockedEitherWay(userIdA, userIdB) {
  const blocked = await Block.exists({
    $or: [
      { blocker: userIdA, blocked: userIdB },
      { blocker: userIdB, blocked: userIdA },
    ],
  });
  return !!blocked;
}

async function getViewerBlockSet(viewerId, targetIds) {
  if (!viewerId || targetIds.length === 0) return new Set();
  const blocks = await Block.find({
    $or: [
      { blocker: viewerId, blocked: { $in: targetIds } },
      { blocker: { $in: targetIds }, blocked: viewerId },
    ],
  }).select("blocker blocked");
  const blockedIds = new Set();
  for (const b of blocks) {
    blockedIds.add(String(b.blocker) === String(viewerId) ? String(b.blocked) : String(b.blocker));
  }
  return blockedIds;
}

module.exports = { isBlockedEitherWay, getViewerBlockSet };
