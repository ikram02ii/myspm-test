import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import NotFound from "@/pages/not-found";
import { Login } from "@/pages/Login";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Dashboard } from "@/pages/Dashboard";
import { QuestionBank } from "@/pages/questions/QuestionBank";
import { ExamList } from "@/pages/exams/ExamList";
import { ExamBuilder } from "@/pages/exams/ExamBuilder";
import { AssignmentManager } from "@/pages/assignments/AssignmentManager";
import { StudentResults } from "@/pages/results/StudentResults";
import { UserManagement } from "@/pages/users/UserManagement";
import { RbacManagement } from "@/pages/roles/RbacManagement";
import { SystemParameters } from "@/pages/parameters/SystemParameters";
import { LovManagement } from "@/pages/lov/LovManagement";
import { ExamAnalytics } from "@/pages/analytics/ExamAnalytics";
import { PracticeSets } from "@/pages/practice-sets/PracticeSets";
import { StudyNotes } from "@/pages/study-notes/StudyNotes";
import { TeacherPosts } from "@/pages/teacher-posts/TeacherPosts";
import { StudentSubscriptionDashboard } from "@/pages/subscriptions/StudentSubscriptionDashboard";
import { TeacherPackageManager } from "@/pages/subscriptions/TeacherPackageManager";
import { AdminSubscriptionManager } from "@/pages/subscriptions/AdminSubscriptionManager";
import { PaymentPage } from "@/pages/subscriptions/PaymentPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function ProtectedRoutes() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/questions" component={QuestionBank} />

        <Route path="/exams" component={ExamList} />
        <Route path="/exams/new" component={ExamBuilder} />
        <Route path="/exams/:id" component={ExamBuilder} />

        <Route path="/assignments" component={AssignmentManager} />
        <Route path="/results" component={StudentResults} />

        <Route path="/users" component={UserManagement} />
        <Route path="/roles" component={RbacManagement} />
        <Route path="/parameters" component={SystemParameters} />
        <Route path="/lov" component={LovManagement} />

        <Route path="/analytics" component={ExamAnalytics} />
        <Route path="/practice-sets" component={PracticeSets} />
        <Route path="/study-notes" component={StudyNotes} />
        <Route path="/teacher-posts" component={TeacherPosts} />

        <Route path="/subscriptions" component={StudentSubscriptionDashboard} />
        <Route path="/subscriptions/student" component={StudentSubscriptionDashboard} />
        <Route path="/subscriptions/teacher" component={TeacherPackageManager} />
        <Route path="/subscriptions/admin" component={AdminSubscriptionManager} />
        <Route path="/payment" component={PaymentPage} />

        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function AuthGate() {
  const { auth } = useAuth();
  const [loc] = useLocation();

  if (loc === "/login") {
    if (auth) return <Redirect to="/" />;
    return <Login />;
  }

  if (!auth) return <Redirect to="/login" />;

  return <ProtectedRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthGate />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
