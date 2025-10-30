import { useEffect, useCallback, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useSocket } from "./useSocket";
import { CALL_CONFIG } from "../config/environment";
import {
  setActiveCall,
  setOutgoingCall,
  setIncomingCall,
  setShowIncomingCallModal,
  setShowOutgoingCallModal,
  setShowCallWindow,
  setLocalStream,
  setRemoteStream,
  setCallStatus as setCallStatusAction,
  setRingingState,
  setMinimizedCall,
  setLastCallMeta,
  resetCallState,
  setAcceptingCall,
  setJoiningCall,
  setConnecting,
  setConnectionProgress,
  selectActiveCall,
  selectOutgoingCall,
  selectIncomingCall,
  selectShowIncomingCallModal,
  selectShowOutgoingCallModal,
  selectShowCallWindow,
  selectCallStatus,
  selectRingingType,
  selectIsCallMinimized,
  selectCallMinimizedFromRoute,
} from "../store/slice/callSlice";

export const useCallSocket = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { socket } = useSocket();
  const { user } = useSelector((state) => state.auth);

  // Refs (must come first)
  const callTimeoutRef = useRef(null);
  const participantCheckIntervalRef = useRef(null);
  const connectingTimeoutRef = useRef(null);
  const incomingCallAudioRef = useRef(null);
  const outgoingCallAudioRef = useRef(null);
  const audioInitializedRef = useRef(false);

  // Redux state
  const activeCall = useSelector(selectActiveCall);
  const outgoingCall = useSelector(selectOutgoingCall);
  const incomingCall = useSelector(selectIncomingCall);
  const callStatus = useSelector(selectCallStatus);
  const ringingType = useSelector(selectRingingType);
  const isCallMinimized = useSelector(selectIsCallMinimized);
  const minimizedFromRoute = useSelector(selectCallMinimizedFromRoute);

  // Local state
  const [callPersistData, setCallPersistData] = useState(null);
  // Use refs to prevent race conditions between rapid events
  const processedCallIdsRef = useRef(new Set());
  const lastEventTimeRef = useRef({});
  const lastNavigatedCallIdRef = useRef(null);
  const [hasShownIncomingToast, setHasShownIncomingToast] = useState(false);

  /** ✅ Ensure socket is connected before emit */
  const ensureSocketConnection = useCallback(async () => {
    if (!socket) throw new Error("Socket not available");
    if (socket.disconnected) {
      socket.connect();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Socket reconnection timeout")),
          4000
        );
        socket.once("connect", () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once("connect_error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    }
  }, [socket]);

  /** ✅ Timeout handling helpers */
  const startConnectingTimeout = useCallback(() => {
    clearTimeout(connectingTimeoutRef.current);
    connectingTimeoutRef.current = setTimeout(() => {
      console.warn("⚠️ Connecting timeout triggered — resetting call");
      endCall();
    }, 30000);
  }, []);

  const clearAllTimers = useCallback(() => {
    [callTimeoutRef, participantCheckIntervalRef, connectingTimeoutRef].forEach(
      (ref) => {
        if (ref.current) {
          clearTimeout(ref.current);
          clearInterval(ref.current);
          ref.current = null;
        }
      }
    );
  }, []);

  /** ✅ Ringtone helpers */
  const stopIncomingRingtone = useCallback(() => {
    const audio = incomingCallAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const stopOutgoingRingtone = useCallback(() => {
    const audio = outgoingCallAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const stopAllRingtones = useCallback(() => {
    stopIncomingRingtone();
    stopOutgoingRingtone();
  }, [stopIncomingRingtone, stopOutgoingRingtone]);

  const playAudioSafe = useCallback(async (audioRef) => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      await audio.play();
    } catch (error) {
      // Autoplay might be blocked until user interaction; ignore
    }
  }, []);

  const playIncomingRingtone = useCallback(() => {
    dispatch(setRingingState({ type: "incoming", isRinging: true }));
    playAudioSafe(incomingCallAudioRef);
  }, [dispatch, playAudioSafe]);

  const playOutgoingRingtone = useCallback(() => {
    dispatch(setRingingState({ type: "outgoing", isRinging: true }));
    playAudioSafe(outgoingCallAudioRef);
  }, [dispatch, playAudioSafe]);

  /** ✅ Save call data to state (no localStorage) */
  const saveCallData = useCallback((data) => {
    setCallPersistData(data);
  }, []);

  /** ✅ End call cleanly */
  const endCall = useCallback(() => {
    console.log('🛑 Ending call - cleaning up all resources');
    clearAllTimers();
    dispatch(resetCallState());
    dispatch(setCallStatusAction("idle"));
    dispatch(setRingingState({ type: null, isRinging: false }));
    dispatch(setMinimizedCall({ minimized: false }));
    dispatch(setLocalStream(null));
    dispatch(setRemoteStream(null));
    saveCallData(null);
    stopAllRingtones();
    processedCallIdsRef.current = new Set();
    lastEventTimeRef.current = {};
    if (location.pathname.includes("/video-call")) navigate(-1);
  }, [clearAllTimers, dispatch, navigate, location.pathname, saveCallData, stopAllRingtones]);

  /** ✅ Prevent duplicate socket events */
  const isDuplicateEvent = useCallback((type, callId) => {
    if (!callId) return false;
    const key = `${type}_${callId}`;
    const now = Date.now();
    const last = lastEventTimeRef.current[key] || 0;
    const timeSinceLastEvent = now - last;
    // Duplicate if within 5s or already processed for this lifecycle
    if (timeSinceLastEvent < 5000 || processedCallIdsRef.current.has(callId)) {
      console.warn(`⚠️ Duplicate ${type} event detected for callId: ${callId} (${timeSinceLastEvent}ms since last)`);
      return true;
    }
    processedCallIdsRef.current.add(callId);
    lastEventTimeRef.current[key] = now;
    return false;
  }, []);

  /** ✅ Socket event handlers */
  const handleIncomingCall = useCallback(
    (data) => {
      const callId = data.callId || data._id || `incoming_${Date.now()}`;
      
      // 🔍 CONSOLE LOG - Incoming Call Event
      console.group('📥 INCOMING CALL EVENT');
      console.log('📞 Call ID:', callId);
      console.log('👤 From User:', data.fromUserName);
      console.log('🆔 From User ID:', data.fromUserId);
      console.log('📊 Call Data:', data);
      console.groupEnd();
      
      // Prevent duplicate events and repeated modal for same callId
      if (isDuplicateEvent('incoming_call', callId)) return;
      const existing = incomingCall?.callId || incomingCall?._id;
      if (existing && String(existing) === String(callId)) return;
      
      console.log('📞 Incoming call received:', data);
      
      // Set loading state for callee (2 seconds to load calling details)
      dispatch(setJoiningCall(true));
      dispatch(setConnectionProgress('Loading call details...'));
      
      // Check if user is on chat page
      const currentPage = window.location.pathname;
      const isOnChatPage = currentPage.startsWith('/chat');
      
      // Normalize caller identity with robust fallbacks
      const fromUserId = data.fromUserId || data.call?.startedBy?._id || data.call?.startedBy || null;
      const fromUserName = data.fromUserName || data.call?.startedBy?.name || 'Unknown User';
      const fromUserAvatar = (data.fromUserAvatar !== undefined ? data.fromUserAvatar : (data.call?.startedBy?.avatar || null)) || null;
      const normalizedIncoming = {
        ...data,
        callId,
        fromUserId,
        fromUserName,
        fromUserAvatar,
        ringing: true,
        createdAt: data.createdAt || new Date().toISOString(),
      };
      
      // Simulate 2 second loading for callee to fetch and display call details
      setTimeout(() => {
        console.log('✅ Call details loaded');
        dispatch(setConnectionProgress('Call details loaded'));
        
        // Clear loading after brief display
        setTimeout(() => {
          dispatch(setJoiningCall(false));
          dispatch(setConnectionProgress(null));
        }, 500);
      }, 2000);

      dispatch(setIncomingCall(normalizedIncoming));
      dispatch(setShowIncomingCallModal(true));
      dispatch(setCallStatusAction("incoming"));
      dispatch(setLastCallMeta({ type: "incoming", callId, from: fromUserName }));
      // Persist full incoming payload for accurate restore
      saveCallData({ 
        callId, 
        status: "incoming", 
        incoming: normalizedIncoming
      });
      playIncomingRingtone();

      // Show notification based on current location
      if (!hasShownIncomingToast) {
        if (isOnChatPage) {
          toast.success(`Incoming video call from ${data.fromUserName}`, {
            duration: 5000,
            icon: '📞'
          });
        } else {
          toast(`📞 Incoming call from ${data.fromUserName}\\nYou can answer from any page!`, {
            duration: 8000,
            style: {
              background: '#4F46E5',
              color: '#fff',
              fontWeight: '500'
            }
          });
        }
        setHasShownIncomingToast(true);
      }
    },
    [dispatch, isDuplicateEvent, saveCallData, hasShownIncomingToast, playIncomingRingtone]
  );

  const handleCallStarted = useCallback(
    (data) => {
      const callId = data.call?._id || data.callId;
      if (isDuplicateEvent("call_started", callId)) return;

      // Set loading state for caller (1 second when dependencies change)
      dispatch(setConnecting(true));
      dispatch(setConnectionProgress('Initiating call...'));
      
      dispatch(setOutgoingCall(data));
      dispatch(setShowOutgoingCallModal(true));
      dispatch(setCallStatusAction("connecting"));
      dispatch(setLastCallMeta({ type: "outgoing", callId }));
      saveCallData({ callId, status: "connecting" });
      startConnectingTimeout();
      playOutgoingRingtone();
      
      // Clear loading after 1 second
      setTimeout(() => {
        dispatch(setConnecting(false));
        dispatch(setConnectionProgress(null));
      }, 1000);
    },
    [dispatch, isDuplicateEvent, saveCallData, startConnectingTimeout, playOutgoingRingtone]
  );

  const handleCallJoined = useCallback(
    (data) => {
      const callId = data.call?._id || data.callId;
      
      // 🔍 CONSOLE LOG - Call Joined Event
      console.group('✅ CALL JOINED EVENT');
      console.log('📞 Call ID:', callId);
      console.log('📊 Call Data:', data.call);
      console.log('👥 Participants:', data.call?.participants);
      console.log('🔄 Status: Connected');
      console.groupEnd();
      
      if (isDuplicateEvent("call_joined", callId)) return;

      // Update call object with connected status
      const updatedCall = {
        ...data.call,
        status: 'ongoing', // Ensure status is ongoing/connected
      };

      // Update all call-related state for both caller and callee
      dispatch(setActiveCall(updatedCall));
      dispatch(setOutgoingCall(null)); // Clear outgoing call
      dispatch(setIncomingCall(null)); // Clear incoming call  
      dispatch(setCallStatusAction("connected"));
      dispatch(setShowIncomingCallModal(false));
      dispatch(setShowOutgoingCallModal(false));
      dispatch(setShowCallWindow(true));
      dispatch(setRingingState({ type: null, isRinging: false }));
      
      // Clear loading states
      dispatch(setAcceptingCall(false));
      dispatch(setJoiningCall(false));
      dispatch(setConnecting(false));
      dispatch(setConnectionProgress(null));
      
      stopAllRingtones();
      saveCallData({ callId, status: "connected" });
      clearTimeout(connectingTimeoutRef.current);
      // Determine peer (other participant) id for route; navigate only once per callId
      if (lastNavigatedCallIdRef.current !== callId) {
        lastNavigatedCallIdRef.current = callId;
        try {
          const meId = (user && (user._id || user.id)) || null;
          const participants = data.call?.participants || [];
          const pickId = (p) => p?.userId || p?.user?._id || p?.user?._id || p?._id || p?.id || null;
          const others = participants
            .map(p => pickId(p))
            .filter(id => id && (!meId || String(id) !== String(meId)));
          const peerId = others[0] || data.call?.startedBy || data.call?.callerId || data.call?.receiverId;
          if (peerId) {
            navigate(`/video-call/${peerId}`, { replace: true });
          } else {
            navigate('/video-call', { replace: true });
          }
        } catch {
          navigate('/video-call', { replace: true });
        }
      }
    },
    [dispatch, isDuplicateEvent, navigate, saveCallData, stopAllRingtones, user]
  );

  const handleCallEnded = useCallback(
    (data) => {
      const callId = data.callId || data.call?._id;
      const reason = data.reason || "ended";
      
      // Prevent duplicate call ended events
      if (isDuplicateEvent('call_ended', callId)) {
        return;
      }
      
      console.log('📞 Call ended event received:', reason);
      
      // Clear state immediately to prevent UI flicker
      stopAllRingtones();
      clearAllTimers();
      
      // Reset all call-related state
      dispatch(resetCallState());
      dispatch(setCallStatusAction("idle"));
      dispatch(setRingingState({ type: null, isRinging: false }));
      dispatch(setLocalStream(null));
      dispatch(setRemoteStream(null));
      dispatch(setShowIncomingCallModal(false));
      dispatch(setShowOutgoingCallModal(false));
      dispatch(setShowCallWindow(false));
      
      saveCallData(null);
      processedCallIdsRef.current = new Set();
      lastEventTimeRef.current = {};
      
      // Show toast notification only once
      if (reason === "rejected") toast.error("Call rejected");
      else if (reason === "missed") toast("Call missed", { icon: "⏰" });
      else if (reason === "timeout") toast.error("Call timed out");
      else toast.success("Call ended");

      // Navigate away from video call page
      if (location.pathname.includes("/video-call")) {
        navigate("/chat");
      }
    },
    [dispatch, stopAllRingtones, clearAllTimers, saveCallData, location.pathname, navigate, isDuplicateEvent]
  );

  const handleCallAccepted = useCallback(
    (data) => {
      console.log('🎯 handleCallAccepted TRIGGERED!', data);
      const callId = data.call?._id || data.callId;
      
      // 🔍 CONSOLE LOG - Call Accepted Event
      console.group('✅ CALL ACCEPTED EVENT - CALLER SIDE');
      console.log('📞 Call ID:', callId);
      console.log('📊 Call Data:', data.call);
      console.log('👤 Accepted By:', data.acceptedByName);
      console.log('🔄 Current Status:', callStatus);
      console.log('🔄 New Status: Connected');
      console.log('📤 Outgoing Call Before:', outgoingCall);
      console.log('📥 Incoming Call Before:', incomingCall);
      console.groupEnd();
      
      if (isDuplicateEvent("call_accepted", callId)) return;
      
      // Update call object with connected status
      const updatedCall = {
        ...data.call,
        status: 'ongoing', // Update status to ongoing/connected
      };
      
      // Update all call-related state for caller
      dispatch(setActiveCall(updatedCall));
      dispatch(setOutgoingCall(null)); // Clear outgoing call
      dispatch(setIncomingCall(null)); // Clear incoming call
      dispatch(setCallStatusAction("connected"));
      dispatch(setShowIncomingCallModal(false));
      dispatch(setShowOutgoingCallModal(false));
      dispatch(setShowCallWindow(true));
      dispatch(setRingingState({ type: null, isRinging: false }));
      
      // Clear loading states
      dispatch(setAcceptingCall(false));
      dispatch(setJoiningCall(false));
      dispatch(setConnecting(false));
      dispatch(setConnectionProgress(null));
      
      stopAllRingtones();
      saveCallData({ callId, status: "connected" });
      clearTimeout(connectingTimeoutRef.current);
      
      // Show toast notification to caller
      toast.success(`${data.acceptedByName || 'User'} accepted the call`, {
        duration: 2000,
        icon: '📞'
      });
      
      console.log('✅ Caller state updated to connected, navigating immediately...');
      
      // Navigate to video call page immediately (no delay)
      if (lastNavigatedCallIdRef.current !== callId) {
        lastNavigatedCallIdRef.current = callId;
        try {
          const meId = (user && (user._id || user.id)) || null;
          const participants = data.call?.participants || [];
          const pickId = (p) => p?.userId || p?.user?._id || p?.user?.id || p?._id || p?.id || null;
          const others = participants
            .map(p => pickId(p))
            .filter(id => id && (!meId || String(id) !== String(meId)));
          const peerId = others[0] || data.acceptedBy || data.call?.startedBy;
          if (peerId) {
            console.log('🚀 Navigating caller to /video-call/' + peerId);
            navigate(`/video-call/${peerId}`, { replace: true });
          } else {
            console.log('🚀 Navigating caller to /video-call');
            navigate('/video-call', { replace: true });
          }
        } catch (err) {
          console.error('❌ Navigation error:', err);
          navigate('/video-call', { replace: true });
        }
      }
    },
    [dispatch, saveCallData, stopAllRingtones, isDuplicateEvent, navigate, user, lastNavigatedCallIdRef, callStatus, outgoingCall, incomingCall]
  );

  const handleCallRejected = useCallback(
    (data) => {
      const { rejectedByName, callId } = data;
      
      console.log('❌ Call rejected by:', rejectedByName);
      
      toast.error(`${rejectedByName || "Participant"} rejected the call`);
      
      // Update call status to rejected
      dispatch(setCallStatusAction("rejected"));
      dispatch(setOutgoingCall(null));
      dispatch(setIncomingCall(null));
      dispatch(setActiveCall(null));
      dispatch(setRingingState({ type: null, isRinging: false }));
      dispatch(setShowIncomingCallModal(false));
      dispatch(setShowOutgoingCallModal(false));
      
      // Clear loading states
      dispatch(setConnecting(false));
      dispatch(setAcceptingCall(false));
      dispatch(setJoiningCall(false));
      dispatch(setConnectionProgress(null));
      
      stopAllRingtones();
      saveCallData({ callId, status: "rejected" });
      
      // End call after brief delay
      setTimeout(() => {
        dispatch(setCallStatusAction("idle"));
        endCall();
      }, 1000);
    },
    [dispatch, endCall, stopAllRingtones, saveCallData]
  );

  const handleCallCancelled = useCallback(
    (data) => {
      const { cancelledByName, message } = data;
      toast.error(message || `${cancelledByName ? cancelledByName : "Caller"} cancelled the call`);
      dispatch(setCallStatusAction("ended"));
      dispatch(setRingingState({ type: null, isRinging: false }));
      stopAllRingtones();
      endCall();
    },
    [dispatch, endCall, stopAllRingtones]
  );

  const handleSocketError = useCallback((err) => {
    console.error("Socket error:", err);
    toast.error(err?.message || "Call socket error");
  }, []);

  /** ✅ Socket listeners */
  useEffect(() => {
    if (!socket) return;
    // Bind listeners only once across multiple hook mounts
    if (!window.__CALL_SOCKET_BOUND__) {
      socket.on("incoming_call", handleIncomingCall);
      socket.on("call_started", handleCallStarted);
      socket.on("call_joined", handleCallJoined);
      socket.on("call_ended", handleCallEnded);
      socket.on("call_accepted", handleCallAccepted);
      socket.on("call_rejected", handleCallRejected);
      socket.on("call_cancelled", handleCallCancelled);
      socket.on("error", handleSocketError);
      window.__CALL_SOCKET_BOUND__ = true;
      // Initialize bind count when we first bind
      if (typeof window.__CALL_SOCKET_BIND_COUNT__ !== 'number') {
        window.__CALL_SOCKET_BIND_COUNT__ = 0;
      }
    }
    // Ensure counter is a number before incrementing
    if (typeof window.__CALL_SOCKET_BIND_COUNT__ !== 'number') {
      window.__CALL_SOCKET_BIND_COUNT__ = 0;
    }
    window.__CALL_SOCKET_BIND_COUNT__ += 1;

    return () => {
      // Decrement and unbind when last consumer unmounts
      if (typeof window.__CALL_SOCKET_BIND_COUNT__ !== 'number') {
        window.__CALL_SOCKET_BIND_COUNT__ = 0;
      } else {
        window.__CALL_SOCKET_BIND_COUNT__ -= 1;
      }
      if (window.__CALL_SOCKET_BIND_COUNT__ <= 0 && window.__CALL_SOCKET_BOUND__) {
        socket.off("incoming_call", handleIncomingCall);
        socket.off("call_started", handleCallStarted);
        socket.off("call_joined", handleCallJoined);
        socket.off("call_ended", handleCallEnded);
        socket.off("call_accepted", handleCallAccepted);
        socket.off("call_rejected", handleCallRejected);
        socket.off("call_cancelled", handleCallCancelled);
        socket.off("error", handleSocketError);
        window.__CALL_SOCKET_BOUND__ = false;
        window.__CALL_SOCKET_BIND_COUNT__ = 0;
      }
    };
  }, [
    socket,
    handleIncomingCall,
    handleCallStarted,
    handleCallJoined,
    handleCallEnded,
    handleCallAccepted,
    handleCallRejected,
    handleCallCancelled,
    handleSocketError,
  ]);

  /** ✅ Socket action methods */
  const startCallSocket = useCallback(
    async (chatId, type = "video") => {
      try {
        if (startCallInFlightRef.current) return;
        startCallInFlightRef.current = true;
        setTimeout(() => { startCallInFlightRef.current = false; }, 3000);
        await ensureSocketConnection();
        socket.emit("start_call", { chatId, type });
        // Don't show toast - call UI handles feedback
        startConnectingTimeout();
        dispatch(setCallStatusAction("connecting"));
        playOutgoingRingtone();
      } catch (err) {
        toast.error("Unable to start call");
      }
    },
    [socket, ensureSocketConnection, startConnectingTimeout, dispatch, playOutgoingRingtone]
  );

  const joinCallSocket = useCallback(
    async (callId) => {
      try {
        if (joinCallInFlightRef.current) return;
        joinCallInFlightRef.current = true;
        setTimeout(() => { joinCallInFlightRef.current = false; }, 3000);
        await ensureSocketConnection();
        socket.emit("join_call", { callId });
        toast.success("Joining call...");
        dispatch(setCallStatusAction("connecting"));
      } catch {
        toast.error("Unable to join call");
      }
    },
    [socket, ensureSocketConnection, dispatch]
  );

  const rejectCallSocket = useCallback(
    async (callId) => {
      try {
        if (!callId) {
          console.error('❌ No callId provided to reject');
          toast.error("Unable to reject call - no call ID");
          return;
        }
        
        console.log('🚫 Rejecting call:', callId);
        await ensureSocketConnection();
        socket.emit("reject_call", { callId });
        
        // Clean up immediately on client side
        dispatch(setIncomingCall(null));
        dispatch(setShowIncomingCallModal(false));
        dispatch(setCallStatusAction("ended"));
        dispatch(setRingingState({ type: null, isRinging: false }));
        stopAllRingtones();
        
        toast("Call rejected", { icon: "🚫" });
        
        // Clean up call state
        setTimeout(() => {
          endCall();
        }, 500);
      } catch (error) {
        console.error('❌ Error rejecting call:', error);
        toast.error("Unable to reject call");
      }
    },
    [socket, ensureSocketConnection, dispatch, endCall, stopAllRingtones]
  );

  const cancelCallSocket = useCallback(
    async (callId) => {
      try {
        if (!callId) {
          console.error('❌ No callId provided to cancel');
          toast.error("Unable to cancel call - no call ID");
          return;
        }
        
        console.log('🚫 Canceling outgoing call:', callId);
        await ensureSocketConnection();
        socket.emit("cancel_call", { callId });
        
        // Clean up immediately on client side
        dispatch(setOutgoingCall(null));
        dispatch(setShowOutgoingCallModal(false));
        dispatch(setCallStatusAction("ended"));
        dispatch(setRingingState({ type: null, isRinging: false }));
        stopAllRingtones();
        
        toast("Call cancelled", { icon: "🚫" });
        
        // Clean up call state
        setTimeout(() => {
          endCall();
        }, 500);
      } catch (error) {
        console.error('❌ Error canceling call:', error);
        toast.error("Unable to cancel call");
      }
    },
    [socket, ensureSocketConnection, dispatch, endCall, stopAllRingtones]
  );

  const endCallSocket = useCallback(
    async (callId) => {
      try {
        if (!callId) {
          console.error('❌ No callId provided to end');
          return;
        }
        
        console.log('📞 Ending call:', callId);
        await ensureSocketConnection();
        socket.emit("end_call", { callId });
        endCall();
      } catch (error) {
        console.error('❌ Error ending call:', error);
        toast.error("Failed to end call");
      }
    },
    [socket, ensureSocketConnection, endCall]
  );

  /** ✅ Restore call state from API on mount (similar to getCurrentUser) */
  useEffect(() => {
    const restoreCallState = async () => {
      try {
        // Import getCurrentCall dynamically to avoid circular dependency
        const { getCurrentCall } = await import('../api/callApi');
        
        console.log('🔄 Fetching current active call from API...');
        const response = await getCurrentCall();
        
        if (!response.success || !response.currentCall) {
          console.log('ℹ️ No active call found');
          return;
        }

        const { currentCall } = response;
        console.log('✅ Found active call:', currentCall);
        
        // Restore call state based on status and user's participation
        if (currentCall.status === 'ringing') {
          if (currentCall.isStartedByMe) {
            // User is the caller
            dispatch(setOutgoingCall(currentCall));
            dispatch(setShowOutgoingCallModal(true));
            dispatch(setCallStatusAction('connecting'));
            playOutgoingRingtone();
          } else {
            // User is the receiver
            dispatch(setIncomingCall(currentCall));
            dispatch(setShowIncomingCallModal(true));
            dispatch(setCallStatusAction('ringing'));
            playIncomingRingtone();
          }
        } else if (currentCall.status === 'ongoing' && currentCall.userStatus === 'joined') {
          // User has already joined the call
          dispatch(setActiveCall(currentCall));
          dispatch(setCallStatusAction('connected'));
          dispatch(setShowCallWindow(true));
        }
        
        saveCallData({ callId: currentCall._id, status: currentCall.status });
      } catch (error) {
        console.error('❌ Error restoring call state:', error);
      }
    };

    // Restore call state when socket connects and user is available
    if (socket && socket.connected && user) {
      restoreCallState();
    }
  }, [socket, dispatch, user, playIncomingRingtone, playOutgoingRingtone, saveCallData]);

  useEffect(() => clearAllTimers, [clearAllTimers]);

  useEffect(() => {
    if (!audioInitializedRef.current) {
      incomingCallAudioRef.current = new Audio("/sounds/incoming-call.mp3");
      incomingCallAudioRef.current.loop = true;
      outgoingCallAudioRef.current = new Audio("/sounds/outgoing-call.mp3");
      outgoingCallAudioRef.current.loop = true;
      audioInitializedRef.current = true;
    }

    return () => {
      stopAllRingtones();
    };
  }, [stopAllRingtones]);

  return {
    socket,
    callStatus,
    callPersistData,
    startCallSocket,
    joinCallSocket,
    rejectCallSocket,
    cancelCallSocket,
    endCallSocket,
    endCall,
  };
};
