import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { setNavigateFunction } from "./utils/navigation";
import { toast } from "react-hot-toast";

import ApplicationLayout from "./components/ApplicationLayout";
import ToastNotification from "./components/ui/ToastNotification";
import ApplicationLoadingSpinner from "./components/ui/ApplicationLoadingSpinner";
import BrowserExtensionNotification from "./components/ui/BrowserExtensionNotification";
import { setupGlobalErrorHandling } from "./utils/errorHandler";
import Login from "./pages/authenication/Login";
import Signup from "./pages/authenication/Signup";
import ResetPassword from "./pages/authenication/ResetPassword";
import ChangePassword from "./pages/authenication/ChangePassword";
import OtpVerification from "./pages/authenication/OtpVerification";
import Profile from "./pages/Profile";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthRouteGuard from "./components/AuthRouteGuard";
import PageNotFound from "./pages/PageNotFound";
import Dashboard from "./pages/Dashboard";
import RequestOtp from "./pages/authenication/RequestOtp";
import VideoCall from "./pages/VideoCall";
import VideoCallReceiver from "./pages/VideoCallReceiver";
import VideoCallCaller from "./pages/VideoCallCaller";
import VideoCallEnded from "./pages/VideoCallEnded";
import DocumentPreview from "./components/documents/DocumentPreviewModal";
import DocumentsList from "./pages/documents/DocumentsList";
import NewDocument from "./pages/documents/NewDocument";
import EditDocument from "./pages/documents/EditDocument";
import SharedDocument from "./pages/documents/SharedDocument";
import SharedDocumentsList from "./pages/documents/SharedDocumentsList";
import WhiteboardsList from "./pages/whiteboards/WhiteboardsList";
import NewWhiteboard from "./pages/whiteboards/NewWhiteboard";
import WhiteboardEditor from "./pages/whiteboards/WhiteboardEditor";
import Whiteboard from "./pages/Whiteboard";
import ChatPage from "./pages/ChatPage";
import CallHistoryPage from "./pages/CallHistoryPage";
import MediaViewerPage from "./pages/MediaViewerPage";
import MeetingsList from "./pages/meetings/MeetingsList";
import MeetingRoom from "./pages/meetings/MeetingRoom";
import MinimizedMeeting from "./components/meeting/MinimizedMeeting";
import IncomingVideoCallModal from "./components/call/IncomingVideoCallModal";
import OutgoingVideoCallModal from "./components/call/OutgoingVideoCallModal";
import WorkspaceListGrid from "./components/workspace/WorkspaceListGrid";
import WorkspacePage from "./pages/workspace/WorkspacePage";
import ProjectPage from "./pages/project/ProjectPage";
import AllProjectsPage from "./pages/AllProjectsPage";
import { useCurrentUser } from "./hook/useAuth";
import { useDispatch, useSelector } from "react-redux";
import { clearUser, setUser } from "./store/slice/authSlice";
import { useCallIntegration } from "./hook/useCallIntegration";
import { useUserLocation } from "./hook/useUserLocation";
import {
  selectIncomingCall,
  selectOutgoingCall,
  selectShowIncomingCallModal,
  selectShowOutgoingCallModal,
} from "./store/slice/callSlice";
import ResetPasswordWithLink from "./pages/authenication/ResetPasswordWithLink";


export default function App() {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const { loading } = useSelector((state) => state.auth);

  // Track user location for call notifications
  useUserLocation();

  // Call state - use useCallIntegration instead of useCallSocket to avoid duplicate listeners
  const incomingCall = useSelector(selectIncomingCall);
  const outgoingCall = useSelector(selectOutgoingCall);
  const showIncomingCallModal = useSelector(selectShowIncomingCallModal);
  const showOutgoingCallModal = useSelector(selectShowOutgoingCallModal);
  const { joinCall, rejectCall, cancelCall } = useCallIntegration({ webRTCEnabled: false });

  const isAuthPage =
    ["/login", "/signup", "/reset-password"].includes(location.pathname) ||
    location.pathname.startsWith("/reset-password/");

  const query = useCurrentUser();
  const { data, isSuccess, isError } = query;

  useEffect(() => {
    setupGlobalErrorHandling();
    setNavigateFunction(navigate);
  }, [navigate]);

  useEffect(() => {
    if (loading && !isAuthPage) {
      const timeout = setTimeout(() => {
        dispatch(clearUser());
      }, import.meta.env.VITE_LOADING_TIMEOUT);

      return () => clearTimeout(timeout);
    }
  }, [loading, isAuthPage, dispatch]);

  useEffect(() => {
    if (isSuccess && data?.data?.user) {
      dispatch(setUser({ user: data.data.user }));
    } else if (isSuccess && data?.data) {
      dispatch(setUser({ user: data.data }));
    } else if (isSuccess && data?.user) {
      dispatch(setUser({ user: data.user }));
    } else if (isSuccess && data && !data.data && !data.user) {
      dispatch(setUser({ user: data }));
    } else if (isError) {
      if (
        query.error?.response?.status === 401 ||
        query.error?.response?.status === 403
      ) {
        dispatch(clearUser());
      }
    }
  }, [isSuccess, isError, data, dispatch, query.error?.response?.status, isAuthPage]);

  if (loading && !isAuthPage) return <ApplicationLoadingSpinner message="Initializing application..." />;

  return (
    <AuthRouteGuard>
      <Routes>
        {/* ==================== AUTHENTICATION ROUTES ==================== */}
        <Route element={<ApplicationLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/reset-password/:token"
            element={<ResetPasswordWithLink />}
          />
        </Route>

        {/* ==================== PROTECTED ROUTES ==================== */}
        <Route element={<ProtectedRoute />}>
          <Route element={<ApplicationLayout />}>
            {/* ==================== DASHBOARD & PROFILE ==================== */}
            <Route path="/" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/changepassword" element={<ChangePassword />} />
            <Route path="/verification-otp" element={<OtpVerification />} />
            <Route path="/request-otp" element={<RequestOtp />} />

            {/* ==================== COMMUNICATION FEATURES ==================== */}
            {/* Chat & Messaging */}
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:receiverId" element={<ChatPage />} />
            <Route path="/chat/group/:groupId" element={<ChatPage />} />

            {/* Video Calling */}
            <Route path="/video-call" element={<VideoCall />} />
            <Route path="/video-call/:peerId" element={<VideoCall />} />
            <Route path="/video-call/ended" element={<VideoCallEnded />} />
            <Route path="/call/:callId" element={<VideoCall />} />
            <Route path="/call-history" element={<CallHistoryPage />} />

            {/* Media Viewer */}
            <Route path="/media/:chatId" element={<MediaViewerPage />} />
            <Route
              path="/media/:chatId/:messageId"
              element={<MediaViewerPage />}
            />

            {/* ==================== DOCUMENT MANAGEMENT ==================== */}
            <Route path="/documents" element={<DocumentsList />} />
            <Route path="/documents/new" element={<NewDocument />} />
            <Route path="/documents/:documentId" element={<EditDocument />} />
            <Route path="/documents/shared" element={<SharedDocumentsList />} />
            <Route
              path="/documents/shared/:documentId"
              element={<SharedDocument />}
            />
            <Route
              path="/documents/preview/:documentId"
              element={<DocumentPreview />}
            />

            {/* ==================== WHITEBOARD COLLABORATION ==================== */}
            <Route path="/boards" element={<WhiteboardsList />} />
            <Route path="/boards/new" element={<NewWhiteboard />} />
            <Route
              path="/boards/:whiteboardId"
              element={<WhiteboardEditor />}
            />
            <Route
              path="/boards/shared/:whiteboardId"
              element={<WhiteboardEditor />}
            />
            <Route path="/whiteboard" element={<Whiteboard />} />

            {/* ==================== MEETING MANAGEMENT ==================== */}
            <Route path="/meetings" element={<MeetingsList />} />
            <Route path="/meeting/:meetingId" element={<MeetingRoom />} />

            {/* ==================== WORKSPACE & PROJECT MANAGEMENT ==================== */}
            {/* Workspace Management */}
            <Route path="/workspaces" element={<WorkspaceListGrid />} />
            <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />

            {/* Project Management */}
            <Route path="/projects" element={<AllProjectsPage />} />
            <Route
              path="/workspace/:workspaceId/projects/:projectId"
              element={<ProjectPage />}
            />
            <Route
              path="/workspace/:workspaceId/projects/:projectId/board"
              element={<ProjectPage />}
            />
            <Route
              path="/workspace/:workspaceId/projects/:projectId/tasks/:taskId"
              element={<ProjectPage />}
            />
            {/* Meeting Management */}
            <Route
              path="/workspace/:workspaceId/projects/:projectId/meetings"
              element={<ProjectPage />}
            />
            <Route
              path="/workspace/:workspaceId/projects/:projectId/meetings/:meetingId"
              element={<ProjectPage />}
            />
          </Route>
        </Route>

        {/* ==================== ERROR HANDLING ==================== */}
        <Route path="*" element={<PageNotFound />} />
      </Routes>

      <div className="relative z-[9999] pointer-events-auto">
        <ToastNotification />
        <BrowserExtensionNotification />
        <MinimizedMeeting />
        
        {/* Global Call Modals */}
        {showIncomingCallModal && incomingCall && (
          <IncomingVideoCallModal
            incomingCall={incomingCall}
            onAccept={async () => {
              try {
                const callId = incomingCall.callId || incomingCall._id;
                console.log('📞 Accepting call:', callId);
                await joinCall(callId);
                const callerId = incomingCall.fromUserId || incomingCall.callerId || incomingCall.caller?._id;
                if (callerId) {
                  navigate(`/video-call/${callerId}`);
                } else {
                  navigate("/video-call");
                }
              } catch (error) {
                console.error('❌ Error accepting call:', error);
                toast.error('Failed to accept call');
              }
            }}
            onReject={async () => {
              try {
                const callId = incomingCall.callId || incomingCall._id;
                console.log('📞 Rejecting call:', callId);
                await rejectCall(callId);
              } catch (error) {
                console.error('❌ Error rejecting call:', error);
                toast.error('Failed to reject call');
              }
            }}
            onDecline={async () => {
              try {
                const callId = incomingCall.callId || incomingCall._id;
                console.log('📞 Declining call:', callId);
                await rejectCall(callId);
              } catch (error) {
                console.error('❌ Error declining call:', error);
                toast.error('Failed to decline call');
              }
            }}
            isVisible={showIncomingCallModal}
          />
        )}
        
        {showOutgoingCallModal && outgoingCall && (
          <OutgoingVideoCallModal
            outgoingCall={outgoingCall}
            onCancel={async () => {
              const callId = outgoingCall.call?._id || outgoingCall.callId;
              await cancelCall(callId);
            }}
            isVisible={showOutgoingCallModal}
          />
        )}
      </div>
    </AuthRouteGuard>
  );
}
