import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { PageLoader } from './components/ui.jsx';
import { useAuth } from './context/AuthContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';

// Role areas are split into separate chunks.
const WalletPage = lazy(() => import('./pages/WalletPage.jsx'));
const PatientDashboard = lazy(() => import('./pages/patient/PatientDashboard.jsx'));
const CheckInPage = lazy(() => import('./pages/patient/CheckInPage.jsx'));
const JournalPage = lazy(() => import('./pages/patient/JournalPage.jsx'));
const IntegrityPage = lazy(() => import('./pages/patient/IntegrityPage.jsx'));
const ConsentPage = lazy(() => import('./pages/patient/ConsentPage.jsx'));
const ActivityPage = lazy(() => import('./pages/patient/ActivityPage.jsx'));
const TherapistDashboard = lazy(() => import('./pages/therapist/TherapistDashboard.jsx'));
const TherapistPatients = lazy(() => import('./pages/therapist/TherapistPatients.jsx'));
const PatientRecords = lazy(() => import('./pages/therapist/PatientRecords.jsx'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'));
const AdminTherapists = lazy(() => import('./pages/admin/AdminTherapists.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit.jsx'));

const HOME = { patient: '/patient', therapist: '/therapist', admin: '/admin' };

function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={HOME[user?.role] ?? '/login'} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<RoleHome />} />

            <Route element={<ProtectedRoute roles={['patient', 'therapist']} />}>
              <Route path="/wallet" element={<WalletPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={['patient']} />}>
              <Route path="/patient" element={<PatientDashboard />} />
              <Route path="/patient/check-in" element={<CheckInPage />} />
              <Route path="/patient/journal" element={<JournalPage />} />
              <Route path="/patient/integrity" element={<IntegrityPage />} />
              <Route path="/patient/consent" element={<ConsentPage />} />
              <Route path="/patient/activity" element={<ActivityPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={['therapist']} />}>
              <Route path="/therapist" element={<TherapistDashboard />} />
              <Route path="/therapist/patients" element={<TherapistPatients />} />
              <Route path="/therapist/patients/:patientId" element={<PatientRecords />} />
            </Route>

            <Route element={<ProtectedRoute roles={['admin']} />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/therapists" element={<AdminTherapists />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
