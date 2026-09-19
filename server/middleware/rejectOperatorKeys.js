const MAX_NODES = 100000;

function hasOperatorKey(root) {
  const stack = [root];
  let visited = 0;

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;

    visited += 1;
    if (visited > MAX_NODES) return true;

    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }

    for (const key of Object.keys(node)) {
      if (key.startsWith("$")) return true;
      stack.push(node[key]);
    }
  }

  return false;
}

module.exports = function rejectOperatorKeys(req, res, next) {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query)) {
    return res.status(400).json({ message: "Malformed request body" });
  }
  next();
};

module.exports.hasOperatorKey = hasOperatorKey;
