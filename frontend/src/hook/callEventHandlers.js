import { toast } from 'react-hot-toast';

/**
 * Call Event Handlers - Modular Implementation
 * Centralized handlers for all call-related socket events
 * Ensures consistent behavior and easier maintenance
 */

// ============ HELPER FUNCTIONS ============

/**
 * Extract call ID from various data formats
 */
export const extractCallId = (data) => {
  return data?.call?._id || data?.callId;
};

/**
 * Check if event is duplicate to prevent double processing
 */
export const isDuplicateEvent = (processedEvents, eventType, callId, timeWindow = 1000) => {
  const key = `${eventType}_${callId}`;
  const now = Date.now();
  const lastTime = processedEvents.current[key];
  
  if (lastTime && (now - lastTime) < timeWindow) {
    console.log(`⚠️ Duplicate ${eventType} event detected for call ${callId}`);
    return true;
  }
  
  processedEvents.current[key] = now;
  return false;
};

/**
 * Navigate to video call page with proper peer ID
 */
export const navigateToVideoCall = (navigate, data, user, lastNavigatedCallIdRef) => {
  const callId = extractCallId(data);
  
  if (lastNavigatedCallIdRef.current === callId) {
    console.log('⏭️ Already navigated for this call, skipping');
    return;
  }
  
  lastNavigatedCallIdRef.current = callId;
  
  try {
    const meId = user?._id || user?.id;
    const participants = data.call?.participants || [];
    
    // Extract peer ID (other participant)
    const pickId = (p) => p?.userId || p?.user?._id || p?.user?.id || p?._id || p?.id;
    const others = participants
      .map(p => pickId(p))
      .filter(id => id && (!meId || String(id) !== String(meId)));
    
    const peerId = others[0] || data.acceptedBy || data.call?.startedBy;
    
    if (peerId) {
      console.log(`🚀 Navigating to /video-call/${peerId}`);
      navigate(`/video-call/${peerId}`, { replace: true });
    } else {
      console.log('🚀 Navigating to /video-call');
      navigate('/video-call', { replace: true });
    }
  } catch (err) {
    console.error('❌ Navigation error:', err);
    navigate('/video-call', { replace: true });
  }
};

// ============ EVENT HANDLER CREATORS ============

/**
 * Create handleIncomingCall handler
 */
export const createIncomingCallHandler = (dispatch, actions, helpers) => {
  const { processedEvents, saveCallData, playIncomingRingtone } = helpers;
  
  return (data) => {
    const callId = extractCallId(data);
    
    console.group('📥 INCOMING CALL EVENT');
    console.log('📞 Call ID:', callId);
    console.log('👤 From:', data.fromUserName);
    console.log('📊 Call Data:', data.call);
    console.groupEnd();
    
    if (isDuplicateEvent(processedEvents, 'incoming_call', callId)) return;
    
    dispatch(actions.setIncomingCall(data));
    dispatch(actions.setShowIncomingCallModal(true));
    dispatch(actions.setCallStatus('ringing'));
    dispatch(actions.setLastCallMeta({ type: 'incoming', callId }));
    saveCallData({ callId, status: 'ringing' });
    playIncomingRingtone();
  };
};

/**
 * Create handleCallStarted handler
 */
export const createCallStartedHandler = (dispatch, actions, helpers) => {
  const { processedEvents, saveCallData, startConnectingTimeout, playOutgoingRingtone } = helpers;
  
  return (data) => {
    const callId = extractCallId(data);
    
    console.group('📤 CALL STARTED EVENT');
    console.log('📞 Call ID:', callId);
    console.log('📊 Call Data:', data.call);
    console.groupEnd();
    
    if (isDuplicateEvent(processedEvents, 'call_started', callId)) return;
    
    dispatch(actions.setOutgoingCall(data));
    dispatch(actions.setShowOutgoingCallModal(true));
    dispatch(actions.setCallStatus('connecting'));
    dispatch(actions.setLastCallMeta({ type: 'outgoing', callId }));
    saveCallData({ callId, status: 'connecting' });
    startConnectingTimeout();
    playOutgoingRingtone();
  };
};

/**
 * Create handleCallJoined handler
 */
export const createCallJoinedHandler = (dispatch, actions, helpers, navigate, user, refs) => {
  const { processedEvents, saveCallData, stopAllRingtones, clearConnectingTimeout } = helpers;
  const { lastNavigatedCallIdRef } = refs;
  
  return (data) => {
    const callId = extractCallId(data);
    
    console.group('✅ CALL JOINED EVENT');
    console.log('📞 Call ID:', callId);
    console.log('📊 Call Data:', data.call);
    console.log('👥 Participants:', data.call?.participants);
    console.groupEnd();
    
    if (isDuplicateEvent(processedEvents, 'call_joined', callId)) return;
    
    // Clear all loading states
    dispatch(actions.setAcceptingCall(false));
    dispatch(actions.setJoiningCall(false));
    dispatch(actions.setConnecting(false));
    dispatch(actions.setConnectionProgress('Connected successfully'));
    
    dispatch(actions.setActiveCall(data.call));
    dispatch(actions.setCallStatus('connected'));
    dispatch(actions.setShowIncomingCallModal(false));
    dispatch(actions.setShowOutgoingCallModal(false));
    dispatch(actions.setShowCallWindow(true));
    dispatch(actions.setRingingState({ type: null, isRinging: false }));
    stopAllRingtones();
    saveCallData({ callId, status: 'connected' });
    clearConnectingTimeout();
    
    // Navigate after a brief delay to show success state
    setTimeout(() => {
      dispatch(actions.setConnectionProgress(null));
      navigateToVideoCall(navigate, data, user, lastNavigatedCallIdRef);
    }, 500);
  };
};

/**
 * Create handleCallAccepted handler
 */
export const createCallAcceptedHandler = (dispatch, actions, helpers, navigate, user, refs) => {
  const { processedEvents, saveCallData, stopAllRingtones, clearConnectingTimeout } = helpers;
  const { lastNavigatedCallIdRef } = refs;
  
  return (data) => {
    console.log('🎯 handleCallAccepted TRIGGERED!', data);
    const callId = extractCallId(data);
    
    console.group('✅ CALL ACCEPTED EVENT');
    console.log('📞 Call ID:', callId);
    console.log('📊 Call Data:', data.call);
    console.log('👤 Accepted By:', data.acceptedByName);
    console.groupEnd();
    
    if (isDuplicateEvent(processedEvents, 'call_accepted', callId)) return;
    
    // Set connecting state for caller
    dispatch(actions.setConnecting(true));
    dispatch(actions.setConnectionProgress('Call accepted, connecting...'));
    
    dispatch(actions.setActiveCall(data.call));
    dispatch(actions.setCallStatus('connected'));
    dispatch(actions.setShowIncomingCallModal(false));
    dispatch(actions.setShowOutgoingCallModal(false));
    dispatch(actions.setShowCallWindow(true));
    dispatch(actions.setRingingState({ type: null, isRinging: false }));
    stopAllRingtones();
    saveCallData({ callId, status: 'connected' });
    clearConnectingTimeout();
    
    toast.success(`${data.acceptedByName || 'User'} accepted the call`, {
      duration: 2000,
      icon: '📞'
    });
    
    // Navigate after brief delay to show loading state
    setTimeout(() => {
      dispatch(actions.setConnecting(false));
      dispatch(actions.setConnectionProgress(null));
      navigateToVideoCall(navigate, data, user, lastNavigatedCallIdRef);
    }, 800);
  };
};

/**
 * Create handleCallEnded handler
 */
export const createCallEndedHandler = (dispatch, actions, helpers, navigate, location) => {
  const { processedEvents, saveCallData, stopAllRingtones, clearAllTimers } = helpers;
  
  return (data) => {
    const callId = extractCallId(data);
    const reason = data.reason || 'ended';
    
    console.log('📞 Call ended event received:', reason);
    
    if (isDuplicateEvent(processedEvents, 'call_ended', callId)) return;
    
    stopAllRingtones();
    clearAllTimers();
    
    dispatch(actions.resetCallState());
    dispatch(actions.setCallStatus('idle'));
    dispatch(actions.setRingingState({ type: null, isRinging: false }));
    dispatch(actions.setLocalStream(null));
    dispatch(actions.setRemoteStream(null));
    dispatch(actions.setShowIncomingCallModal(false));
    dispatch(actions.setShowOutgoingCallModal(false));
    dispatch(actions.setShowCallWindow(false));
    
    saveCallData(null);
    processedEvents.current = {};
    
    // Show appropriate toast
    if (reason === 'rejected') toast.error('Call rejected');
    else if (reason === 'missed') toast('Call missed', { icon: '⏰' });
    else if (reason === 'timeout') toast.error('Call timed out');
    else if (reason === 'cancelled') toast('Call cancelled', { icon: '🚫' });
    else toast.success('Call ended');
    
    if (location.pathname.includes('/video-call')) {
      navigate('/chat');
    }
  };
};

/**
 * Create handleCallRejected handler
 */
export const createCallRejectedHandler = (dispatch, actions, helpers) => {
  const { stopAllRingtones, endCall } = helpers;
  
  return (data) => {
    const { rejectedByName } = data;
    toast.error(`${rejectedByName || 'Participant'} rejected the call`);
    dispatch(actions.setCallStatus('ended'));
    dispatch(actions.setRingingState({ type: null, isRinging: false }));
    stopAllRingtones();
    endCall();
  };
};

/**
 * Create handleCallCancelled handler
 */
export const createCallCancelledHandler = (dispatch, actions, helpers) => {
  const { stopAllRingtones, endCall } = helpers;
  
  return (data) => {
    const { cancelledByName, message } = data;
    toast.error(message || `${cancelledByName || 'Caller'} cancelled the call`);
    dispatch(actions.setCallStatus('ended'));
    dispatch(actions.setRingingState({ type: null, isRinging: false }));
    stopAllRingtones();
    endCall();
  };
};
