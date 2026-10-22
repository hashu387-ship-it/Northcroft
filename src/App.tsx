import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Loading } from "@/components/ui";
import AppShell, { Background } from "@/layout/AppShell";
import Login from "@/pages/Login";

const Home = lazy(() => import("@/pages/Home"));
const MyTasks = lazy(() => import("@/pages/MyTasks"));
const TaskDetail = lazy(() => import("@/pages/TaskDetail"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectDetail = lazy(() => import("@/pages/ProjectDetail"));
const Inbox = lazy(() => import("@/pages/Inbox"));
const Announcements = lazy(() => import("@/pages/Announcements"));
const Calendar = lazy(() => import("@/pages/Calendar"));
const TeamChat = lazy(() => import("@/pages/TeamChat"));
const Attendance = lazy(() => import("@/pages/Attendance"));
const Workload = lazy(() => import("@/pages/Workload"));
const Settings = lazy(() => import("@/pages/Settings"));
const More = lazy(() => import("@/pages/More"));

function Gate() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  if (loading || (session && !profile)) {
    return (
      <Background>
        <div className="center-screen">
          <Loading label="Opening Northcroft" />
        </div>
      </Background>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <AppShell />;
}

export default function App() {
  const { session, loading } = useAuth();
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={!loading && session ? <Navigate to="/" replace /> : <Login />} />
        <Route element={<Gate />}>
          <Route index element={<Home />} />
          <Route path="my-tasks" element={<MyTasks />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="projects/:id/:tab" element={<ProjectDetail />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="chat" element={<TeamChat />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="workload" element={<Workload />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/:section" element={<Settings />} />
          <Route path="more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
