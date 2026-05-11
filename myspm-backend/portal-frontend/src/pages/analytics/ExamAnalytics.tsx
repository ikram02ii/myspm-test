import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from "recharts";
import { TrendingUp, Users, Target, Award, Download } from "lucide-react";

const EXAM_AVERAGES = [
  { exam: "English Grammar", average: 82, students: 5 },
  { exam: "Science Ch.3 Quiz", average: 79, students: 4 },
  { exam: "Math Mid-Year", average: 75, students: 5 },
  { exam: "BM Tatabahasa", average: 68, students: 3 },
];

const DIFFICULTY_DIST = [
  { name: "Easy", value: 4, color: "#10b981" },
  { name: "Medium", value: 5, color: "#f59e0b" },
  { name: "Hard", value: 3, color: "#ef4444" },
];

const PASS_FAIL_DIST = [
  { name: "Pass (≥50%)", value: 79, color: "#10b981" },
  { name: "Fail (<50%)", value: 13, color: "#ef4444" },
];

const SCORE_TREND = [
  { month: "Oct", avgScore: 68, passRate: 72 },
  { month: "Nov", avgScore: 71, passRate: 75 },
  { month: "Dec", avgScore: 74, passRate: 78 },
  { month: "Jan", avgScore: 73, passRate: 76 },
  { month: "Feb", avgScore: 77, passRate: 82 },
  { month: "Mar", avgScore: 78, passRate: 85 },
];

const QUESTION_STATS = [
  { id: 1, text: "Solve quadratic equation x² + 5x + 6 = 0", subject: "Mathematics", difficulty: "Medium", successRate: 85, attempts: 12 },
  { id: 2, text: "Explain photosynthesis process", subject: "Science", difficulty: "Easy", successRate: 92, attempts: 15 },
  { id: 3, text: "Calculate velocity from displacement-time graph", subject: "Science", difficulty: "Hard", successRate: 48, attempts: 10 },
  { id: 4, text: "Identify grammar errors in passage", subject: "English", difficulty: "Medium", successRate: 76, attempts: 14 },
  { id: 5, text: "Trigonometric identities proof", subject: "Mathematics", difficulty: "Hard", successRate: 38, attempts: 8 },
  { id: 6, text: "Sejarah Kemerdekaan timeline", subject: "History", difficulty: "Easy", successRate: 90, attempts: 11 },
  { id: 7, text: "Statistics: Calculate standard deviation", subject: "Mathematics", difficulty: "Medium", successRate: 62, attempts: 9 },
  { id: 8, text: "Newton's Third Law application", subject: "Science", difficulty: "Hard", successRate: 55, attempts: 13 },
];

const SUMMARY_STATS = [
  { label: "Average Score", value: "78.3%", change: "+2.4%", icon: TrendingUp, color: "text-primary" },
  { label: "Total Attempts", value: "92", change: "+18 this month", icon: Users, color: "text-emerald-600" },
  { label: "Pass Rate", value: "85.5%", change: "+3.2%", icon: Target, color: "text-orange-500" },
  { label: "Top Score", value: "95%", change: "Ali bin Hassan", icon: Award, color: "text-violet-600" },
];

export function ExamAnalytics() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Exam Analytics"
        description="Deep dive into question success rates and performance insights."
        action={
          <Button variant="outline" className="rounded-xl border-border/50 gap-2">
            <Download className="w-4 h-4" />
            Export Report
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {SUMMARY_STATS.map((stat) => (
          <Card key={stat.label} className="border-border/50 shadow-sm rounded-2xl">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
                <p className="text-xs text-emerald-600 mt-1">{stat.change}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl bg-muted flex items-center justify-center ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-3 bg-card p-4 rounded-2xl border border-border/50 shadow-sm">
        <Select defaultValue="all">
          <SelectTrigger className="w-48 rounded-xl border-border/50">
            <SelectValue placeholder="Subject" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subjects</SelectItem>
            <SelectItem value="mathematics">Mathematics</SelectItem>
            <SelectItem value="science">Science</SelectItem>
            <SelectItem value="english">English</SelectItem>
            <SelectItem value="history">History</SelectItem>
            <SelectItem value="bm">Bahasa Melayu</SelectItem>
          </SelectContent>
        </Select>
        <Select defaultValue="all">
          <SelectTrigger className="w-48 rounded-xl border-border/50">
            <SelectValue placeholder="Form Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Forms</SelectItem>
            <SelectItem value="3">Form 3</SelectItem>
            <SelectItem value="4">Form 4</SelectItem>
            <SelectItem value="5">Form 5</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50 shadow-sm rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Average Score by Exam</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={EXAM_AVERAGES} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="exam" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => [`${value}%`, 'Average']}
                />
                <Bar dataKey="average" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Question Difficulty Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={DIFFICULTY_DIST} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {DIFFICULTY_DIST.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50 shadow-sm rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Pass / Fail Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={PASS_FAIL_DIST} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {PASS_FAIL_DIST.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Score & Pass Rate Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={SCORE_TREND} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis domain={[50, 100]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend />
                <Line type="monotone" dataKey="avgScore" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 4, fill: "hsl(var(--primary))" }} name="Avg Score %" />
                <Line type="monotone" dataKey="passRate" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: "#10b981" }} name="Pass Rate %" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 shadow-sm rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Per-Question Success Rates</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="font-semibold w-12">#</TableHead>
                <TableHead className="font-semibold">Question</TableHead>
                <TableHead className="font-semibold">Subject</TableHead>
                <TableHead className="font-semibold">Difficulty</TableHead>
                <TableHead className="font-semibold">Success Rate</TableHead>
                <TableHead className="font-semibold text-right">Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {QUESTION_STATS.map((q) => (
                <TableRow key={q.id} className="border-border/50 hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-xs text-muted-foreground">{q.id}</TableCell>
                  <TableCell className="font-medium max-w-xs truncate">{q.text}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{q.subject}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={
                      q.difficulty === 'Hard' ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' :
                      q.difficulty === 'Medium' ? 'bg-orange-500/10 text-orange-600 hover:bg-orange-500/20' :
                      'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                    }>
                      {q.difficulty}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${q.successRate >= 70 ? 'bg-emerald-500' : q.successRate >= 50 ? 'bg-orange-500' : 'bg-destructive'}`}
                          style={{ width: `${q.successRate}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">{q.successRate}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{q.attempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
