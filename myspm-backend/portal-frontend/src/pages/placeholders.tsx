import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export function ComingSoon({ title, description }: { title: string, description: string }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader title={title} description={description} />
      <Card className="border-border/50 border-dashed shadow-none bg-background">
        <CardContent className="flex flex-col items-center justify-center h-64 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4 text-muted-foreground">
            <Construction className="w-8 h-8 opacity-50" />
          </div>
          <h3 className="text-lg font-semibold">Under Construction</h3>
          <p className="text-muted-foreground max-w-sm mt-2">
            This module is currently being built and will be available in an upcoming release.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
