import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, MoreHorizontal, Eye, Edit, Trash2, Pin, PinOff, Megaphone, MessageCircle, Lightbulb } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const CATEGORY_CONFIG: Record<string, { label: string; className: string; icon: typeof Megaphone }> = {
  announcement: { label: "Announcement", className: "bg-primary/10 text-primary hover:bg-primary/20", icon: Megaphone },
  discussion: { label: "Discussion", className: "bg-violet-500/10 text-violet-600 hover:bg-violet-500/20", icon: MessageCircle },
  tip: { label: "Tip", className: "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20", icon: Lightbulb },
};

const TEACHER_POSTS = [
  { id: 1, title: "SPM 2026 Trial Exam Schedule Released", category: "announcement", audience: "Form 5", status: "published", pinned: true, author: "Ahmad bin Ibrahim", createdAt: "2026-03-12", excerpt: "Please take note of the updated trial exam schedule for all Form 5 students..." },
  { id: 2, title: "Tips for Answering Structured Questions", category: "tip", audience: "All Forms", status: "published", pinned: true, author: "Siti Nurhailza", createdAt: "2026-03-10", excerpt: "Here are some key strategies for answering structured questions effectively..." },
  { id: 3, title: "Mid-Year Exam Preparation Guide", category: "announcement", audience: "Form 4", status: "published", pinned: false, author: "Ahmad bin Ibrahim", createdAt: "2026-03-08", excerpt: "The mid-year examination will begin on April 21. Below is the preparation checklist..." },
  { id: 4, title: "Best Study Techniques for Science Subjects", category: "tip", audience: "Form 4", status: "published", pinned: false, author: "Siti Nurhailza", createdAt: "2026-03-05", excerpt: "Research shows that active recall and spaced repetition work best for Science..." },
  { id: 5, title: "Classroom Discussion: Sustainable Development Goals", category: "discussion", audience: "Form 5", status: "published", pinned: false, author: "Ahmad bin Ibrahim", createdAt: "2026-03-02", excerpt: "Share your thoughts on how SDGs impact our daily lives in Malaysia..." },
  { id: 6, title: "Holiday Homework Reminder — March Break", category: "announcement", audience: "All Forms", status: "draft", pinned: false, author: "Siti Nurhailza", createdAt: "2026-02-28", excerpt: "All students are reminded to complete the assigned holiday homework..." },
];

export function TeacherPosts() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filtered = TEACHER_POSTS.filter((post) => {
    const matchesSearch =
      post.title.toLowerCase().includes(search.toLowerCase()) ||
      post.author.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || post.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Teacher Posts"
        description="Announcements, tips, and class discussions."
        action={
          <Button className="rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
            <Plus className="w-4 h-4 mr-2" />
            Create Post
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-2xl border border-border/50 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search posts..."
            className="pl-9 bg-background border-border/50 rounded-xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48 rounded-xl border-border/50 shrink-0">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="announcement">Announcements</SelectItem>
            <SelectItem value="discussion">Discussions</SelectItem>
            <SelectItem value="tip">Tips</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="w-8"></TableHead>
              <TableHead className="font-semibold">Post</TableHead>
              <TableHead className="font-semibold">Category</TableHead>
              <TableHead className="font-semibold">Audience</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Date</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No posts found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((post) => {
                const catConfig = CATEGORY_CONFIG[post.category];
                const CatIcon = catConfig.icon;
                return (
                  <TableRow key={post.id} className="border-border/50 group hover:bg-muted/30 transition-colors">
                    <TableCell className="w-8 pr-0">
                      {post.pinned && <Pin className="w-3.5 h-3.5 text-primary rotate-45" />}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{post.title}</div>
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-1 max-w-md">{post.excerpt}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={catConfig.className}>
                        <CatIcon className="w-3 h-3 mr-1" />
                        {catConfig.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{post.audience}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={
                        post.status === 'published'
                          ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                          : 'bg-orange-500/10 text-orange-600 hover:bg-orange-500/20'
                      }>
                        {post.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">{new Date(post.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">by {post.author}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 rounded-xl border-border/50 shadow-xl">
                          <DropdownMenuItem className="cursor-pointer gap-2"><Eye className="w-4 h-4" /> View</DropdownMenuItem>
                          <DropdownMenuItem className="cursor-pointer gap-2"><Edit className="w-4 h-4" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem className="cursor-pointer gap-2">
                            {post.pinned ? <><PinOff className="w-4 h-4" /> Unpin</> : <><Pin className="w-4 h-4" /> Pin to Top</>}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border/50" />
                          <DropdownMenuItem className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive">
                            <Trash2 className="w-4 h-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
