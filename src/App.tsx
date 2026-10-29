import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Splash } from "@/components/Splash";
import AppShell from "@/layout/AppShell";
import Login from "@/pages/Login";

const Home = lazy(() => import("@/pages/Home"));
const MyTasks = lazy(() => import("@/pages/MyTasks"));
const TaskDetail = lazy(() => import("@/pages/TaskDetail"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectDetail = lazy(() => import("@/pages/ProjectDetail"));
const Inbox = lazy(() => import("@/pages/Inbox"));
const Announcements = lazy(() => import("@/pages/Announcements"));
const Calendar = lazy(() => import("@/pages/Calendar"));
const Chats = lazy(() => import("@/pages/Chats"));
const Attendance = lazy(() => import("@/pages/Attendance"));
const Workload = lazy(() => import("@/pages/Workload"));
const Settings = lazy(() => import("@/pages/Settings"));
const More = lazy(() => import("@/pages/More"));
const FileView = lazy(() => import("@/pages/FileView"));
const Share = lazy(() => import("@/pages/Share"));
const DailyUpdates = lazy(() => import("@/pages/DailyUpdates"));
const UpdateReport = lazy(() => import("@/pages/UpdateReport"));
const VoLogPage = lazy(() => import("@/pages/VoLogPage"));
const Submissions = lazy(() => import("@/pages/Submissions"));

function Gate() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  if (loading || (session && !profile)) return <Splash />;
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
          <Route path="chat" element={<Chats />} />
          <Route path="chats" element={<Chats />} />
          <Route path="chats/project/:projectId" element={<Chats />} />
          <Route path="chats/:id" element={<Chats />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="workload" element={<Workload />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/:section" element={<Settings />} />
          <Route path="more" element={<More />} />
          <Route path="files/:id" element={<FileView />} />
          <Route path="share" element={<Share />} />
          <Route path="updates" element={<DailyUpdates />} />
          <Route path="updates/report" element={<UpdateReport />} />
          <Route path="vo-log" element={<VoLogPage />} />
          <Route path="submissions" element={<Submissions />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
