import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp, Users, DollarSign, Package } from "lucide-react";

interface SubscriptionStats {
  total_active: number;
  total_trial: number;
  total_free: number;
  total_revenue: number;
}

interface UserSubscription {
  id: string;
  user_id: string;
  user_name: string;
  plan_name: string;
  status: string;
  start_date: string;
  expiry_date: string;
  amount_paid: number;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  unit_price: number;
  features: string[];
}

export function AdminSubscriptionManager() {
  const [stats, setStats] = useState<SubscriptionStats | null>(null);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planForm, setPlanForm] = useState({ name: "", description: "", price: "" });

  useEffect(() => {
    fetchStats();
    fetchSubscriptions();
    fetchPlans();
  }, []);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem("jwt_token");
      const response = await fetch("/api/admin/subscriptions/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  };

  const fetchSubscriptions = async () => {
    try {
      const token = localStorage.getItem("jwt_token");
      const response = await fetch("/api/admin/subscriptions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setSubscriptions(data.subscriptions || []);
      }
    } catch (err) {
      console.error("Failed to fetch subscriptions:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPlans = async () => {
    try {
      const response = await fetch("/api/plans");
      if (response.ok) {
        const data = await response.json();
        setPlans(data.plans || []);
      }
    } catch (err) {
      console.error("Failed to fetch plans:", err);
    }
  };

  const handleSavePlan = async () => {
    try {
      const token = localStorage.getItem("jwt_token");
      const method = editingPlan ? "PUT" : "POST";
      const endpoint = editingPlan ? `/api/admin/plans/${editingPlan.id}` : "/api/admin/plans";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: planForm.name,
          description: planForm.description,
          unit_price: parseFloat(planForm.price),
        }),
      });

      if (response.ok) {
        setShowPlanDialog(false);
        setPlanForm({ name: "", description: "", price: "" });
        setEditingPlan(null);
        fetchPlans();
      }
    } catch (err) {
      console.error("Failed to save plan:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Subscription Management</h1>
          <p className="text-gray-500">Monitor subscriptions and manage plans</p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Active Subscriptions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                <span className="text-3xl font-bold">{stats.total_active}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Trial Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span className="text-3xl font-bold">{stats.total_trial}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Free Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-gray-600" />
                <span className="text-3xl font-bold">{stats.total_free}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                <span className="text-3xl font-bold">RM {stats.total_revenue.toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="subscriptions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="subscriptions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All User Subscriptions</CardTitle>
              <CardDescription>View and manage all active subscriptions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4">User</th>
                      <th className="text-left py-2 px-4">Plan</th>
                      <th className="text-left py-2 px-4">Status</th>
                      <th className="text-left py-2 px-4">Amount</th>
                      <th className="text-left py-2 px-4">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((sub) => (
                      <tr key={sub.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">{sub.user_name}</td>
                        <td className="py-3 px-4">{sub.plan_name}</td>
                        <td className="py-3 px-4">
                          <Badge
                            className={
                              sub.status === "active"
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }
                          >
                            {sub.status.charAt(0).toUpperCase() + sub.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">RM {sub.amount_paid.toFixed(2)}</td>
                        <td className="py-3 px-4">
                          {new Date(sub.expiry_date).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
          <div className="flex justify-end">
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                setEditingPlan(null);
                setPlanForm({ name: "", description: "", price: "" });
                setShowPlanDialog(true);
              }}
            >
              Create New Plan
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plans.map((plan) => (
              <Card key={plan.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{plan.name}</CardTitle>
                      <CardDescription>{plan.description}</CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingPlan(plan);
                        setPlanForm({
                          name: plan.name,
                          description: plan.description,
                          price: plan.unit_price.toString(),
                        });
                        setShowPlanDialog(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">RM {plan.unit_price}/month</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Plan Dialog */}
      <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPlan ? "Edit Plan" : "Create New Plan"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Plan Name</Label>
              <Input
                value={planForm.name}
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                placeholder="e.g., Cemerlang"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={planForm.description}
                onChange={(e) =>
                  setPlanForm({ ...planForm, description: e.target.value })
                }
                placeholder="e.g., Premium plan with all features"
              />
            </div>
            <div>
              <Label>Price (RM/month)</Label>
              <Input
                type="number"
                step="0.01"
                value={planForm.price}
                onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })}
                placeholder="14.90"
              />
            </div>
            <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleSavePlan}>
              Save Plan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
