import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, ArrowLeft, GripVertical, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { useCreateExam } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export function ExamBuilder() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    title: "",
    subject: "Mathematics",
    formLevel: "Form 5",
    timer: "60",
    strictMode: true
  });

  const createMutation = useCreateExam({
    mutation: {
      onSuccess: () => {
        toast({ title: "Exam saved successfully" });
        setLocation("/exams");
      }
    }
  });

  const handleSave = () => {
    if (!formData.title) {
      toast({ title: "Validation Error", description: "Title is required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      data: {
        title: formData.title,
        subject: formData.subject,
        formLevel: formData.formLevel,
        timer: parseInt(formData.timer),
        strictMode: formData.strictMode,
        sections: [{ name: "Section A", sortOrder: 1, questionIds: [] }]
      }
    });
  };

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col animate-in fade-in duration-500">
      <PageHeader 
        title="Exam Builder" 
        description="Configure exam settings and select questions."
        action={
          <div className="flex gap-3">
            <Link href="/exams" className="inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-colors bg-card border border-border/50 text-foreground hover:bg-accent h-10 px-4 py-2">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Link>
            <Button 
              className="rounded-xl shadow-lg shadow-primary/20" 
              onClick={handleSave}
              disabled={createMutation.isPending}
            >
              <Save className="w-4 h-4 mr-2" /> 
              {createMutation.isPending ? "Saving..." : "Save Exam"}
            </Button>
          </div>
        }
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0 pb-6">
        {/* Left Column - Config */}
        <Card className="shadow-sm border-border/50 h-full overflow-y-auto">
          <CardHeader className="border-b border-border/50 sticky top-0 bg-card z-10">
            <CardTitle className="text-lg">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-2">
              <Label>Exam Title <span className="text-destructive">*</span></Label>
              <Input 
                placeholder="e.g. Mid-Term Trial 2024" 
                value={formData.title}
                onChange={e => setFormData({...formData, title: e.target.value})}
                className="bg-background rounded-xl"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Subject</Label>
                <Select value={formData.subject} onValueChange={v => setFormData({...formData, subject: v})}>
                  <SelectTrigger className="bg-background rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Mathematics">Mathematics</SelectItem>
                    <SelectItem value="Science">Science</SelectItem>
                    <SelectItem value="History">History</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Form Level</Label>
                <Select value={formData.formLevel} onValueChange={v => setFormData({...formData, formLevel: v})}>
                  <SelectTrigger className="bg-background rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Form 4">Form 4</SelectItem>
                    <SelectItem value="Form 5">Form 5</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Timer (Minutes)</Label>
              <Input 
                type="number" 
                value={formData.timer}
                onChange={e => setFormData({...formData, timer: e.target.value})}
                className="bg-background rounded-xl"
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-background">
              <div>
                <Label className="text-base">Strict Mode</Label>
                <p className="text-sm text-muted-foreground">Prevents tab switching</p>
              </div>
              <Switch checked={formData.strictMode} onCheckedChange={v => setFormData({...formData, strictMode: v})} />
            </div>
          </CardContent>
        </Card>

        {/* Right Column - Questions */}
        <Card className="lg:col-span-2 shadow-sm border-border/50 flex flex-col h-full overflow-hidden">
          <CardHeader className="border-b border-border/50 bg-card shrink-0 flex flex-row items-center justify-between py-4">
            <CardTitle className="text-lg">Questions & Sections</CardTitle>
            <Button variant="outline" size="sm" className="rounded-xl"><Plus className="w-4 h-4 mr-2"/> Add Section</Button>
          </CardHeader>
          <div className="flex-1 overflow-y-auto bg-muted/10 p-6 space-y-6">
            {/* Mock Section A */}
            <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-muted/50 p-4 border-b border-border/50 flex items-center justify-between">
                <div className="font-semibold flex items-center gap-2">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  Section A: Multiple Choice
                </div>
                <Button variant="secondary" size="sm" className="h-8 rounded-lg text-xs">Add Questions</Button>
              </div>
              <div className="p-8 text-center text-sm text-muted-foreground border-dashed border-2 border-border m-4 rounded-xl">
                No questions added to this section yet.<br/>Click "Add Questions" to select from the Question Bank.
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
