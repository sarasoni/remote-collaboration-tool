import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import { errorMiddleware } from "./middleware/error.middleware.js";
import {
  securityHeaders,
  apiLimiter,
  authLimiter,
  authCheckLimiter,
  uploadLimiter,
  sanitizeMongo,
  preventHPP,
  xssProtection,
  corsOptions,
  securityErrorHandler,
  securityLogger,
} from "./middleware/security.middleware.js";

import { authRouter } from "./routers/auth.route.js";
import {
  documentRouter,
  publicDocumentRouter,
} from "./routers/document.route.js";
import {
  whiteboardRouter,
  publicWhiteboardRouter,
} from "./routers/whiteboard.route.js";
import { userRouter } from "./routers/user.route.js";
import { chatRouter } from "./routers/chat.route.js";
import { callRouter } from "./routers/call.route.js";
import { projectRouter } from "./routers/project.route.js";
import workspaceRouter from "./routers/workspace.route.js";
import { taskRouter } from "./routers/task.route.js";
import { meetingRouter } from "./routers/meeting.route.js";
import { notificationRouter } from "./routers/notification.route.js";
import { budgetRequestRouter } from "./routers/budgetRequest.route.js";

const app = express();

// ✅ Trust proxy when deployed behind Render’s reverse proxy
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// 🧰 Security & utility middlewares
app.use(securityHeaders);
app.use(securityLogger);
app.use(compression());
app.use(cors(corsOptions));
app.use(sanitizeMongo);
app.use(preventHPP);
app.use(xssProtection);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// 🚦 Rate limiters
app.use("/api/", apiLimiter);
app.use("/api/v1/auth/me", authCheckLimiter);
app.use("/api/v1/auth/", authLimiter);
app.use("/api/v1/documents/upload", uploadLimiter);
app.use("/api/v1/whiteboards/upload", uploadLimiter);

// 🩺 Health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    message: "✅ API connection is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: "1.0.0",
  });
});

// 🏠 Root route — REQUIRED for Render deployment success
app.get("/", (req, res) => {
  res.status(200).json({
    message: "🚀 Remote Work Collaboration Suite Backend is live!",
    status: "running",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    docs: {
      health: "/api/health",
      auth: "/api/v1/auth",
      users: "/api/v1/users",
      projects: "/api/v1/projects",
    },
  });
});

// 🧭 API routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/documents", documentRouter);
app.use("/api/v1/public/documents", publicDocumentRouter);
app.use("/api/v1/whiteboards", whiteboardRouter);
app.use("/api/v1/public/whiteboards", publicWhiteboardRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/call", callRouter);
app.use("/api/v1/workspaces", workspaceRouter);
app.use("/api/v1/projects", projectRouter);
app.use("/api/v1/tasks", taskRouter);
app.use("/api/v1", meetingRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1", budgetRequestRouter);

// 🛡 Security and error middlewares
app.use(securityErrorHandler);
app.use(errorMiddleware);

// 🚫 Catch-all for undefined routes
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

export default app;
