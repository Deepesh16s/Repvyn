const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const Follow = require("../models/Follow");
const Block = require("../models/Block");
const Notification = require("../models/Notification");
const { toPublicUser } = require("../utils/publicUser");
const { normalize: normalizeUsername } = require("../utils/username");
const { notifyUser } = require("../realtime/chatSocket");
const { isBlockedEitherWay } = require("../utils/blocking");
const { createNotificationIfNew } = require("../utils/notificationService");
const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const MAX_MESSAGE_PAGE_SIZE = 50;
const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_CONVERSATION_LIST = 50;
const PREVIEW_LENGTH = 120;

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function otherParticipant(conversation, viewerId) {
  return conversation.participants.find((p) => String(p._id || p) !== String(viewerId));
}

function truncatePreview(body) {
  if (!body) return "";
  return body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH)}…` : body;
}

const MUTUAL_FOLLOW_REQUIRED_MESSAGE = "You need to follow each other to message this user";

async function meetsPrivateAccountRule(viewerId, recipient) {
  if (recipient.profileVisibility !== "private") return true;
  const [viewerFollowsRecipient, recipientFollowsViewer] = await Promise.all([
    Follow.exists({ follower: viewerId, following: recipient._id }),
    Follow.exists({ follower: recipient._id, following: viewerId }),
  ]);
  return !!viewerFollowsRecipient && !!recipientFollowsViewer;
}

async function loadOwnedConversation(conversationId, viewerId, { populate = false } = {}) {
  if (!isValidObjectId(conversationId)) return { error: 400, message: "Invalid conversation ID" };

  let query = Conversation.findById(conversationId);
  if (populate) query = query.populate("participants", "username name picture profileVisibility");
  const conversation = await query;

  if (!conversation) return { error: 404, message: "Conversation not found" };

  const isParticipant = conversation.participants.some(
    (p) => String(p._id || p) === String(viewerId)
  );
  if (!isParticipant) return { error: 403, message: "Not authorized" };

  return { conversation };
}

exports.listConversations = async (req, res) => {
  try {
    const viewerId = req.user._id;

    const conversations = await Conversation.find({ participants: viewerId })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(MAX_CONVERSATION_LIST)
      .populate("participants", "username name picture");

    const convIds = conversations.map((c) => c._id);
    const unreadAgg = convIds.length
      ? await Message.aggregate([
          {
            $match: {
              conversation: { $in: convIds },
              sender: { $ne: viewerId },
              readAt: null,
              deletedAt: null,
            },
          },
          { $group: { _id: "$conversation", count: { $sum: 1 } } },
        ])
      : [];
    const unreadByConversation = new Map(unreadAgg.map((u) => [String(u._id), u.count]));

    const otherIds = conversations.map((c) => otherParticipant(c, viewerId)?._id).filter(Boolean);
    const blockedSet = new Set();
    if (otherIds.length) {
      const blocks = await Block.find({
        $or: [
          { blocker: viewerId, blocked: { $in: otherIds } },
          { blocked: viewerId, blocker: { $in: otherIds } },
        ],
      }).select("blocker blocked");
      for (const b of blocks) {
        blockedSet.add(String(b.blocker) === String(viewerId) ? String(b.blocked) : String(b.blocker));
      }
    }

    res.status(200).json({
      conversations: conversations.map((c) => {
        const other = otherParticipant(c, viewerId);
        return {
          _id: c._id,
          otherUser: other ? toPublicUser(other) : null,
          lastMessageAt: c.lastMessageAt,
          lastMessagePreview: c.lastMessagePreview,
          unreadCount: unreadByConversation.get(String(c._id)) || 0,
          isBlocked: other ? blockedSet.has(String(other._id)) : false,
        };
      }),
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.createConversation = async (req, res) => {
  try {
    const viewerId = req.user._id;
    const rawUsername = req.body.username;
    if (!rawUsername) {
      return res.status(400).json({ message: "username is required" });
    }

    const username = normalizeUsername(rawUsername);
    const target = await User.findOne({ username }).select(
      "_id username name picture profileVisibility"
    );
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    if (String(target._id) === String(viewerId)) {
      return res.status(400).json({ message: "You cannot message yourself" });
    }

    if (await isBlockedEitherWay(viewerId, target._id)) {
      return res.status(403).json({ message: "Unable to start a conversation with this user" });
    }

    if (!(await meetsPrivateAccountRule(viewerId, target))) {
      return res.status(403).json({ message: MUTUAL_FOLLOW_REQUIRED_MESSAGE });
    }

    const [low, high] = Conversation.canonicalPair(viewerId, target._id);

    let conversation = await Conversation.findOne({ participantLow: low, participantHigh: high });
    if (!conversation) {
      try {
        conversation = await Conversation.create({
          participants: [low, high],
          participantLow: low,
          participantHigh: high,
        });
      } catch (error) {
        if (error.code === 11000 || error.code === "E11000") {
          conversation = await Conversation.findOne({ participantLow: low, participantHigh: high });
        } else {
          throw error;
        }
      }
    }

    res.status(200).json({
      _id: conversation._id,
      otherUser: toPublicUser(target),
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getConversation = async (req, res) => {
  try {
    const viewerId = req.user._id;
    const { conversation, error, message } = await loadOwnedConversation(req.params.id, viewerId, {
      populate: true,
    });
    if (error) return res.status(error).json({ message });

    const other = otherParticipant(conversation, viewerId);
    const isBlocked = other ? await isBlockedEitherWay(viewerId, other._id) : false;

    res.status(200).json({
      _id: conversation._id,
      otherUser: other ? toPublicUser(other) : null,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      isBlocked,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const viewerId = req.user._id;
    const { conversation, error, message } = await loadOwnedConversation(req.params.id, viewerId);
    if (error) return res.status(error).json({ message });

    const limit = Math.min(Number(req.query.limit) || DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

    const filter = { conversation: conversation._id };
    if (req.query.before) {
      const beforeDate = new Date(req.query.before);
      if (Number.isNaN(beforeDate.getTime())) {
        return res.status(400).json({ message: "Invalid 'before' cursor" });
      }
      filter.createdAt = { $lt: beforeDate };
    }

    const page = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sender", "username name picture");

    const messages = page.reverse().map((m) => ({
      _id: m._id,
      conversation: m.conversation,
      sender: toPublicUser(m.sender),
      senderId: m.sender._id,
      body: m.deletedAt ? null : m.body,
      deleted: !!m.deletedAt,
      readAt: m.readAt,
      createdAt: m.createdAt,
    }));

    res.status(200).json({
      messages,
      hasMore: page.length === limit,
      nextBefore: page.length ? page[0].createdAt : null,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const viewerId = req.user._id;
    const { conversation, error, message } = await loadOwnedConversation(req.params.id, viewerId, {
      populate: true,
    });
    if (error) return res.status(error).json({ message });

    const other = otherParticipant(conversation, viewerId);
    if (other && (await isBlockedEitherWay(viewerId, other._id))) {
      return res.status(403).json({ message: "You can't message this user" });
    }
    if (other && !(await meetsPrivateAccountRule(viewerId, other))) {
      return res.status(403).json({ message: MUTUAL_FOLLOW_REQUIRED_MESSAGE });
    }

    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }
    if (body.length > Message.MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        message: `Message cannot exceed ${Message.MAX_MESSAGE_LENGTH} characters`,
      });
    }

    const created = await Message.create({
      conversation: conversation._id,
      sender: viewerId,
      body,
    });

    conversation.lastMessageAt = created.createdAt;
    conversation.lastMessagePreview = truncatePreview(body);
    await conversation.save();

    const payload = {
      _id: created._id,
      conversation: conversation._id,
      sender: toPublicUser(req.user),
      senderId: viewerId,
      body: created.body,
      deleted: false,
      readAt: null,
      createdAt: created.createdAt,
    };

    if (other) {
      notifyUser(other._id, { type: "message:new", conversationId: String(conversation._id), message: payload });
      createNotificationIfNew(other._id, {
        type: NOTIFICATION_TYPES.NEW_MESSAGE,
        category: "social",
        icon: "MessageCircle",
        title: `New message from @${req.user.username}`,
        subtitle: truncatePreview(body),
        navigationTarget: `/messages/${conversation._id}`,
        dedupeKey: `message:${conversation._id}:${viewerId}`,
      }).catch((notifyError) => console.error("Message notification failed:", notifyError));
    }

    res.status(201).json(payload);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.markRead = async (req, res) => {
  try {
    const viewerId = req.user._id;
    const { conversation, error, message } = await loadOwnedConversation(req.params.id, viewerId);
    if (error) return res.status(error).json({ message });

    const now = new Date();
    const result = await Message.updateMany(
      { conversation: conversation._id, sender: { $ne: viewerId }, readAt: null },
      { readAt: now }
    );

    const other = otherParticipant(conversation, viewerId);
    if (other && result.modifiedCount > 0) {
      notifyUser(other, { type: "message:read", conversationId: String(conversation._id), readAt: now });
    }

    res.status(200).json({ message: "Marked as read", updated: result.modifiedCount });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const viewerId = req.user._id;
    const { conversationId, messageId } = req.params;

    const { conversation, error, message } = await loadOwnedConversation(conversationId, viewerId);
    if (error) return res.status(error).json({ message });

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ message: "Invalid message ID" });
    }

    const target = await Message.findOne({ _id: messageId, conversation: conversation._id });
    if (!target) {
      return res.status(404).json({ message: "Message not found" });
    }
    if (String(target.sender) !== String(viewerId)) {
      return res.status(403).json({ message: "You can only delete your own messages" });
    }

    const deletedPreview = truncatePreview(target.body);
    target.deletedAt = new Date();
    target.body = "";
    await target.save();

    const latest = await Message.findOne({ conversation: conversation._id, deletedAt: null })
      .sort({ createdAt: -1 })
      .select("body");
    conversation.lastMessagePreview = latest ? truncatePreview(latest.body) : "";
    await conversation.save();

    const other = otherParticipant(conversation, viewerId);
    if (other) {
      await Notification.updateMany(
        { user: other, dedupeKey: `message:${conversation._id}:${viewerId}`, subtitle: deletedPreview },
        { subtitle: null }
      );
    }
    if (other) {
      notifyUser(other, {
        type: "message:deleted",
        conversationId: String(conversation._id),
        messageId: String(target._id),
      });
    }

    res.status(200).json({ message: "Message deleted" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};
