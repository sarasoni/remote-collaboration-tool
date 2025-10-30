import Call from "../models/call.model.js";
import Chat from "../models/chat.model.js";

const getParticipantUserId = (user) => {
  if (!user) {
    return null;
  }
  if (typeof user === "object") {
    if (user._id) {
      return user._id.toString();
    }
    if (typeof user.toString === "function") {
      return user.toString();
    }
    return null;
  }
  return user.toString();
};

const getParticipantUserRef = (user) => {
  if (!user) {
    return null;
  }
  if (typeof user === "object" && user._id) {
    return user._id;
  }
  return user;
};

/**
 * Start a new call
 */
export const startCall = async (req, res) => {
  try {
    const { chatId, callType = "video", participants = [] } = req.body;
    const userId = req.user.id;

    if (!chatId) {
      return res.status(400).json({ message: "chatId is required" });
    }

    const chat = await Chat.findById(chatId).populate("participants.user", "name avatar");
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const existingParticipant = chat.participants.some((participant) => {
      const participantId = getParticipantUserId(participant.user);
      return participantId === userId;
    });
    if (!existingParticipant) {
      return res.status(403).json({ message: "You are not a participant of this chat" });
    }

    const participantSet = new Set();
    const normalizedParticipants = chat.participants.map((participant) => {
      const id = getParticipantUserId(participant.user);
      if (id) {
        participantSet.add(id);
      }
      const userRef = getParticipantUserRef(participant.user);
      return {
        user: userRef,
        status: id === userId ? "joined" : "invited",
        joinedAt: id === userId ? new Date() : undefined,
      };
    });

    participants.forEach((id) => {
      const normalizedId = id.toString();
      if (!participantSet.has(normalizedId)) {
        normalizedParticipants.push({
          user: normalizedId,
          status: normalizedId === userId ? "joined" : "invited",
          joinedAt: normalizedId === userId ? new Date() : undefined,
        });
        participantSet.add(normalizedId);
      }
    });

    const call = await Call.create({
      type: chat.type || "one-to-one",
      chat: chatId,
      participants: normalizedParticipants,
      startedBy: userId,
      status: "ringing",
      startedAt: new Date(),
    });

    await call.populate("participants.user", "name avatar");
    await call.populate("startedBy", "name avatar");

    // Emit socket events so recipients get notified even via REST flow
    try {
      const io = global.io;
      if (io) {
        // Caller feedback
        io.to(`user:${userId}`).emit('call_started', { callId: call._id, call });
        // Notify all invitees except caller
        const participants = call.participants || [];
        for (const p of participants) {
          const pid = (p.user && p.user._id ? p.user._id : p.user)?.toString();
          if (pid && pid !== userId) {
            io.to(`user:${pid}`).emit('incoming_call', {
              callId: call._id,
              fromUserId: userId,
              fromUserName: req.user?.name,
              call,
              chatId,
              type: callType,
            });
          }
        }
      }
    } catch {}

    res.status(201).json({
      success: true,
      message: "Call started successfully",
      call,
    });
  } catch (error) {
    console.error("Error starting call:", error);
    res.status(500).json({ message: "Failed to start call" });
  }
};

/**
 * Join a call
 */
export const joinCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    const call = await Call.findById(callId);
    if (!call) return res.status(404).json({ message: "Call not found" });

    const existingParticipant = call.participants.find(
      (participant) => participant.user.toString() === userId
    );

    if (existingParticipant) {
      if (existingParticipant.status !== "joined") {
        existingParticipant.status = "joined";
        existingParticipant.joinedAt = new Date();
        await call.save();

        // Emit socket event to notify other participants
        const io = global.io;
        if (io) {
          io.to(`call:${callId}`).emit("user_joined_call", {
            callId,
            userId,
            user: req.user,
            call: call
          });
        }
      }
    } else {
      call.participants.push({
        user: userId,
        status: "joined",
        joinedAt: new Date(),
      });
      await call.save();

      // Emit socket event to notify other participants
      const io = global.io;
      if (io) {
        io.to(`call:${callId}`).emit("user_joined_call", {
          callId,
          userId,
          user: req.user,
          call: call
        });
      }
    }

    await call.populate("participants.user", "name avatar");

    res.status(200).json({ success: true, message: "Joined call", call });
  } catch (error) {
    console.error("Error joining call:", error);
    res.status(500).json({ message: "Failed to join call" });
  }
};

/**
 * End a call
 */
export const endCall = async (req, res) => {
  try {
    const { callId } = req.params;

    // Validate callId
    if (!callId || callId === 'undefined' || callId === 'null') {
      console.error('❌ Invalid callId:', callId);
      return res.status(400).json({ 
        success: false,
        message: "Invalid call ID provided" 
      });
    }

    // Validate ObjectId format
    if (!callId.match(/^[0-9a-fA-F]{24}$/)) {
      console.error('❌ Invalid ObjectId format:', callId);
      return res.status(400).json({ 
        success: false,
        message: "Invalid call ID format" 
      });
    }

    const call = await Call.findById(callId);
    if (!call) {
      console.error('❌ Call not found:', callId);
      return res.status(404).json({ 
        success: false,
        message: "Call not found" 
      });
    }

    call.status = "ended";
    call.endedAt = new Date();
    await call.save();

    console.log('✅ Call ended successfully:', callId);

    res.status(200).json({
      success: true,
      message: "Call ended successfully",
      call,
    });
  } catch (error) {
    console.error("❌ Error ending call:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to end call",
      error: error.message 
    });
  }
};

/**
 * Get call history for logged-in user
 */
export const getCallHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const calls = await Call.find({ "participants.user": userId })
      .sort({ startedAt: -1 })
      .populate("participants.user", "name avatar")
      .populate("startedBy", "name avatar")
      .lean();
    res.status(200).json(calls);
  } catch (error) {
    console.error("Error fetching call history:", error);
    res.status(500).json({ message: "Failed to fetch call history" });
  }
};

/**
 * Update call settings
 */
export const updateCallSettings = async (req, res) => {
  try {
    const { callId } = req.params;
    const updates = req.body;

    const call = await Call.findByIdAndUpdate(callId, updates, { new: true });
    if (!call) return res.status(404).json({ message: "Call not found" });

    res
      .status(200)
      .json({ success: true, message: "Call settings updated", call });
  } catch (error) {
    console.error("Error updating call settings:", error);
    res.status(500).json({ message: "Failed to update call settings" });
  }
};

/**
 * Reject a call
 */
export const rejectCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    const call = await Call.findById(callId);
    if (!call) return res.status(404).json({ message: "Call not found" });

    call.rejectedBy = [...(call.rejectedBy || []), userId];
    call.status = "rejected";
    await call.save();

    res.status(200).json({ success: true, message: "Call rejected", call });
  } catch (error) {
    console.error("Error rejecting call:", error);
    res.status(500).json({ message: "Failed to reject call" });
  }
};

/**
 * Mark call as missed
 */
export const markCallAsMissed = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    const call = await Call.findById(callId);
    if (!call) return res.status(404).json({ message: "Call not found" });

    call.missedBy = [...(call.missedBy || []), userId];
    call.status = "missed";
    await call.save();

    res
      .status(200)
      .json({ success: true, message: "Call marked as missed", call });
  } catch (error) {
    console.error("Error marking call as missed:", error);
    res.status(500).json({ message: "Failed to mark call as missed" });
  }
};

/**
 * Cleanup missed calls
 */
export const cleanupMissedCalls = async (req, res) => {
  try {
    const result = await Call.deleteMany({ status: "missed" });
    res.status(200).json({
      success: true,
      message: "Missed calls cleaned up",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error cleaning up missed calls:", error);
    res.status(500).json({ message: "Failed to clean up missed calls" });
  }
};

/**
 * Get call by ID
 */
export const getCallById = async (req, res) => {
  try {
    const { callId } = req.params;

    // Validate callId
    if (!callId || callId === 'undefined' || callId === 'null') {
      console.error('❌ Invalid callId:', callId);
      return res.status(400).json({ 
        success: false,
        message: "Invalid call ID provided" 
      });
    }

    // Validate ObjectId format
    if (!callId.match(/^[0-9a-fA-F]{24}$/)) {
      console.error('❌ Invalid ObjectId format:', callId);
      return res.status(400).json({ 
        success: false,
        message: "Invalid call ID format" 
      });
    }

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({ 
        success: false,
        message: "Call not found" 
      });
    }

    res.status(200).json({ success: true, call });
  } catch (error) {
    console.error("❌ Error fetching call:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch call",
      error: error.message 
    });
  }
};

/**
 * Delete a single call record
 */
export const deleteCall = async (req, res) => {
  try {
    const { callId } = req.params;
    await Call.findByIdAndDelete(callId);
    res
      .status(200)
      .json({ success: true, message: "Call deleted successfully" });
  } catch (error) {
    console.error("Error deleting call:", error);
    res.status(500).json({ message: "Failed to delete call" });
  }
};

/**
 * Clear entire call history for user
 */
export const clearCallHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    await Call.deleteMany({ "participants.user": userId });
    res.status(200).json({ success: true, message: "Call history cleared" });
  } catch (error) {
    console.error("Error clearing call history:", error);
    res.status(500).json({ message: "Failed to clear call history" });
  }
};

/**
 * Get current active/ongoing call for logged-in user
 * Similar to getCurrentUser - returns the user's active call if any
 */
export const getCurrentCall = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find any active call (ringing or ongoing) where user is a participant
    const currentCall = await Call.findOne({
      "participants.user": userId,
      status: { $in: ["ringing", "ongoing"] }
    })
      .populate("participants.user", "name avatar email")
      .populate("startedBy", "name avatar email")
      .populate("chat", "name type")
      .sort({ startedAt: -1 }) // Get most recent if multiple
      .lean();

    if (!currentCall) {
      return res.status(200).json({ 
        success: true, 
        currentCall: null,
        message: "No active call" 
      });
    }

    // Find the user's participant status
    const userParticipant = currentCall.participants.find(
      p => p.user._id.toString() === userId
    );

    res.status(200).json({
      success: true,
      currentCall: {
        ...currentCall,
        userStatus: userParticipant?.status || "unknown",
        isStartedByMe: currentCall.startedBy._id.toString() === userId
      }
    });
  } catch (error) {
    console.error("Error fetching current call:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch current call" 
    });
  }
};
