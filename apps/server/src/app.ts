import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import orgRoutes from "./routes/org.routes";
import projectRoutes from "./routes/project.routes";
import sessionRoutes from "./routes/session.routes";
import githubRoutes from "./routes/github.routes";
import { requireAuth } from "./middleware/requireAuth";
import { requireOrg } from "./middleware/requireOrg";

export const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));

// Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", requireAuth, userRoutes);
app.use("/api/v1/orgs", requireAuth, orgRoutes);
app.use("/api/v1/orgs/:orgId/projects", requireAuth, requireOrg(), projectRoutes);
app.use("/api/v1/sessions", requireAuth, sessionRoutes);
app.use("/api/v1/github", requireAuth, githubRoutes);

// Error handler
app.use(errorHandler);
