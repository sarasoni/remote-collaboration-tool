import React, { useRef, useEffect, useState } from 'react';
import { MicOff } from 'lucide-react';

/**
 * VideoGrid Component - Displays local and remote video streams
 * Pure UI component with no business logic
 */
const VideoTile = ({ stream, userName, isMuted, isLocal = false, notifyAudioBlocked, isPresenter = false, variant = 'default', onPin, pinned = false }) => {
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      
      // Log audio tracks for debugging
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      console.log(`🎬 [VideoTile] ${userName}:`, {
        isLocal,
        audioTracks: audioTracks.length,
        videoTracks: videoTracks.length,
        audioEnabled: audioTracks[0]?.enabled,
        videoEnabled: videoTracks[0]?.enabled
      });
      
      // Ensure audio plays for remote participants using a hidden <audio> element
      if (!isLocal && audioRef.current) {
        try {
          audioRef.current.srcObject = stream;
          audioRef.current.muted = false;
          audioRef.current.volume = 1.0;
          const p = audioRef.current.play();
          if (p && typeof p.then === 'function') {
            p.catch(() => {
              // Notify parent to show enable-audio UI
              notifyAudioBlocked && notifyAudioBlocked();
            });
          }

          // Listen for a global retry event dispatched by parent
          const retry = () => {
            audioRef.current && audioRef.current.play().catch(() => {
              notifyAudioBlocked && notifyAudioBlocked();
            });
          };
          window.addEventListener('meeting-enable-audio', retry);
          return () => window.removeEventListener('meeting-enable-audio', retry);
        } catch (e) {
          notifyAudioBlocked && notifyAudioBlocked();
        }
      }
    }
  }, [stream, userName, isLocal]);

  const containerClasses = variant === 'stage'
    ? 'relative bg-gray-800 dark:bg-gray-800 rounded-lg overflow-hidden aspect-video shadow-lg'
    : 'relative bg-gray-800 dark:bg-gray-800 rounded-lg overflow-hidden aspect-video';

  return (
    <div className={containerClasses}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted={isLocal}
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center text-white text-3xl">
            {userName?.[0]?.toUpperCase() || 'U'}
          </div>
        </div>
      )}
      {/* Hidden audio element for remote audio playback */}
      {!isLocal && (
        <audio ref={audioRef} autoPlay playsInline className="hidden" />
      )}
      <div className="absolute bottom-3 left-3 bg-black/60 text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-2">
        <span>{userName || 'Unknown'}</span>
        {isMuted && <MicOff className="w-4 h-4" />}
        {isPresenter && (
          <span className="ml-2 px-2 py-0.5 text-xs rounded bg-blue-600">Presenting</span>
        )}
      </div>
      {onPin && (
        <button
          onClick={onPin}
          title={pinned ? 'Unpin' : 'Pin to stage'}
          className={`absolute top-3 right-3 px-2 py-1 rounded bg-black/50 text-white text-xs ${pinned ? 'ring-2 ring-blue-500' : ''}`}
        >
          {pinned ? 'Pinned' : 'Pin'}
        </button>
      )}
    </div>
  );
};

const VideoGrid = ({ localStream, remoteStreams, participants, currentUser, isMuted, isScreenSharing, layoutMode = 'gallery' }) => {
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [pinnedUserId, setPinnedUserId] = useState(null);
  const handleAudioBlocked = () => setAudioBlocked(true);
  const currentUserId = String(currentUser?.id || currentUser?._id || '');
  // Convert remoteStreams to a quick lookup map
  const remoteStreamMap = Object.fromEntries(
    Object.entries(remoteStreams || {}).map(([k, v]) => [String(k), v])
  );
  // Normalize participants list to { userId, name, isMuted }
  const normalizedParticipants = (participants || []).map(p => ({
    userId: String(p.user?._id || p.userId || p._id || ''),
    name: p.user?.name || p.name || 'Participant',
    isMuted: p.isMuted || false,
  })).filter(p => !!p.userId);

  // Build unified roster: local + union(participants, remoteStream owners)
  const remoteOwners = Object.keys(remoteStreamMap).map(id => String(id));
  const rosterMap = new Map();
  // Add participants first for names
  normalizedParticipants.forEach(p => rosterMap.set(p.userId, { ...p }));
  // Add any remote owners missing from participants with placeholder name
  remoteOwners.forEach(id => {
    if (!rosterMap.has(id)) {
      rosterMap.set(id, { userId: id, name: 'Participant', isMuted: false });
    }
  });
  // Create stable ordered array: self first, then others sorted by name
  const roster = [
    { key: 'local', userId: 'local', stream: localStream, userName: `${currentUser?.name || 'You'} (You)`, isLocal: true, isMuted },
    ...Array.from(rosterMap.values())
      .filter(p => p.userId !== currentUserId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => ({ key: p.userId, userId: p.userId, stream: remoteStreamMap[p.userId] || null, userName: p.name, isLocal: false, isMuted: p.isMuted }))
  ];

  // Stage selection logic
  let stage = null;
  if (isScreenSharing && localStream && layoutMode !== 'gallery') {
    stage = { stream: localStream, userName: `${currentUser?.name || 'You'} (You)`, isLocal: true, isPresenter: true };
  } else if (layoutMode !== 'gallery' && normalizedParticipants.length > 0) {
    // Prefer showing first participant (not self) as stage if they have a stream; otherwise fall back to local
    const preferred = pinnedUserId
      ? roster.find(p => p.userId === pinnedUserId)
      : roster.find(p => p.userId && p.userId !== currentUserId && remoteStreamMap[p.userId]);
    const firstRemote = preferred;
    if (firstRemote) {
      stage = { stream: remoteStreamMap[firstRemote.userId], userName: firstRemote.userName || firstRemote.name, isLocal: false, userId: firstRemote.userId };
    } else if (localStream) {
      stage = { stream: localStream, userName: `${currentUser?.name || 'You'} (You)`, isLocal: true };
    }
  } else if (localStream) {
    stage = { stream: localStream, userName: `${currentUser?.name || 'You'} (You)`, isLocal: true };
  }

  // Filmstrip items based on unified roster
  const filmstripItems = roster;

  // Layout: Gallery view
  if (layoutMode === 'gallery') {
    const tiles = roster;
    return (
      <div className="h-full w-full p-2 sm:p-4 bg-slate-900/90 dark:bg-gray-900">
        <div className="grid gap-2 sm:gap-3 auto-rows-[minmax(120px,1fr)]" style={{gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))'}}>
          {tiles.map(item => (
            <VideoTile
              key={item.key}
              stream={item.stream}
              userName={item.userName}
              isMuted={item.isMuted}
              isLocal={item.isLocal}
              notifyAudioBlocked={handleAudioBlocked}
              variant="default"
              onPin={() => setPinnedUserId(item.key !== 'local' ? item.key : null)}
              pinned={pinnedUserId === item.key}
            />
          ))}
        </div>
        {audioBlocked && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <button onClick={() => { window.dispatchEvent(new Event('meeting-enable-audio')); setAudioBlocked(false); }} className="px-4 py-2 rounded-lg bg-blue-600 text-white shadow hover:bg-blue-700">Enable audio</button>
          </div>
        )}
      </div>
    );
  }

  // Layout: Share view (content left, vertical filmstrip right)
  if (layoutMode === 'share') {
    return (
      <div className="relative flex h-full bg-gray-100 dark:bg-gray-900">
        <div className="flex-1 p-2 sm:p-4 min-w-0">
          {stage ? (
            <VideoTile
              stream={stage.stream}
              userName={stage.userName}
              isMuted={stage.isLocal ? isMuted : false}
              isLocal={!!stage.isLocal}
              isPresenter={!!stage.isPresenter}
              notifyAudioBlocked={handleAudioBlocked}
              variant="stage"
            />
          ) : (
            <div className="h-full w-full rounded-lg bg-gray-800 flex items-center justify-center text-white">Waiting for shared content...</div>
          )}
        </div>
        <div className="w-40 sm:w-56 md:w-64 border-l border-gray-200 dark:border-gray-800 p-2 bg-white/60 dark:bg-gray-900/60 backdrop-blur overflow-y-auto">
          <div className="flex flex-col gap-2">
            {filmstripItems.map(item => (
              <div key={item.key} className="w-full">
                <VideoTile
                  stream={item.stream}
                  userName={item.userName}
                  isMuted={item.isMuted}
                  isLocal={item.isLocal}
                  notifyAudioBlocked={handleAudioBlocked}
                  onPin={() => setPinnedUserId(item.key !== 'local' ? item.key : null)}
                  pinned={pinnedUserId === item.key}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Layout: Speaker view (stage + bottom filmstrip)
  return (
    <div className="relative flex flex-col h-full bg-gray-100 dark:bg-gray-900">
      <div className="flex-1 p-2 sm:p-4 min-h-0">
        {stage ? (
          <VideoTile
            stream={stage.stream}
            userName={stage.userName}
            isMuted={stage.isLocal ? isMuted : false}
            isLocal={!!stage.isLocal}
            isPresenter={!!stage.isPresenter}
            notifyAudioBlocked={handleAudioBlocked}
            variant="stage"
          />
        ) : (
          <div className="h-full w-full rounded-lg bg-gray-800 flex items-center justify-center text-white">Waiting for participants...</div>
        )}
      </div>
      <div className="border-t border-gray-200 dark:border-gray-800 px-2 sm:px-4 py-2 bg-white/60 dark:bg-gray-900/60 backdrop-blur">
        <div className="flex items-stretch gap-2 overflow-x-auto no-scrollbar">
          {filmstripItems.map(item => (
            <div key={item.key} className="w-40 sm:w-56 shrink-0">
              <VideoTile
                stream={item.stream}
                userName={item.userName}
                isMuted={item.isMuted}
                isLocal={item.isLocal}
                notifyAudioBlocked={handleAudioBlocked}
                onPin={() => setPinnedUserId(item.key !== 'local' ? item.key : null)}
                pinned={pinnedUserId === item.key}
              />
            </div>
          ))}
        </div>
      </div>
      {audioBlocked && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <button onClick={() => { window.dispatchEvent(new Event('meeting-enable-audio')); setAudioBlocked(false); }} className="px-4 py-2 rounded-lg bg-blue-600 text-white shadow hover:bg-blue-700">Enable audio</button>
        </div>
      )}
    </div>
  );
}
;

export default VideoGrid;
