import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, CreditCard } from "lucide-react";

export function PaymentPage() {
  const [location] = useLocation();
  const [paymentDetails, setPaymentDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1]);
    const planId = params.get("plan_id");
    const type = params.get("type");

    fetchPaymentDetails(planId, type);
  }, [location]);

  const fetchPaymentDetails = async (planId: string | null, type: string | null) => {
    try {
      const token = localStorage.getItem("jwt_token");
      let endpoint = "";
      let body: any = { plan_id: planId, type: type || "student_subscription" };

      if (type === "teacher_package") {
        const seats = new URLSearchParams(location.split("?")[1]).get("seats") || "10";
        body.teacher_package_seats = parseInt(seats);
      }

      if (type === "student_subscription") {
        const response = await fetch("/api/payment/details", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const data = await response.json();
          setPaymentDetails(data);
        }
      } else if (type === "teacher_package") {
        const response = await fetch("/api/teacher/package/buy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const data = await response.json();
          setPaymentDetails(data);
        }
      }
    } catch (err) {
      setError("Failed to load payment details. Please try again.");
      console.error("Payment details error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    try {
      setRedirecting(true);
      const token = localStorage.getItem("jwt_token");
      const response = await fetch("/api/payment/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(paymentDetails?.payment_request || {}),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.redirect_url) {
          window.location.href = data.redirect_url;
        }
      } else {
        setError("Payment initiation failed. Please try again.");
        setRedirecting(false);
      }
    } catch (err) {
      setError("An error occurred while processing payment.");
      setRedirecting(false);
      console.error("Payment error:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Payment</h1>
        <p className="text-gray-500">Complete your payment to activate your subscription</p>
      </div>

      {paymentDetails && (
        <>
          {/* Order Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-t pt-4">
                <div className="flex justify-between py-2">
                  <span className="text-gray-600">
                    {paymentDetails.plan?.name || "Subscription"}
                  </span>
                  <span className="font-semibold">
                    RM {paymentDetails.plan?.unit_price || 0}
                  </span>
                </div>

                {paymentDetails.package_details?.total_seats && (
                  <div className="flex justify-between py-2 text-sm text-gray-600">
                    <span>{paymentDetails.package_details.total_seats} seats</span>
                    <span>
                      RM {paymentDetails.package_details.total_amount}
                    </span>
                  </div>
                )}

                {paymentDetails.package_details?.billing_cycle && (
                  <div className="flex justify-between py-2 text-sm text-gray-600">
                    <span className="capitalize">
                      Billing: {paymentDetails.package_details.billing_cycle}
                    </span>
                  </div>
                )}
              </div>

              <div className="border-t pt-4 flex justify-between text-lg font-bold">
                <span>Total Amount</span>
                <span>RM {(paymentDetails.package_details?.total_amount || paymentDetails.plan?.unit_price || 0).toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Payment Method */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Payment Method
              </CardTitle>
              <CardDescription>
                You will be redirected to ToyyibPay to complete your payment
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800">
                  ToyyibPay accepts all major credit cards, debit cards, and online banking
                  options. Your payment is secure and encrypted.
                </p>
              </div>

              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-lg py-6"
                onClick={handlePayment}
                disabled={redirecting}
              >
                {redirecting ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Redirecting to Payment Gateway...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    Proceed to ToyyibPay
                  </>
                )}
              </Button>

              <p className="text-xs text-gray-500 text-center mt-4">
                By clicking "Proceed to ToyyibPay", you agree to our Terms of Service
              </p>
            </CardContent>
          </Card>

          {/* Security Info */}
          <Card className="bg-green-50 border-green-200">
            <CardContent className="pt-6">
              <div className="flex gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-green-800">
                  <p className="font-semibold mb-1">Your payment is secure</p>
                  <p>
                    We use industry-standard encryption to protect your payment information.
                    ToyyibPay is PCI-DSS compliant.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
