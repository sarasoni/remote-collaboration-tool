/**
 * WebRTC Meeting Handlers
 * Handles WebRTC signaling for many-to-many video meetings
 * Separate from regular calls to maintain modularity and clarity
 */
export const registerWebRTCMeetingHandlers = (socket, io, state) => {
  // Create separate tracking for meeting WebRTC rooms if not exists
  if (!state.meetingWebRTCRooms) {
    state.meetingWebRTCRooms = new Map();
  }
  const meetingRooms = state.meetingWebRTCRooms;
  /**
   * Join WebRTC meeting room
   * Used for meeting video/audio streaming (many-to-many)
   */
  socket.on("join_meeting_webrtc", async (data) => {
    const { meetingId, userId, user } = data;

    try {
      // Get list of existing participants BEFORE joining
      const existingParticipants = [];
      if (meetingRooms.has(meetingId)) {
        meetingRooms.get(meetingId).forEach((socketId, existingUserId) => {
          if (existingUserId !== userId) {
            existingParticipants.push({
              userId: existingUserId,
              socketId: socketId
            });
          }
        });
      }

      // Add user to meeting WebRTC room
      socket.join(`meeting-webrtc:${meetingId}`);
      socket.currentMeetingWebRTCId = meetingId;

      // Track user in meeting room
      if (!meetingRooms.has(meetingId)) {
        meetingRooms.set(meetingId, new Map());
      }
      meetingRooms.get(meetingId).set(userId, socket.id);

      console.log(`✅ [Meeting] User ${userId} joined meeting WebRTC room: ${meetingId}`);
      console.log(`👥 [Meeting] Existing participants: ${existingParticipants.length}`);

      // Send list of existing participants to the new joiner
      // This allows the new user to initiate connections to existing users
      if (existingParticipants.length > 0) {
        socket.emit("existing-participants", {
          participants: existingParticipants.map(p => ({ userId: p.userId }))
        });
        console.log(`📤 [Meeting] Sent ${existingParticipants.length} existing participants to new user ${userId}`);
      }

      // Notify existing participants that a new user joined
      // This triggers existing users to prepare for incoming connection from new user
      socket.to(`meeting-webrtc:${meetingId}`).emit("user-joined", {
        userId: userId,
        user: user || { _id: userId, name: 'User' }
      });

      console.log(`📢 [Meeting] Notified ${existingParticipants.length} peers about new user ${userId}`);
    } catch (error) {
      console.error(`❌ [Meeting] Error in join_meeting_webrtc:`, error);
      socket.emit("error", { message: "Failed to join meeting WebRTC room" });
    }
  });

  /**
   * Leave WebRTC meeting room
   * Cleanup when user leaves a meeting
   */
  socket.on("leave_meeting_webrtc", (data) => {
    const { meetingId, userId } = data;
    
    if (meetingId && socket.currentMeetingWebRTCId === meetingId) {
      const userIdToUse = userId || socket.userId;
      console.log(`👋 [Meeting] User ${userIdToUse} leaving WebRTC meeting: ${meetingId}`);
      
      // Remove user from meeting room tracking
      if (meetingRooms.has(meetingId)) {
        meetingRooms.get(meetingId).delete(userIdToUse);
        if (meetingRooms.get(meetingId).size === 0) {
          meetingRooms.delete(meetingId);
          console.log(`🗑️ [Meeting] Meeting room ${meetingId} is empty, removed from tracking`);
        }
      }
      
      // Notify others that user left
      socket.to(`meeting-webrtc:${meetingId}`).emit("user-left", {
        userId: userIdToUse
      });
      
      socket.leave(`meeting-webrtc:${meetingId}`);
      socket.currentMeetingWebRTCId = null;
      
      console.log(`✅ [Meeting] User ${userIdToUse} left meeting WebRTC room: ${meetingId}`);
    }
  });

  /**
   * WebRTC SDP Offer (Meeting)
   * Relay offer from one peer to another in a meeting
   */
  socket.on("meeting_sdp_offer", (data) => {
    const { meetingId, offer, to } = data;
    console.log(`📤 [Meeting] Relaying SDP offer from ${socket.userId} to ${to} in meeting ${meetingId}`);

    // Get target socket ID
    const targetSocketId = meetingRooms.get(meetingId)?.get(to);

    if (targetSocketId) {
      // Send offer to the specific peer
      io.to(targetSocketId).emit("meeting_sdp_offer", {
        fromUserId: socket.userId,
        offer: offer
      });
      console.log(`✅ [Meeting] SDP offer relayed successfully`);
    } else {
      console.warn(`⚠️ [Meeting] Target user ${to} not found in meeting ${meetingId}`);
    }
  });

  /**
   * WebRTC SDP Answer (Meeting)
   * Relay answer from one peer to another in a meeting
   */
  socket.on("meeting_sdp_answer", (data) => {
    const { meetingId, answer, to } = data;
    console.log(`📤 [Meeting] Relaying SDP answer from ${socket.userId} to ${to} in meeting ${meetingId}`);

    // Get target socket ID
    const targetSocketId = meetingRooms.get(meetingId)?.get(to);

    if (targetSocketId) {
      // Send answer to the specific peer
      io.to(targetSocketId).emit("meeting_sdp_answer", {
        fromUserId: socket.userId,
        answer: answer
      });
      console.log(`✅ [Meeting] SDP answer relayed successfully`);
    } else {
      console.warn(`⚠️ [Meeting] Target user ${to} not found in meeting ${meetingId}`);
    }
  });

  /**
   * WebRTC ICE Candidate (Meeting)
   * Exchange ICE candidates between peers in a meeting
   */
  socket.on("meeting_ice_candidate", (data) => {
    const { meetingId, candidate, to } = data;
    console.log(`🧊 [Meeting] Relaying ICE candidate from ${socket.userId} to ${to} in meeting ${meetingId}`);
    
    // Get target socket ID
    const targetSocketId = meetingRooms.get(meetingId)?.get(to);
    
    if (targetSocketId) {
      // Send ICE candidate to the specific peer
      io.to(targetSocketId).emit("meeting_ice_candidate", {
        fromUserId: socket.userId,
        candidate: candidate
      });
      console.log(`✅ [Meeting] ICE candidate relayed successfully`);
    } else {
      console.warn(`⚠️ [Meeting] Target user ${to} not found in meeting ${meetingId}`);
    }
  });

  /**
   * Cleanup on disconnect
   * Remove user from all meeting rooms they were in
   */
  socket.on("disconnect", () => {
    if (socket.currentMeetingWebRTCId) {
      const meetingId = socket.currentMeetingWebRTCId;
      const userId = socket.userId;
      
      console.log(`🔌 [Meeting] User ${userId} disconnected from meeting ${meetingId}`);
      
      // Remove from meeting room tracking
      if (meetingRooms.has(meetingId)) {
        meetingRooms.get(meetingId).delete(userId);
        if (meetingRooms.get(meetingId).size === 0) {
          meetingRooms.delete(meetingId);
        }
      }
      
      // Notify others
      socket.to(`meeting-webrtc:${meetingId}`).emit("user-left", {
        userId: userId
      });
    }
  });

  console.log('✅ WebRTC Meeting handlers registered');
};
