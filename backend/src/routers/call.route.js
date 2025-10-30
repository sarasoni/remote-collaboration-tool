import express from "express";
import {
  startCall,
  joinCall,
  endCall,
  getCallHistory,
  updateCallSettings,
  rejectCall,
  markCallAsMissed,
  cleanupMissedCalls,
  getCallById,
  deleteCall,
  clearCallHistory,
  getCurrentCall,
} from "../controllers/call.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// Get current active call (similar to /auth/me)
router.get("/current", verifyToken, getCurrentCall);

router.post("/start", verifyToken, startCall);

router.post("/:callId/join", verifyToken, joinCall);

router.post("/:callId/end", verifyToken, endCall);

router.post("/:callId/reject", verifyToken, rejectCall);

router.delete("/:callId", verifyToken, deleteCall);

router.put("/:callId/settings", verifyToken, updateCallSettings);

router.get("/history", verifyToken, getCallHistory);

router.delete("/history", verifyToken, clearCallHistory);

router.post("/:callId/missed", verifyToken, markCallAsMissed);

router.post("/missed/cleanup", verifyToken, cleanupMissedCalls);

router.get("/:callId", verifyToken, getCallById);

export { router as callRouter };
