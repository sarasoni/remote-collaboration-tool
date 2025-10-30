import { useEffect, useRef, useCallback, useState } from 'react';
import { useSocket } from './useSocket';
import { toast } from 'react-hot-toast';

/**
 * WebRTC Hook for Meeting Video Conferencing
 * Specifically designed for many-to-many video meetings
 * Separate from regular 1-on-1 calls
 */
export const useMeetingWebRTC = (meetingId, userId) => {
  const { socket, isConnected } = useSocket();
  
  // Refs for persistent data across renders
  const localStreamRef = useRef(null);
  const cameraStreamRef = useRef(null); // keep original camera stream when screen sharing
  const peerConnectionsRef = useRef({});
  const remoteStreamsRef = useRef({});
  const socketRef = useRef(socket);
  const isConnectedRef = useRef(isConnected);
  const hasJoinedCallRef = useRef(false);
  
  // Update refs when socket/connection changes
  useEffect(() => {
    socketRef.current = socket;
    isConnectedRef.current = isConnected;
  }, [socket, isConnected]);
  
  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStreamState, setLocalStreamState] = useState(null);
  const [remoteSharingUserId, setRemoteSharingUserId] = useState(null);

  // ICE servers configuration (STUN/TURN servers)
  const iceServers = {
    iceServers: [
      // STUN servers for NAT traversal
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      // TURN server for relay (configure with your credentials)
      // Uncomment and configure when you have a TURN server
      // {
      //   urls: 'turn:your-turn-server.com:3478',
      //   username: process.env.REACT_APP_TURN_USERNAME || 'user',
      //   credential: process.env.REACT_APP_TURN_PASSWORD || 'pass'
      // }
    ]
  };

  /**
   * Remove peer connection and stream
   */
  const handleRemovePeer = useCallback((remoteUserId) => {
    // Close peer connection
    if (peerConnectionsRef.current[remoteUserId]) {
      peerConnectionsRef.current[remoteUserId].close();
      delete peerConnectionsRef.current[remoteUserId];
    }

    // Remove remote stream
    if (remoteStreamsRef.current[remoteUserId]) {
      delete remoteStreamsRef.current[remoteUserId];
      setRemoteStreams(prev => {
        const updated = { ...prev };
        delete updated[remoteUserId];
        return updated;
      });
    }
  }, []);

  /**
   * Create a new peer connection for a remote user
   */
  const createPeerConnection = useCallback((remoteUserId) => {
    try {
      // Check if peer connection already exists
      if (peerConnectionsRef.current[remoteUserId]) {
        return peerConnectionsRef.current[remoteUserId];
      }

      const peerConnection = new RTCPeerConnection(iceServers);

      // Handle negotiation needed (e.g., when adding a new track like screen share)
      peerConnection.onnegotiationneeded = async () => {
        try {
          console.log(`🧩 [Meeting] Negotiation needed with ${remoteUserId}, creating updated offer`);
          await createOffer(remoteUserId);
        } catch (err) {
          console.error('❌ [Meeting] Negotiation error:', err);
        }
      };
      
      // Add local stream tracks to peer connection
      if (localStreamRef.current) {
        const tracks = localStreamRef.current.getTracks();
        console.log(`📹 [Meeting] Adding ${tracks.length} tracks to peer connection for ${remoteUserId}:`, tracks.map(t => `${t.kind} (${t.enabled})`));

        tracks.forEach(track => {
          console.log(`➕ [Meeting] Adding ${track.kind} track:`, track.label, track.enabled);
          peerConnection.addTrack(track, localStreamRef.current);
        });
      }

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socketRef.current && isConnectedRef.current) {
          console.log(`🧊 [Meeting] Sending ICE candidate to ${remoteUserId}`);
          socketRef.current.emit('meeting_ice_candidate', {
            meetingId: meetingId,
            candidate: event.candidate,
            to: remoteUserId
          });
        }
      };

      // Handle connection state changes with recovery attempts
      peerConnection.onconnectionstatechange = async () => {
        const state = peerConnection.connectionState;
        console.log(`🔗 [Meeting] Connection state with ${remoteUserId}:`, state);
        if (state === 'connected') {
          setConnectionStatus('connected');
          return;
        }
        if (state === 'disconnected' || state === 'failed') {
          console.warn(`⚠️ [Meeting] ${state} with ${remoteUserId} - attempting recovery via renegotiation`);
          try {
            await createOffer(remoteUserId);
          } catch (e) {
            console.warn('⚠️ [Meeting] Recovery offer failed:', e);
          }
          // Grace period before removing peer; connection may bounce back
          setTimeout(() => {
            const pc = peerConnectionsRef.current[remoteUserId];
            const stillBad = !pc || (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting');
            if (stillBad) {
              console.warn(`🧹 [Meeting] Cleaning up peer after grace period: ${remoteUserId}`);
              handleRemovePeer(remoteUserId);
              // If no peers are connected but socket is, show 'ready' instead of 'disconnected'
              const anyConnected = Object.values(peerConnectionsRef.current).some(p => p.connectionState === 'connected');
              setConnectionStatus(anyConnected ? 'connected' : (isConnectedRef.current ? 'ready' : 'disconnected'));
            }
          }, 2500);
        }
      };

      // Handle incoming remote tracks
      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        
        if (remoteStream) {
          console.log('📹 [Meeting] Received remote stream from:', remoteUserId);
          console.log('📊 [Meeting] Remote stream tracks:', remoteStream.getTracks().map(t => `${t.kind} (${t.enabled})`));

          const audioTracks = remoteStream.getAudioTracks();
          const videoTracks = remoteStream.getVideoTracks();

          console.log(`🎵 [Meeting] Audio tracks: ${audioTracks.length}`, audioTracks.map(t => `${t.label} (${t.enabled})`));
          console.log(`📹 [Meeting] Video tracks: ${videoTracks.length}`, videoTracks.map(t => `${t.label} (${t.enabled})`));

          // Heuristic: detect if this is a screen share track
          try {
            const videoTrack = remoteStream.getVideoTracks()[0];
            const settings = videoTrack?.getSettings?.() || {};
            const isDisplay = settings.displaySurface || (videoTrack?.label || '').toLowerCase().includes('screen');
            if (isDisplay) {
              setRemoteSharingUserId(remoteUserId);
            }
          } catch {}

          remoteStreamsRef.current[remoteUserId] = remoteStream;
          setRemoteStreams(prev => ({
            ...prev,
            [remoteUserId]: remoteStream
          }));
        }
      };

      peerConnectionsRef.current[remoteUserId] = peerConnection;
      return peerConnection;
      
    } catch (error) {
      console.error('❌ Error creating peer connection:', error);
      toast.error('Failed to establish peer connection');
      return null;
    }
  }, [meetingId, handleRemovePeer]);

  /**
   * Initialize local media stream
   */
  const initializeLocalStream = useCallback(async (constraints = { video: true, audio: true }) => {
    try {
      console.log('🎤 [Meeting] Requesting media access with constraints:', constraints);

      // Enhanced constraints for better audio/video quality
      const enhancedConstraints = {
        video: constraints.video ? {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        } : false,
        audio: constraints.audio ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        } : false
      };

      console.log('🎬 [Meeting] Enhanced constraints:', enhancedConstraints);
      const stream = await navigator.mediaDevices.getUserMedia(enhancedConstraints);

      // Log what we actually got
      const tracks = stream.getTracks();
      console.log(`✅ [Meeting] Media access granted. Tracks: ${tracks.length}`);
      tracks.forEach(track => {
        console.log(`  ${track.kind}: ${track.label} (${track.enabled})`);
      });

      localStreamRef.current = stream;
      cameraStreamRef.current = stream;
      setLocalStreamState(stream);
      setIsInitialized(true);
      console.log('🎉 [Meeting] Local stream initialized successfully');
      return stream;
      
    } catch (error) {
      console.error('❌ [Meeting] Error accessing media devices:', error);
      
      if (error.name === 'NotAllowedError') {
        toast.error('Camera/microphone access denied. Please grant permissions.');
      } else if (error.name === 'NotFoundError') {
        toast.error('No camera or microphone found.');
      } else if (error.name === 'NotReadableError') {
        toast.error('Camera/microphone is already in use by another application.');
      } else if (error.name === 'OverconstrainedError') {
        toast.error('Camera/microphone does not support the requested quality settings.');
        // Try with basic constraints as fallback
        console.log('🔄 [Meeting] Retrying with basic constraints...');
        return initializeLocalStream({ video: true, audio: true });
      } else {
        toast.error('Failed to access media devices.');
      }
      
      throw error;
    }
  }, []);

  /**
   * Create and send offer to remote peer
   */
  const createOffer = useCallback(async (remoteUserId) => {
    try {
      setConnectionStatus(prev => (prev === 'connected' ? prev : 'connecting'));
      let peerConnection = peerConnectionsRef.current[remoteUserId];
      if (!peerConnection) {
        peerConnection = createPeerConnection(remoteUserId);
      }

      if (!peerConnection) {
        throw new Error('Failed to create peer connection');
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      console.log(`📤 [Meeting] Sending offer to ${remoteUserId}`);
      if (socketRef.current && isConnectedRef.current) {
        socketRef.current.emit('meeting_sdp_offer', {
          meetingId: meetingId,
          offer,
          to: remoteUserId
        });
        console.log(`✅ [Meeting] Offer sent successfully`);
      } else {
        console.error('❌ [Meeting] Socket not connected, cannot send offer');
      }
      
    } catch (error) {
      console.error('❌ Error creating offer:', error);
      toast.error('Failed to create connection offer');
    }
  }, [meetingId, createPeerConnection]);

  /**
   * Handle incoming offer from remote peer
   */
  const handleOffer = useCallback(async ({ fromUserId, offer }) => {
    try {
      setConnectionStatus(prev => (prev === 'connected' ? prev : 'connecting'));
      console.log(`📥 [Meeting] Received offer from ${fromUserId}`);
      let peerConnection = peerConnectionsRef.current[fromUserId];
      if (!peerConnection) {
        peerConnection = createPeerConnection(fromUserId);
      }

      if (!peerConnection) {
        throw new Error('Failed to create peer connection');
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      console.log(`✅ [Meeting] Remote description set for ${fromUserId}`);
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      console.log(`📤 [Meeting] Sending answer to ${fromUserId}`);
      if (socketRef.current && isConnectedRef.current) {
        socketRef.current.emit('meeting_sdp_answer', {
          meetingId: meetingId,
          answer,
          to: fromUserId
        });
        console.log(`✅ [Meeting] Answer sent successfully`);
      } else {
        console.error('❌ [Meeting] Socket not connected, cannot send answer');
      }
      
    } catch (error) {
      console.error('❌ [Meeting] Error handling offer:', error);
      toast.error('Failed to handle connection offer');
    }
  }, [meetingId, createPeerConnection]);

  /**
   * Handle incoming answer from remote peer
   */
  const handleAnswer = useCallback(async ({ fromUserId, answer }) => {
    try {
      console.log(`📥 [Meeting] Received answer from ${fromUserId}`);
      const peerConnection = peerConnectionsRef.current[fromUserId];
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ [Meeting] Answer set successfully for peer: ${fromUserId}`);
      } else {
        console.warn(`⚠️ [Meeting] No peer connection found for ${fromUserId}`);
      }
      
    } catch (error) {
      console.error('❌ [Meeting] Error handling answer:', error);
      toast.error('Failed to handle connection answer');
    }
  }, []);

  /**
   * Handle incoming ICE candidate
   */
  const handleIceCandidate = useCallback(async ({ fromUserId, candidate }) => {
    try {
      console.log(`🧊 [Meeting] Received ICE candidate from ${fromUserId}`);
      const peerConnection = peerConnectionsRef.current[fromUserId];
      if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`✅ [Meeting] ICE candidate added successfully for peer: ${fromUserId}`);
      } else {
        console.warn(`⚠️ [Meeting] No peer connection found for ${fromUserId}`);
      }
      
    } catch (error) {
      console.error('❌ [Meeting] Error handling ICE candidate:', error);
    }
  }, []);

  /**
   * Handle existing participants list when joining
   * New joiner receives this to know who's already in the meeting
   */
  const handleExistingParticipants = useCallback(async ({ participants }) => {
    console.log(`👥 [Meeting] Received ${participants.length} existing participants`);
    
    // Wait a bit for local stream to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Create offers to all existing participants
    for (const participant of participants) {
      if (participant.userId !== userId) {
        console.log(`🤝 [Meeting] Creating offer for existing participant: ${participant.userId}`);
        await createOffer(participant.userId);
      }
    }
  }, [userId, createOffer]);

  /**
   * Handle new user joining the meeting
   * Existing users receive this when someone new joins
   */
  const handleUserJoined = useCallback(async ({ userId: newUserId, user }) => {
    if (newUserId !== userId) {
      console.log(`👥 [Meeting] New user joined: ${newUserId}`);
      
      // Wait a bit for the new user's stream to be ready
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Existing users DON'T create offer - they wait for the new user's offer
      // This prevents duplicate connections
      console.log(`⏳ [Meeting] Waiting for offer from new user ${newUserId}`);
    }
  }, [userId]);

  /**
   * Handle user leaving the meeting
   */
  const handleUserLeft = useCallback(({ userId: leftUserId }) => {
    console.log(`👋 [Meeting] User left: ${leftUserId}`);
    handleRemovePeer(leftUserId);
  }, [handleRemovePeer]);

  /**
   * Toggle audio track
   */
  const toggleAudio = useCallback((enabled) => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }, []);

  /**
   * Toggle video track
   */
  const toggleVideo = useCallback((enabled) => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }, []);

  /**
   * Start screen sharing
   */
  const startScreenShare = useCallback(async () => {
    try {
      // Try to capture system/tab audio when available; fall back gracefully
      let screenStream;
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      } catch (e) {
        console.warn('Screen share with audio not available, falling back to video-only');
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
      }

      const screenTrack = screenStream.getVideoTracks()[0];
      try { screenTrack.contentHint = 'detail'; } catch (_) {}

      // Replace or add video track in all peer connections, then renegotiate
      await Promise.all(Object.entries(peerConnectionsRef.current).map(async ([remoteUserId, peerConnection]) => {
        const senders = peerConnection.getSenders();
        let videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (!videoSender) {
          // Try via transceiver if sender exists without track
          const videoTransceiver = peerConnection.getTransceivers?.().find(t => t?.sender && (t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video'));
          if (videoTransceiver?.sender) videoSender = videoTransceiver.sender;
        }
        try {
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
          } else {
            peerConnection.addTrack(screenTrack, screenStream);
          }
        } catch (e) {
          console.warn('⚠️ [Meeting] replace/add track failed, will renegotiate anyway:', e);
        }
        // Force renegotiation to propagate new m-line if needed
        try { await createOffer(remoteUserId); } catch (e) { console.warn('⚠️ [Meeting] createOffer after share failed:', e); }
      }));

      // Update local preview to show screen on stage
      if (!cameraStreamRef.current) {
        cameraStreamRef.current = localStreamRef.current;
      }
      localStreamRef.current = screenStream;
      setLocalStreamState(screenStream);

      // Restore camera when user stops sharing
      screenTrack.onended = () => {
        stopScreenShare();
      };

      return screenStream;
      
    } catch (error) {
      console.error('❌ Error starting screen share:', error);
      toast.error('Failed to start screen sharing');
      throw error;
    }
  }, []);

  /**
   * Stop screen sharing
   */
  const stopScreenShare = useCallback(() => {
    if (localStreamRef.current) {
      // Restore camera video track
      const videoTrack = cameraStreamRef.current?.getVideoTracks()?.[0];
      
      // Replace screen track with camera track in all peer connections and renegotiate if needed
      Object.entries(peerConnectionsRef.current).forEach(async ([remoteUserId, peerConnection]) => {
        try {
          const senders = peerConnection.getSenders();
          let videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (!videoSender) {
            const videoTransceiver = peerConnection.getTransceivers?.().find(t => t?.sender && (t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video'));
            if (videoTransceiver?.sender) videoSender = videoTransceiver.sender;
          }
          if (videoSender && videoTrack) {
            await videoSender.replaceTrack(videoTrack);
          } else if (videoTrack) {
            peerConnection.addTrack(videoTrack, cameraStreamRef.current);
          }
          try { await createOffer(remoteUserId); } catch {}
        } catch (e) {
          console.warn('⚠️ [Meeting] restore camera failed:', e);
        }
      });

      // Update local preview back to camera
      if (cameraStreamRef.current) {
        localStreamRef.current = cameraStreamRef.current;
        setLocalStreamState(cameraStreamRef.current);
      }
    }
  }, []);

  /**
   * Cleanup all connections and streams
   */
  const cleanup = useCallback(() => {
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Close all peer connections
    Object.keys(peerConnectionsRef.current).forEach(remoteUserId => {
      handleRemovePeer(remoteUserId);
    });
    
    setIsInitialized(false);
    setConnectionStatus('disconnected');
    setRemoteStreams({});
    setLocalStreamState(null);
    setRemoteSharingUserId(null);
  }, [handleRemovePeer]);

  /**
   * Setup socket event listeners for WebRTC signaling
   */
  useEffect(() => {
    if (!socket || !isConnected || !meetingId) return;

    console.log('🔌 [Meeting] Setting up WebRTC signaling listeners for meeting:', meetingId);

    socket.on('existing-participants', handleExistingParticipants);
    socket.on('meeting_sdp_offer', handleOffer);
    socket.on('meeting_sdp_answer', handleAnswer);
    socket.on('meeting_ice_candidate', handleIceCandidate);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);

    return () => {
      console.log('🔌 [Meeting] Cleaning up WebRTC signaling listeners');
      socket.off('existing-participants', handleExistingParticipants);
      socket.off('meeting_sdp_offer', handleOffer);
      socket.off('meeting_sdp_answer', handleAnswer);
      socket.off('meeting_ice_candidate', handleIceCandidate);
      socket.off('user-joined', handleUserJoined);
      socket.off('user-left', handleUserLeft);
    };
  }, [socket, isConnected, meetingId, handleExistingParticipants, handleOffer, handleAnswer, handleIceCandidate, handleUserJoined, handleUserLeft]);

  /**
   * Join meeting call room via socket
   */
  const joinCallRoom = useCallback(() => {
    if (socketRef.current && isConnectedRef.current && meetingId) {
      // Allow rejoining even if hasJoinedCallRef is true (for page refresh scenarios)
      console.log('🔌 [Meeting] Joining WebRTC room:', meetingId);
      socketRef.current.emit('join_meeting_webrtc', { 
        meetingId: meetingId, 
        userId,
        user: { _id: userId, name: 'User' }
      });
      hasJoinedCallRef.current = true;
      // Socket is up and room joined; show ready state even if no peers yet
      setConnectionStatus('ready');
    }
  }, [meetingId, userId]);

  /**
   * Leave meeting call room via socket
   */
  const leaveCallRoom = useCallback(() => {
    if (socketRef.current && isConnectedRef.current && meetingId && hasJoinedCallRef.current) {
      console.log('🔌 [Meeting] Leaving WebRTC room:', meetingId);
      socketRef.current.emit('leave_meeting_webrtc', { meetingId: meetingId, userId });
      hasJoinedCallRef.current = false;
      cleanup();
    }
  }, [meetingId, userId, cleanup]);

  return {
    // State
    isInitialized,
    connectionStatus,
    localStream: localStreamState,
    remoteStreams,
    remoteSharingUserId,
    
    // Actions
    initializeLocalStream,
    createOffer,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    joinCallRoom,
    leaveCallRoom,
    cleanup
  };
};

export default useMeetingWebRTC;
