import Call from "../../models/call.model.js";
import Chat from "../../models/chat.model.js";

/**
 * Call Socket Handlers - Modular Implementation
 * Handles call lifecycle: start, join, end, reject
 * Ensures reliable event delivery through dual emission strategy
 */

// ============ HELPER FUNCTIONS ============

/**
 * Emit event to both user room and call room for reliability
 */
const emitToUserAndCallRoom = (io, userId, callId, eventName, payload) => {
  io.to(`user:${userId}`).emit(eventName, payload);
  if (callId) {
    io.to(`call:${callId}`).emit(eventName, payload);
  }
};

/**
 * Get user ID as string from various formats
 */
const getUserId = (user) => {
  if (!user) return null;
  return user._id ? user._id.toString() : user.toString();
};

/**
 * Log call event with consistent formatting
 */
const logCallEvent = (eventName, details) => {
  console.log(`\n📞 ===== ${eventName.toUpperCase()} =====`);
  Object.entries(details).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
  });
  console.log(`================================\n`);
};

// ============ MAIN HANDLER REGISTRATION ============

export const registerCallHandlers = (socket, io, state) => {
  const { activeCalls, callTimeouts, callRooms, userLocations } = state;

  // Start call
  socket.on("start_call", async (data) => {
    try {
      const { chatId, type, participantIds } = data;
      
      let participants = [];
      
      if (chatId) {
        const chat = await Chat.findById(chatId);
        if (!chat) {
          socket.emit("error", "Chat not found");
          return;
        }

        // Verify user is participant
        const isParticipant = chat.participants.some(
          p => p.user.toString() === socket.userId
        );

        if (!isParticipant) {
          socket.emit("error", "You are not a participant in this chat");
          return;
        }

        // Check for existing ongoing calls
        const existingCall = await Call.findOne({
          chat: chatId,
          status: { $in: ['ringing', 'ongoing'] },
          startedBy: socket.userId
        });

        if (existingCall) {
          console.log(`⚠️ User ${socket.userId} already has an active call in chat ${chatId}`);
          socket.emit("error", "You already have an active call in this chat");
          return;
        }

        participants = chat.participants
          .filter(p => p.user.toString() !== socket.userId)
          .map(p => ({
            user: p.user,
            status: 'invited'
          }));

        participants.unshift({
          user: socket.userId,
          status: 'joined',
          joinedAt: new Date()
        });
      } else {
        participants = [
          { user: socket.userId, status: 'joined', joinedAt: new Date() },
          ...participantIds.map(id => ({ user: id, status: 'invited' }))
        ];
      }

      const call = await Call.create({
        type: type || 'one-to-one',
        chat: chatId,
        participants,
        startedBy: socket.userId,
        status: 'ringing'
      });

      // Populate all user references to prevent "Unknown User" issue
      await call.populate('participants.user', 'name avatar email');
      await call.populate('startedBy', 'name avatar email');
      if (call.chat) {
        await call.populate('chat', 'name type');
      }

      // Store active call
      activeCalls.set(call._id.toString(), {
        callId: call._id.toString(),
        participants: call.participants.map(p => p.user._id.toString()),
        status: 'ringing'
      });

      // Join call room
      socket.join(`call:${call._id}`);
      socket.currentCallId = call._id.toString();

      // Notify participants with dual emission
      call.participants.forEach(participant => {
        const targetUserId = getUserId(participant.user);
        if (targetUserId && targetUserId !== socket.userId) {
          const targetLocation = userLocations.get(targetUserId);
          
          logCallEvent('INCOMING_CALL', {
            '📞 Call ID': call._id,
            '👤 Target User': targetUserId,
            '📍 Location': targetLocation?.currentPage || 'unknown'
          });
          
          // Only emit to user room (not call room) to prevent duplicates
          // since recipient is not in call room yet
          io.to(`user:${targetUserId}`).emit("incoming_call", {
            callId: call._id,
            call,
            fromUserId: socket.userId,
            fromUserName: socket.user.name,
            fromUserAvatar: socket.user.avatar,
            recipientLocation: targetLocation?.currentPage || null,
            ringing: true,
            createdAt: new Date()
          });
        }
      });

      // Set auto-termination timer
      const timeoutId = setTimeout(async () => {
        try {
          const activeCall = activeCalls.get(call._id.toString());
          if (activeCall && activeCall.status === 'ringing') {
            await Call.findByIdAndUpdate(call._id, {
              status: 'missed',
              endedAt: new Date()
            });
            
            activeCalls.delete(call._id.toString());
            callTimeouts.delete(call._id.toString());
            
            io.to(`call:${call._id}`).emit("call_ended", {
              callId: call._id,
              reason: 'missed',
              message: 'Call not answered within 45 seconds'
            });
            
            call.participants.forEach(participant => {
              io.to(`user:${participant.user._id}`).emit("call_ended", {
                callId: call._id,
                reason: 'missed',
                message: 'Call not answered within 45 seconds'
              });
            });
          }
        } catch (error) {
          console.error('Error in call timeout:', error);
        }
      }, parseInt(process.env.CALL_TIMEOUT_MS) || 45000);
      
      callTimeouts.set(call._id.toString(), timeoutId);

      socket.emit("call_started", { 
        call,
        ringing: true
      });

    } catch (error) {
      console.error('❌ Error in start_call handler:', error.message);
      socket.emit("error", "Failed to start call");
    }
  });

  // Join call
  socket.on("join_call", async (data) => {
    try {
      const { callId } = data;
      
      const call = await Call.findById(callId);
      if (!call) {
        socket.emit("error", { message: "Call not found" });
        return;
      }

      // Clear timeouts
      if (callTimeouts.has(callId)) {
        clearTimeout(callTimeouts.get(callId));
        callTimeouts.delete(callId);
      }

      const participant = call.participants.find(
        p => p.user.toString() === socket.userId
      );

      if (!participant) {
        socket.emit("error", { message: "You are not invited to this call" });
        return;
      }

      participant.status = 'joined';
      participant.joinedAt = new Date();

      if (call.status === 'ringing') {
        call.status = 'ongoing';
      }

      await call.save();
      
      // Populate all user references to prevent "Unknown User" issue
      await call.populate('participants.user', 'name avatar email');
      await call.populate('startedBy', 'name avatar email');
      if (call.chat) {
        await call.populate('chat', 'name type');
      }

      // Join call room
      socket.join(`call:${callId}`);
      socket.currentCallId = callId;

      // Notify participant joined
      socket.to(`call:${callId}`).emit("participant_joined", {
        callId,
        userId: socket.userId,
        userName: socket.user?.name || 'Unknown User',
        avatar: socket.user?.avatar || null
      });

      // Emit call_joined to call room
      io.to(`call:${callId}`).emit("call_joined", { call, ringing: false });

      // Emit call_accepted to caller with dual emission for reliability
      const callerId = getUserId(call.startedBy);
      
      logCallEvent('CALL_ACCEPTED', {
        '📞 Call ID': callId,
        '👤 Caller ID': callerId,
        '✅ Accepted By': `${socket.user?.name} (${socket.userId})`
      });
      
      // Dual emission: both user room and call room
      emitToUserAndCallRoom(io, callerId, callId, "call_accepted", {
        call,
        acceptedBy: socket.userId,
        acceptedByName: socket.user?.name || 'Unknown User',
        ringing: false
      });

      // Also emit call_joined to all participants individually
      call.participants.forEach(participant => {
        const participantId = getUserId(participant.user);
        if (participantId) {
          io.to(`user:${participantId}`).emit("call_joined", { call, ringing: false });
        }
      });

    } catch (error) {
      console.error('Error in join_call handler:', error);
      socket.emit("error", "Failed to join call");
    }
  });

  // End call
  socket.on("end_call", async (data) => {
    try {
      const { callId } = data;
      
      const call = await Call.findById(callId);
      if (!call) return;

      // Clear timeouts
      if (callTimeouts.has(callId)) {
        clearTimeout(callTimeouts.get(callId));
        callTimeouts.delete(callId);
      }

      const participant = call.participants.find(
        p => p.user.toString() === socket.userId
      );

      if (participant) {
        participant.status = 'left';
        participant.leftAt = new Date();
      }

      // Check if all participants have left
      const allLeft = call.participants.every(p => p.status === 'left' || p.status === 'missed');
      
      if (allLeft || call.startedBy.toString() === socket.userId) {
        call.status = 'ended';
        call.endedAt = new Date();
      }

      await call.save();

      // Remove from active calls
      activeCalls.delete(callId);

      // Notify all participants
      io.to(`call:${callId}`).emit("call_ended", {
        callId,
        endedBy: socket.userId,
        call
      });

      call.participants.forEach(participant => {
        io.to(`user:${participant.user._id}`).emit("call_ended", {
          callId,
          endedBy: socket.userId,
          call
        });
      });

      socket.leave(`call:${callId}`);
      socket.currentCallId = null;

    } catch (error) {
      console.error('Error in end_call handler:', error);
    }
  });

  // Reject call
  socket.on("reject_call", async (data) => {
    try {
      const { callId } = data;
      
      const call = await Call.findById(callId);
      if (!call) return;

      const participant = call.participants.find(
        p => p.user.toString() === socket.userId
      );

      if (participant) {
        participant.status = 'rejected';
      }

      await call.save();

      // Notify caller
      io.to(`user:${call.startedBy}`).emit("call_rejected", {
        callId,
        rejectedBy: socket.userId,
        rejectedByName: socket.user.name
      });

    } catch (error) {
      console.error('Error in reject_call handler:', error);
    }
  });

  // WebRTC signaling events
  socket.on("webrtc_offer", (data) => {
    const { callId, offer, targetUserId } = data;
    io.to(`user:${targetUserId}`).emit("webrtc_offer", {
      callId,
      offer,
      fromUserId: socket.userId
    });
  });

  socket.on("webrtc_answer", (data) => {
    const { callId, answer, targetUserId } = data;
    io.to(`user:${targetUserId}`).emit("webrtc_answer", {
      callId,
      answer,
      fromUserId: socket.userId
    });
  });

  socket.on("webrtc_ice_candidate", (data) => {
    const { callId, candidate, targetUserId } = data;
    io.to(`user:${targetUserId}`).emit("webrtc_ice_candidate", {
      callId,
      candidate,
      fromUserId: socket.userId
    });
  });

  // Return cleanup function
  return {
    cleanup: () => {
      if (socket.currentCallId) {
        const timeoutId = callTimeouts.get(socket.currentCallId);
        if (timeoutId) {
          clearTimeout(timeoutId);
          callTimeouts.delete(socket.currentCallId);
        }
      }
    }
  };
};
