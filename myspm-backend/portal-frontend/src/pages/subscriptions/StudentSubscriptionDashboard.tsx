import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircle, CheckCircle, Clock, Zap } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Subscription {
  id: string;
  plan_id: string;
  plan_name: string;
  status: string;
  start_date: string;
  expiry_date: string;
  auto_renew: boolean;
  billing_cycle: string;
  amount_paid: number;
  subscription_type: string;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  unit_price: number;
  features: string[];
}

export function StudentSubscriptionDashboard() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubscription();
    fetchPlans();
  }, []);

  const fetchSubscription = async () => {
    try {
      const token = localStorage.getItem("jwt_token");
      const response = await fetch("/api/student/subscription", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setSubscription(data.subscription);
      }
    } catch (err) {
      console.error("Failed to fetch subscription:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPlans = async () => {
    try {
      const response = await fetch("/api/plans");
      if (response.ok) {
        const data = await response.json();
        setAvailablePlans(data.plans || []);
      }
    } catch (err) {
      console.error("Failed to fetch plans:", err);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "trial":
        return "bg-blue-100 text-blue-800";
      case "expired":
        return "bg-red-100 text-red-800";
      case "free":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <CheckCircle className="w-4 h-4" />;
      case "trial":
        return <Clock className="w-4 h-4" />;
      case "expired":
        return <AlertCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const daysUntilExpiry = (expiryDate: string) => {
    const now = new Date();
    const expiry = new Date(expiryDate);
    const days = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
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
      <div>
        <h1 className="text-3xl font-bold">My Subscription</h1>
        <p className="text-gray-500">Manage your MySPM subscription and upgrade anytime</p>
      </div>

      {subscription ? (
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-blue-500" />
                <div>
                  <CardTitle className="text-2xl">{subscription.plan_name}</CardTitle>
                  <CardDescription>
                    {subscription.subscription_type === "sponsored" ? "Sponsored by your teacher" : "Your current plan"}
                  </CardDescription>
                </div>
              </div>
              <Badge className={getStatusColor(subscription.status)}>
                <span className="flex items-center gap-2">
                  {getStatusIcon(subscription.status)}
                  {subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
                </span>
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Billing Cycle</p>
                <p className="text-lg font-semibold capitalize">{subscription.billing_cycle}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Amount Paid</p>
                <p className="text-lg font-semibold">RM {subscription.amount_paid.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Expiry Date</p>
                <p className="text-lg font-semibold">
                  {new Date(subscription.expiry_date).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Days Remaining</p>
                <p className="text-lg font-semibold text-green-600">
                  {daysUntilExpiry(subscription.expiry_date)} days
                </p>
              </div>
            </div>

            {subscription.status === "trial" && daysUntilExpiry(subscription.expiry_date) <= 7 && (
              <Alert className="border-orange-200 bg-orange-50">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-800">
                  Your trial expires in {daysUntilExpiry(subscription.expiry_date)} days. Upgrade now!
                </AlertDescription>
              </Alert>
            )}

            {subscription.auto_renew && (
              <Alert className="border-blue-200 bg-blue-50">
                <CheckCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  Auto-renewal is enabled. Subscription will renew automatically.
                </AlertDescription>
              </Alert>
            )}

            {subscription.status !== "active" && subscription.status !== "trial" && (
              <Button className="w-full bg-blue-600 hover:bg-blue-700">
                Upgrade Now
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No Active Subscription</CardTitle>
            <CardDescription>You're currently on the free plan</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">Start your trial or upgrade to access premium features</p>
            <Button className="bg-blue-600 hover:bg-blue-700">Start Trial</Button>
          </CardContent>
        </Card>
      )}

      {/* Available Plans */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {availablePlans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-3xl font-bold">RM {plan.unit_price}</span>
                  <span className="text-gray-500">/month</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {plan.features?.map((feature: string, idx: number) => (
                    <li key={idx} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button className="w-full">Upgrade to {plan.name}</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
