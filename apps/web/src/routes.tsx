import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { SignIn } from "./pages/auth/SignIn";
import { OAuthCallback } from "./pages/auth/OAuthCallback";
import { CreateOrg } from "./pages/org/CreateOrg";
import { OrgSettings } from "./pages/org/OrgSettings";
import { Dashboard } from "./pages/dashboard/Dashboard";
import { ProjectSetup } from "./pages/project/ProjectSetup";
import { SessionPage } from "./pages/session/SessionPage";
import { SessionHistory } from "./pages/session/SessionHistory";
import { UserSettings } from "./pages/settings/UserSettings";
import { AcceptInvite } from "./pages/auth/AcceptInvite";
import { OrgList } from "./pages/org/OrgList";
import { OrgLayout } from "./components/layout/OrgLayout";

export const router = createBrowserRouter([
  { path: "/signin", element: <SignIn /> },
  { path: "/auth/callback/:provider", element: <OAuthCallback /> },
  { path: "/invite/:token", element: <AcceptInvite /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/orgs" replace /> },
      { path: "orgs", element: <OrgList /> },
      { path: "orgs/new", element: <CreateOrg /> },
      {
        path: "orgs/:orgId",
        element: <OrgLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "projects/:projectId/setup", element: <ProjectSetup /> },
          { path: "sessions", element: <SessionHistory /> },
          { path: "settings", element: <OrgSettings /> },
        ],
      },
      { path: "settings", element: <UserSettings /> },
    ],
  },
  { path: "/session/:sessionId", element: <SessionPage /> },
]);
