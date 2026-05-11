import { 
  Users, FileText, CheckCircle2, TrendingUp, BookOpen
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import {
  useGetDashboardStats,
  useGetDashboardActivity,
  useGetPerformanceTrend,
  type ActivityItem,
  type PerformanceTrendItem,
} from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

function asArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw;
  if (
    raw &&
    typeof raw === "object" &&
    "data" in raw &&
    Array.isArray((raw as { data: unknown }).data)
  ) {
    return (raw as { data: T[] }).data;
  }
  return [];
}

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activities, isLoading: activitiesLoading } = useGetDashboardActivity({ limit: 5 });
  const { data: trends, isLoading: trendsLoading } = useGetPerformanceTrend();

  const activityList = asArray<ActivityItem>(activities);
  const trendList = asArray<PerformanceTrendItem>(trends);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <PageHeader 
        title="Welcome back, Admin" 
        description="Here is your platform overview for today."
        action={
          <Link href="/exams/new" className="inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5">
            <FileText className="w-4 h-4 mr-2" />
            Create Exam
          </Link>
        }
      />

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <MetricCard 
          title="Total Students" 
          value={stats?.totalStudents} 
          icon={Users} 
          loading={statsLoading} 
          trend="+12% from last month" 
        />
        <MetricCard 
          title="Exams Created" 
          value={stats?.totalExams} 
          icon={FileText} 
          loading={statsLoading} 
          trend="+5 this week" 
        />
        <MetricCard 
          title="Avg. Student Score" 
          value={stats?.averageScore ? `${stats.averageScore}%` : undefined} 
          icon={TrendingUp} 
          loading={statsLoading} 
          trend="+2.4% overall" 
        />
        <MetricCard 
          title="Active Assignments" 
          value={stats?.activeAssignments} 
          icon={BookOpen} 
          loading={statsLoading} 
          trend="8 due this week" 
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-md border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Performance Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {trendsLoading ? (
              <Skeleton className="w-full h-[300px] rounded-xl" />
            ) : trendList.length === 0 ? (
              <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                No performance data yet
              </div>
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendList}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: 'hsl(var(--muted-foreground))', fontSize: 12}} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: 'hsl(var(--muted-foreground))', fontSize: 12}} dx={-10} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Line type="monotone" dataKey="averageScore" stroke="hsl(var(--primary))" strokeWidth={3} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-md border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Completion Rate</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col justify-center h-[300px]">
             {statsLoading ? (
               <Skeleton className="w-full h-full rounded-xl" />
             ) : (
                <div className="flex flex-col items-center justify-center">
                  <div className="relative w-48 h-48 flex items-center justify-center">
                    <svg className="w-full h-full" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="hsl(var(--muted))" strokeWidth="10" />
                      <circle 
                        cx="50" cy="50" r="40" fill="transparent" 
                        stroke="hsl(var(--primary))" strokeWidth="10" 
                        strokeDasharray={`${(stats?.examCompletionRate || 0) * 2.51} 251`}
                        strokeLinecap="round"
                        className="transform -rotate-90 origin-center transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-4xl font-bold font-display">{stats?.examCompletionRate}%</span>
                      <span className="text-xs text-muted-foreground mt-1">Completed</span>
                    </div>
                  </div>
                </div>
             )}
          </CardContent>
        </Card>
      </div>

      {/* Activity Feed */}
      <Card className="shadow-md border-border/50">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Recent Activity</CardTitle>
          <Button variant="ghost" size="sm">View All</Button>
        </CardHeader>
        <CardContent className="p-0">
          {activitiesLoading ? (
            <div className="p-6 space-y-4">
              {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : activityList.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No recent activity</div>
          ) : (
            <div className="divide-y divide-border/50">
              {activityList.map((activity) => (
                <div key={activity.id} className="p-4 flex items-start gap-4 hover:bg-muted/50 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      <span className="font-bold">{activity.userName}</span> {activity.description}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(activity.timestamp).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, loading, trend }: { title: string, value?: string | number, icon: any, loading: boolean, trend: string }) {
  return (
    <Card className="shadow-sm border-border/50 hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-8 w-24 mb-1" />
          ) : (
            <h3 className="text-3xl font-bold font-display tracking-tight text-foreground">{value || '0'}</h3>
          )}
          <p className="text-xs font-medium text-emerald-600 mt-2 bg-emerald-50 inline-flex px-2 py-1 rounded-md">{trend}</p>
        </div>
      </CardContent>
    </Card>
  );
}
