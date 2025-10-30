/**
 * WebRTC Call Handlers
 * Handles WebRTC signaling for 1-on-1 and group video/audio calls
 * Separate from meeting WebRTC to maintain modularity
 */
export const registerWebRTCCallHandlers = (socket, io, state) => {
  const { callRooms } = state;
  /**
   * Join WebRTC call room
   * Used for regular video/audio calls (not meetings)
   */
  socket.on("user_joined_call", async (data) => {
    const { callId, userId, user } = data;

    try {
      // Add user to call room if not already there
      socket.join(`call:${callId}`);
      socket.currentCallId = callId;

      // Track user in call room
      if (!callRooms.has(callId)) {
        callRooms.set(callId, new Map());
      }
      callRooms.get(callId).set(userId, socket.id);

      console.log(`✅ [Call] User ${userId} joined call room: ${callId}`);

      // Notify others that a new user joined (for WebRTC peer connection setup)
      socket.to(`call:${callId}`).emit("user-joined", {
        userId: userId,
        user: user || { _id: userId, name: 'User' }
      });

      console.log(`📢 [Call] Notified peers in call ${callId} about new user ${userId}`);
    } catch (error) {
      console.error(`❌ [Call] Error in user_joined_call:`, error);
      socket.emit("error", { message: "Failed to join call room" });
    }
  });

  /**
   * Leave WebRTC call room
   * Cleanup when user leaves a call
   */
  socket.on("leave-call", (data) => {
    const { callId, userId } = data;
    
    if (callId && socket.currentCallId === callId) {
      const userIdToUse = userId || socket.userId;
      console.log(`👋 [Call] User ${userIdToUse} leaving WebRTC call: ${callId}`);
      
      // Remove user from call room tracking
      if (callRooms.has(callId)) {
        callRooms.get(callId).delete(userIdToUse);
        if (callRooms.get(callId).size === 0) {
          callRooms.delete(callId);
          console.log(`🗑️ [Call] Call room ${callId} is empty, removed from tracking`);
        }
      }
      
      // Notify others that user left
      socket.to(`call:${callId}`).emit("user-left", {
        userId: userIdToUse
      });
      
      socket.leave(`call:${callId}`);
      socket.currentCallId = null;
      
      console.log(`✅ [Call] User ${userIdToUse} left call room: ${callId}`);
    }
  });

  /**
   * WebRTC SDP Offer
   * Relay offer from one peer to another
   */
  socket.on("sdp_offer", (data) => {
    const { callId, offer, to } = data;
    console.log(`📤 [Call] Relaying SDP offer from ${socket.userId} to ${to} in call ${callId}`);

    // Get target socket ID
    const targetSocketId = callRooms.get(callId)?.get(to);

    if (targetSocketId) {
      // Send offer to the specific peer
      io.to(targetSocketId).emit("sdp_offer", {
        fromUserId: socket.userId,
        offer: offer
      });
      console.log(`✅ [Call] SDP offer relayed successfully`);
    } else {
      console.warn(`⚠️ [Call] Target user ${to} not found in call ${callId}`);
    }
  });

  /**
   * WebRTC SDP Answer
   * Relay answer from one peer to another
   */
  socket.on("sdp_answer", (data) => {
    const { callId, answer, to } = data;
    console.log(`📤 [Call] Relaying SDP answer from ${socket.userId} to ${to} in call ${callId}`);

    // Get target socket ID
    const targetSocketId = callRooms.get(callId)?.get(to);

    if (targetSocketId) {
      // Send answer to the specific peer
      io.to(targetSocketId).emit("sdp_answer", {
        fromUserId: socket.userId,
        answer: answer
      });
      console.log(`✅ [Call] SDP answer relayed successfully`);
    } else {
      console.warn(`⚠️ [Call] Target user ${to} not found in call ${callId}`);
    }
  });

  /**
   * WebRTC ICE Candidate
   * Exchange ICE candidates between peers
   */
  socket.on("ice_candidate", (data) => {
    const { callId, candidate, to } = data;
    console.log(`🧊 [Call] Relaying ICE candidate from ${socket.userId} to ${to} in call ${callId}`);
    
    // Get target socket ID
    const targetSocketId = callRooms.get(callId)?.get(to);
    
    if (targetSocketId) {
      // Send ICE candidate to the specific peer
      io.to(targetSocketId).emit("ice_candidate", {
        fromUserId: socket.userId,
        candidate: candidate
      });
      console.log(`✅ [Call] ICE candidate relayed successfully`);
    } else {
      console.warn(`⚠️ [Call] Target user ${to} not found in call ${callId}`);
    }
  });

  /**
   * Cleanup on disconnect
   * Remove user from all call rooms they were in
   */
  socket.on("disconnect", () => {
    if (socket.currentCallId) {
      const callId = socket.currentCallId;
      const userId = socket.userId;
      
      console.log(`🔌 [Call] User ${userId} disconnected from call ${callId}`);
      
      // Remove from call room tracking
      if (callRooms.has(callId)) {
        callRooms.get(callId).delete(userId);
        if (callRooms.get(callId).size === 0) {
          callRooms.delete(callId);
        }
      }
      
      // Notify others
      socket.to(`call:${callId}`).emit("user-left", {
        userId: userId
      });
    }
  });

  console.log('✅ WebRTC Call handlers registered');
};
