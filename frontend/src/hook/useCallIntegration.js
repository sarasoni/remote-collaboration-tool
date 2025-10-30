import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-hot-toast";
import {
  startCall,
  joinCall,
  endCall,
  getCallHistory,
  rejectCall,
  deleteCall,
  clearCallHistory,
  updateCallSettings,
  getCallById,
  markCallAsMissed,
  cleanupMissedCalls,
} from "../api/callApi";

import {
  setActiveCall,
  setIncomingCall,
  setOutgoingCall,
  setShowCallWindow,
  setShowIncomingCallModal,
  setShowOutgoingCallModal,
  resetCallState,
  addError,
  selectActiveCall,
  selectIncomingCall,
  selectOutgoingCall,
  setCallStatus,
  setRingingState,
  setMinimizedCall,
  setLastCallMeta,
  selectCallStatus,
  selectRingingType,
  selectIsCallMinimized,
  selectCallMinimizedFromRoute,
  setLocalStream,
  setRemoteStream,
  selectIsMuted,
  selectIsVideoEnabled,
  setAcceptingCall,
  setJoiningCall,
  setConnecting,
  setConnectionProgress,
  selectIsAcceptingCall,
  selectIsJoiningCall,
  selectIsConnecting,
  selectConnectionProgress,
} from "../store/slice/callSlice";
import { useCallSocket } from "./useCallSocket";
import { navigateToLogin } from "../utils/navigation";
import { useWebRTC } from "./useWebRTC"; // For regular 1-on-1 or group calls (NOT meetings)

export const useCallIntegration = (options = {}) => {
  const { webRTCEnabled = true } = options;
  const dispatch = useDispatch();
  const queryClient = useQueryClient();

  const activeCall = useSelector(selectActiveCall);
  const incomingCall = useSelector(selectIncomingCall);
  const outgoingCall = useSelector(selectOutgoingCall);
  const callStatus = useSelector(selectCallStatus);
  const ringingType = useSelector(selectRingingType);
  const isCallMinimized = useSelector(selectIsCallMinimized);
  const minimizedFromRoute = useSelector(selectCallMinimizedFromRoute);
  const isMuted = useSelector(selectIsMuted);
  const isVideoEnabled = useSelector(selectIsVideoEnabled);
  const { user } = useSelector((state) => state.auth);

  const {
    callPersistData,
    startCallSocket,
    joinCallSocket,
    rejectCallSocket,
    cancelCallSocket,
    endCallSocket,
    endCall: endCallCleanup,
  } = useCallSocket();

  let localStream = null;
  let remoteStreams = {};
  let initializeLocalStream = async () => {};
  let toggleAudioTrack = () => {};
  let toggleVideoTrack = () => {};
  let startScreenShare = async () => {};
  let stopScreenShare = () => {};
  let joinCallRoom = () => {};
  let leaveCallRoom = () => {};
  let cleanupWebRTC = () => {};

  if (webRTCEnabled) {
    const webrtc = useWebRTC(activeCall?.callId || activeCall?._id, user?._id || user?.id);
    localStream = webrtc.localStream;
    remoteStreams = webrtc.remoteStreams;
    initializeLocalStream = webrtc.initializeLocalStream;
    toggleAudioTrack = webrtc.toggleAudio;
    toggleVideoTrack = webrtc.toggleVideo;
    startScreenShare = webrtc.startScreenShare;
    stopScreenShare = webrtc.stopScreenShare;
    joinCallRoom = webrtc.joinCallRoom;
    leaveCallRoom = webrtc.leaveCallRoom;
    cleanupWebRTC = webrtc.cleanup;
  }

  // =============== 📞 START CALL ==================
  const startCallMutation = useMutation({
    mutationFn: startCall,
    onMutate: () => {
      // Don't show loading toast - let the call UI handle feedback
    },
    onSuccess: async (data) => {
      // Don't show success toast - call UI shows the state
      const callData = data?.call || data;
      dispatch(setOutgoingCall(callData));
      dispatch(setActiveCall(callData));
      dispatch(setShowCallWindow(false));
      dispatch(setShowOutgoingCallModal(true));
      dispatch(setCallStatus("connecting"));
      dispatch(setRingingState({ type: "outgoing", isRinging: true }));

      // Initialize WebRTC immediately when call starts
      if (webRTCEnabled) {
        try {
          console.log('🎬 Initializing local stream for outgoing call...');
          await initializeLocalStream();
          console.log('✅ Local stream initialized, joining call room...');
          joinCallRoom();
        } catch (error) {
          console.error('❌ Failed to initialize media:', error);
          toast.error('Failed to access camera/microphone');
        }
      }

      // Socket 'start_call' not needed; REST startCall now emits events server-side
      queryClient.invalidateQueries(["callHistory"]);
    },
    onError: (error) => {
      toast.error(error.message, { id: "start-call" });
      dispatch(addError(error.message));
    },
  });

  const initiateCall = useCallback(
    async (input, callType = "video", participantIds = [], recipientLocation = null) => {
      if (!user) {
        toast.error("Please sign in to start a call");
        navigateToLogin();
        return;
      }
      let payload = {};

      if (typeof input === "string") {
        payload = {
          chatId: input,
          callType,
        };
        if (Array.isArray(participantIds) && participantIds.length > 0) {
          payload.participants = participantIds;
        }
      } else if (Array.isArray(input)) {
        payload = {
          callType,
          participants: input,
        };
      } else if (input && typeof input === "object") {
        payload = {
          callType,
          ...input,
        };
        if (input.callType) {
          payload.callType = input.callType;
        }
        if (input.participants) {
          payload.participants = input.participants;
        } else if (Array.isArray(participantIds) && participantIds.length > 0) {
          payload.participants = participantIds;
        }
      } else {
        throw new Error("Invalid call initiation parameters");
      }

      if (!payload.chatId) {
        throw new Error("chatId is required to start a call");
      }

      if (!payload.callType) {
        payload.callType = callType || "video";
      }

      // Show info toast if recipient is not on chat page
      if (recipientLocation && !recipientLocation.startsWith('/chat')) {
        toast('ℹ️ Recipient is not on chat page, but they will receive the call notification!', {
          duration: 4000,
          style: {
            background: '#3B82F6',
            color: '#fff'
          }
        });
      }

      return startCallMutation.mutateAsync(payload);
    },
    [startCallMutation, user]
  );

  // =============== 👥 JOIN CALL ==================
  const joinCallMutation = useMutation({
    mutationFn: joinCall,
    onMutate: () => {
      // Set loading states when accepting call
      dispatch(setAcceptingCall(true));
      dispatch(setJoiningCall(true));
      dispatch(setConnectionProgress('Fetching call data...'));
      console.log('📡 Fetching call data from server...');
    },
    onSuccess: async (data) => {
      console.log('✅ Call data received:', data);
      
      // Update progress
      dispatch(setConnectionProgress('Call data loaded, initializing...'));
      
      dispatch(setActiveCall(data));
      dispatch(setShowCallWindow(true));
      dispatch(setShowIncomingCallModal(false));
      dispatch(setCallStatus("connected"));
      dispatch(setRingingState({ type: null, isRinging: false }));

      // Initialize WebRTC when joining call
      if (webRTCEnabled) {
        try {
          console.log('🎬 Initializing local stream before joining call room...');
          dispatch(setConnectionProgress('Accessing camera and microphone...'));
          await initializeLocalStream();
          
          console.log('✅ Local stream initialized, now joining call room...');
          dispatch(setConnectionProgress('Connecting to call...'));
          joinCallRoom();
          
          // Clear loading states after successful connection
          setTimeout(() => {
            dispatch(setAcceptingCall(false));
            dispatch(setJoiningCall(false));
            dispatch(setConnectionProgress(null));
          }, 1000);
        } catch (error) {
          console.error('❌ Failed to initialize media:', error);
          toast.error('Failed to access camera/microphone');
          dispatch(setAcceptingCall(false));
          dispatch(setJoiningCall(false));
          dispatch(setConnectionProgress(null));
        }
      } else {
        // Clear loading states if WebRTC not enabled
        dispatch(setAcceptingCall(false));
        dispatch(setJoiningCall(false));
        dispatch(setConnectionProgress(null));
      }

      joinCallSocket(data?.call?._id || data?.callId || data?._id);
    },
    onError: (error) => {
      toast.error(error.message, { id: "join-call" });
      dispatch(addError(error.message));
      
      // Clear loading states on error
      dispatch(setAcceptingCall(false));
      dispatch(setJoiningCall(false));
      dispatch(setConnectionProgress(null));
    },
  });

  // =============== 🛑 END CALL ==================
  const endCallMutation = useMutation({
    mutationFn: endCall,
    onMutate: () => toast.loading("Ending call...", { id: "end-call" }),
    onSuccess: () => {
      toast.success("Call ended", { id: "end-call" });
      
      // Clean up WebRTC streams and connections
      if (webRTCEnabled) cleanupWebRTC();
      
      // Clean up socket and state
      dispatch(resetCallState());
      dispatch(setCallStatus("idle"));
      dispatch(setRingingState({ type: null, isRinging: false }));
      dispatch(setLocalStream(null));
      dispatch(setRemoteStream(null));
      
      queryClient.invalidateQueries(["callHistory"]);
      endCallCleanup();
      if (webRTCEnabled) leaveCallRoom();
    },
    onError: (error) => {
      toast.error(error.message, { id: "end-call" });
      dispatch(addError(error.message));
      
      // Clean up even on error
      if (webRTCEnabled) cleanupWebRTC();
      leaveCallRoom();
    },
  });

  // Wrapper to properly extract callId before calling endCall
  const handleEndCall = useCallback(
    async (callIdParam) => {
      // Extract callId from various sources
      const callId = 
        callIdParam || 
        activeCall?._id || 
        activeCall?.callId || 
        outgoingCall?._id || 
        outgoingCall?.callId ||
        incomingCall?._id ||
        incomingCall?.callId;

      if (!callId) {
        console.error('❌ No callId available to end call');
        toast.error('Unable to end call: No call ID found');
        // Still clean up local state
        dispatch(resetCallState());
        dispatch(setCallStatus("idle"));
        return;
      }

      console.log('📞 Ending call with ID:', callId);
      return endCallMutation.mutateAsync(callId);
    },
    [activeCall, outgoingCall, incomingCall, endCallMutation, dispatch]
  );

  // =============== 🚫 REJECT CALL ==================
  const rejectCallMutation = useMutation({
    mutationFn: rejectCall,
    onSuccess: () => {
      const callId = incomingCall?._id || incomingCall?.callId || activeCall?._id || activeCall?.callId;
      console.log('✅ Reject call success, calling socket with callId:', callId);
      
      // Clean up WebRTC if initialized
      if (webRTCEnabled) cleanupWebRTC();
      
      rejectCallSocket(callId);
    },
    onError: (error) => {
      console.error('❌ Reject call error:', error);
      toast.error(error.message);
      dispatch(addError(error.message));
      
      // Clean up even on error
      cleanupWebRTC();
    },
  });

  // =============== ⚙️ UPDATE CALL SETTINGS ==================
  const updateSettingsMutation = useMutation({
    mutationFn: ({ callId, settings }) => updateCallSettings(callId, settings),
    onSuccess: () => {
      toast.success("Call settings updated");
    },
    onError: (error) => {
      toast.error(error.message);
      dispatch(addError(error.message));
    },
  });

  // =============== 📜 CALL HISTORY ==================
  const callHistoryQuery = useQuery({
    queryKey: ["callHistory"],
    queryFn: () => getCallHistory(),
    onError: (error) => {
      toast.error("Failed to load call history");
      dispatch(addError(error.message));
    },
  });

  // =============== 🧹 CLEAR CALL HISTORY ==================
  const clearHistoryMutation = useMutation({
    mutationFn: clearCallHistory,
    onSuccess: () => {
      toast.success("Call history cleared");
      queryClient.invalidateQueries(["callHistory"]);
    },
    onError: (error) => {
      toast.error(error.message);
      dispatch(addError(error.message));
    },
  });

  // =============== ❌ DELETE CALL ==================
  const deleteCallMutation = useMutation({
    mutationFn: deleteCall,
    onSuccess: () => {
      toast.success("Call deleted");
      queryClient.invalidateQueries(["callHistory"]);
    },
    onError: (error) => {
      toast.error(error.message);
      dispatch(addError(error.message));
    },
  });

  // =============== 📞 MISSED CALLS ==================
  const missedCallMutation = useMutation({
    mutationFn: markCallAsMissed,
    onSuccess: () => {
      toast("Marked as missed");
    },
    onError: (error) => {
      toast.error(error.message);
      dispatch(addError(error.message));
    },
  });

  const cleanupMissedCallsMutation = useMutation({
    mutationFn: cleanupMissedCalls,
    onSuccess: () => toast.success("Missed calls cleaned up"),
    onError: (error) => {
      toast.error(error.message);
      dispatch(addError(error.message));
    },
  });
  const fetchCallById = async (callId) => {
    try {
      const data = await getCallById(callId);
      dispatch(setActiveCall(data));

      // Re-initialize media streams if call is active
      if (webRTCEnabled && data && data.status === 'active') {
        try {
          await initializeLocalStream();
          joinCallRoom();
        } catch (error) {
          console.error('Failed to re-initialize media after fetch:', error);
        }
      }

      return data;
    } catch (error) {
      toast.error(error.message);
      dispatch(addError(error.message));
      return null;
    }
  };

  // =============== 🔍 CONSOLE LOGGING - Redux State Changes ==================
  useEffect(() => {
    console.group('🔄 CALL INTEGRATION - State Update');
    console.log('👤 User:', user);
    console.log('🔴 Active Call:', activeCall);
    console.log('📥 Incoming Call:', incomingCall);
    console.log('📤 Outgoing Call:', outgoingCall);
    console.log('📊 Call Status:', callStatus);
    console.log('🎥 Local Stream:', localStream ? 'Available' : 'None');
    console.log('🎥 Remote Streams:', Object.keys(remoteStreams).length);
    console.log('🔇 Is Muted:', isMuted);
    console.log('📹 Is Video Enabled:', isVideoEnabled);
    console.groupEnd();
  }, [user, activeCall, incomingCall, outgoingCall, callStatus, localStream, remoteStreams, isMuted, isVideoEnabled]);

  // =============== 🧹 CLEANUP ON UNMOUNT OR CALL END ==================
  useEffect(() => {
    return () => {
      // Cleanup only by the media owner
      if (webRTCEnabled) {
        console.log('🧹 useCallIntegration unmounting - cleaning up');
        cleanupWebRTC();
      }
    };
  }, [webRTCEnabled, cleanupWebRTC]);

  // Cleanup when activeCall becomes null (call ended)
  useEffect(() => {
    if (webRTCEnabled && !activeCall && localStream) {
      console.log('🧹 Active call cleared - cleaning up streams');
      cleanupWebRTC();
    }
  }, [webRTCEnabled, activeCall, localStream, cleanupWebRTC]);

  // =============== 🧩 RETURN ALL ACTIONS ==================
  return {
    user,
    activeCall,
    incomingCall,
    outgoingCall,
    
    // UI State
    showIncomingCall: !!incomingCall && callStatus === 'incoming',
    showOutgoingCall: !!outgoingCall && (callStatus === 'outgoing' || callStatus === 'connecting'),
    showActiveCall: !!activeCall && callStatus === 'connected',
    callStatus,
    localStream,
    remoteStream: Object.values(remoteStreams)[0] || null, // Get first remote stream
    remoteStreams,
    isMuted,
    isVideoEnabled,
    isScreenSharing: false,
    participants: [],

    // Queries
    callHistory: callHistoryQuery.data || [],
    isLoadingHistory:
      callHistoryQuery.isLoading || callHistoryQuery.isFetching,
    error: callHistoryQuery.error,
    refetch: callHistoryQuery.refetch,

    // Mutations
    startCall: initiateCall,
    joinCall: joinCallMutation.mutateAsync,
    acceptCall: joinCallMutation.mutateAsync, // Alias for joinCall
    endCall: handleEndCall, // Use wrapper that properly extracts callId
    rejectCall: rejectCallMutation.mutateAsync,
    cancelCall: (callId) => cancelCallSocket(callId || outgoingCall?._id || outgoingCall?.callId),
    deleteCall: deleteCallMutation.mutateAsync,
    clearHistory: clearHistoryMutation.mutateAsync,
    markAsMissed: missedCallMutation.mutateAsync,
    cleanupMissed: cleanupMissedCallsMutation.mutateAsync,
    updateCallSettings: updateSettingsMutation.mutateAsync,
    fetchCallById,
    
    // WebRTC actions
    toggleMute: toggleAudioTrack,
    toggleVideo: toggleVideoTrack,
    toggleScreenShare: startScreenShare,
    endActiveCall: handleEndCall, // Use wrapper for consistency

    isStarting: startCallMutation.isLoading,
    isJoining: joinCallMutation.isLoading,
    isEnding: endCallMutation.isLoading,
    isUpdatingSettings: updateSettingsMutation.isLoading,
    isDeleting: deleteCallMutation.isLoading,
    isClearing: clearHistoryMutation.isLoading,
  };
};

export const useCall = (options = {}) => {
  const integration = useCallIntegration(options);
  const {
    user,
    callHistory,
    isLoadingHistory,
    error,
    refetch,
    deleteCall,
    clearHistory,
    isDeleting,
    isClearing,
  } = integration;

  const [filter, setFilter] = useState("all");

  const filteredCalls = useMemo(() => {
    if (!Array.isArray(callHistory)) return [];
    return callHistory.filter((call) => {
      if (!call || filter === "all") return true;
      if (filter === "missed") {
        return call.status === "missed";
      }
      const starterId = call.startedBy?._id || call.startedBy;
      const currentUserId = user?._id || user?.id;
      if (!starterId || !currentUserId) return true;
      if (filter === "outgoing") {
        return String(starterId) === String(currentUserId);
      }
      if (filter === "incoming") {
        return String(starterId) !== String(currentUserId);
      }
      return true;
    });
  }, [callHistory, filter, user?._id, user?.id]);

  const pagination = useMemo(
    () => ({ total: filteredCalls.length }),
    [filteredCalls.length]
  );

  const handleDeleteCall = useCallback(
    async (callId) => {
      if (!callId) return;
      await deleteCall(callId);
      await refetch();
    },
    [deleteCall, refetch]
  );

  const handleClearAll = useCallback(async () => {
    await clearHistory();
    await refetch();
  }, [clearHistory, refetch]);

  const formatDuration = useCallback((seconds) => {
    const total = Number(seconds) || 0;
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    if (mins <= 0) return `${secs}s`;
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  }, []);

  const formatDate = useCallback((date) => {
    if (!date) return "";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleString();
  }, []);

  const getCallIcon = useCallback((call, currentUserId) => {
    if (!call) return "outgoing";
    if (call.status === "missed") return "missed";
    const starterId = call.startedBy?._id || call.startedBy;
    if (starterId && currentUserId) {
      return String(starterId) === String(currentUserId)
        ? "outgoing"
        : "incoming";
    }
    return "outgoing";
  }, []);

  const getOtherParticipant = useCallback((call, currentUserId) => {
    if (!call) {
      return { name: "Unknown", isGroup: false };
    }
    if (call.type === "group") {
      return {
        name: call.chat?.name || "Group Call",
        isGroup: true,
      };
    }
    const participants = call.participants || [];
    const others = participants
      .map((entry) => entry?.user || entry)
      .filter((participant) => {
        const id = participant?._id || participant?.id || participant?.userId;
        return id && String(id) !== String(currentUserId);
      });

    const fallback = call.startedBy || others[0];
    if (!fallback) {
      return { name: "Unknown", isGroup: false };
    }

    return {
      ...fallback,
      _id: fallback._id || fallback.id || fallback.userId,
      name:
        fallback.name ||
        fallback.displayName ||
        fallback.fullName ||
        "Unknown",
      isGroup: false,
    };
  }, []);

  const getCallTitle = useCallback(
    (call, currentUserId) => {
      if (!call) return "Call";
      if (call.type === "group") {
        return call.chat?.name || "Group Call";
      }
      const participant = getOtherParticipant(call, currentUserId);
      return participant.name;
    },
    [getOtherParticipant]
  );

  return {
    ...integration,
    calls: filteredCalls,
    filter,
    setFilter,
    pagination,
    isLoading: isLoadingHistory,
    error,
    refetch,
    handleDeleteCall,
    handleClearAll,
    formatDuration,
    formatDate,
    getCallIcon,
    getOtherParticipant,
    getCallTitle,
    isDeleting,
    isClearing,
  };
};
