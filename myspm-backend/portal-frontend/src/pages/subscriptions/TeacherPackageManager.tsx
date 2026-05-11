import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Plus, Users, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface TeacherPackage {
  id: string;
  plan_name: string;
  total_seats: number;
  assigned_seats: number;
  available_seats: number;
  status: string;
  expiry_date: string;
  is_valid: boolean;
  active_assignments: number;
}

interface Student {
  id: string;
  name: string;
  email: string;
}

export function TeacherPackageManager() {
  const [packages, setPackages] = useState<TeacherPackage[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuyDialog, setShowBuyDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<TeacherPackage | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<string>("");
  const [seats, setSeats] = useState("10");

  useEffect(() => {
    fetchPackages();
    fetchStudents();
  }, []);

  const fetchPackages = async () => {
    try {
      const token = localStorage.getItem("jwt_token");
      const response = await fetch("/api/teacher/packages", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setPackages(data.packages || []);
      }
    } catch (err) {
      console.error("Failed to fetch packages:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async () => {
    try {
      const token = localStorage.getItem("jwt_token");
      const response = await fetch("/api/teacher/available-students", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setStudents(data.students || []);
      }
    } catch (err) {
      console.error("Failed to fetch students:", err);
    }
  };

  const handleBuyPackage = async () => {
    try {
      const token = localStorage.getItem("jwt_token");
      const response = await fetch("/api/teacher/package/buy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan_id: "cemerlang",
          billing_cycle: "monthly",
          teacher_package_seats: parseInt(seats),
        }),
      });
      if (response.ok) {
        const data = await response.json();
        window.location.href = `/payment?plan_id=${data.plan_id}&type=teacher_package`;
      }
    } catch (err) {
      console.error("Failed to initiate package purchase:", err);
    }
  };

  const handleAssignStudent = async () => {
    if (!selectedPackage || !selectedStudent) return;
    try {
      const token = localStorage.getItem("jwt_token");
      const response = await fetch("/api/teacher/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          teacher_package_id: selectedPackage.id,
          student_id: selectedStudent,
        }),
      });
      if (response.ok) {
        setShowAssignDialog(false);
        setSelectedStudent("");
        fetchPackages();
      }
    } catch (err) {
      console.error("Failed to assign student:", err);
    }
  };

  const handleUnassignStudent = async (assignmentId: string) => {
    try {
      const token = localStorage.getItem("jwt_token");
      const response = await fetch(`/api/teacher/unassign/${assignmentId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        fetchPackages();
      }
    } catch (err) {
      console.error("Failed to unassign student:", err);
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
          <h1 className="text-3xl font-bold">Sponsorship Packages</h1>
          <p className="text-gray-500">Manage student sponsorships and seat assignments</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowBuyDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Buy New Package
        </Button>
      </div>

      {/* Active Packages */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Your Packages</h2>
        {packages.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-gray-600">No packages purchased yet. Click "Buy New Package" to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {packages.map((pkg) => (
              <Card key={pkg.id} className={`${!pkg.is_valid ? "opacity-50" : ""}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{pkg.plan_name}</CardTitle>
                      <CardDescription>
                        Expires: {new Date(pkg.expiry_date).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <Badge
                      className={
                        pkg.status === "active"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }
                    >
                      {pkg.status.charAt(0).toUpperCase() + pkg.status.slice(1)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Seats Assigned</p>
                      <p className="text-2xl font-bold">
                        {pkg.assigned_seats}/{pkg.total_seats}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Available</p>
                      <p className="text-2xl font-bold text-green-600">{pkg.available_seats}</p>
                    </div>
                  </div>

                  {pkg.is_valid && pkg.available_seats > 0 && (
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        setSelectedPackage(pkg);
                        setShowAssignDialog(true);
                      }}
                    >
                      <Users className="w-4 h-4 mr-2" />
                      Assign Student
                    </Button>
                  )}

                  {!pkg.is_valid && (
                    <Alert className="border-red-200 bg-red-50">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-800">
                        This package has expired and cannot accept new assignments.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Buy Package Dialog */}
      <Dialog open={showBuyDialog} onOpenChange={setShowBuyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buy Sponsorship Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Number of Seats</Label>
              <Input
                type="number"
                min="1"
                max="100"
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
              />
              <p className="text-sm text-gray-500 mt-1">
                Price: RM {(parseInt(seats) * 14.9).toFixed(2)} per month
              </p>
            </div>
            <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleBuyPackage}>
              Proceed to Payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Student Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Student to Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Label>Select Student</Label>
            <select
              className="w-full border rounded px-3 py-2"
              value={selectedStudent}
              onChange={(e) => setSelectedStudent(e.target.value)}
            >
              <option value="">Choose a student...</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} ({student.email})
                </option>
              ))}
            </select>
            <Button
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={handleAssignStudent}
              disabled={!selectedStudent}
            >
              Assign Student
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
