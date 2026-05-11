import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { assignmentsTable, assignmentStudentsTable, examsTable, usersTable } from "@workspace/db/schema";
import { eq, ilike, and, count, sql } from "drizzle-orm";
import { CreateAssignmentBody, ListAssignmentsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/assignments", async (req, res) => {
  try {
    const query = ListAssignmentsQueryParams.parse(req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (query.status) conditions.push(eq(assignmentsTable.status, query.status));
    if (query.search) conditions.push(ilike(assignmentsTable.title, `%${query.search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ count: count() }).from(assignmentsTable).where(where);
    const total = totalResult?.count ?? 0;

    const data = await db
      .select({
        id: assignmentsTable.id,
        title: assignmentsTable.title,
        examId: assignmentsTable.examId,
        dueDate: assignmentsTable.dueDate,
        status: assignmentsTable.status,
        createdBy: assignmentsTable.createdBy,
        createdAt: assignmentsTable.createdAt,
        examTitle: examsTable.title,
        subject: examsTable.subject,
      })
      .from(assignmentsTable)
      .innerJoin(examsTable, eq(assignmentsTable.examId, examsTable.id))
      .where(where)
      .orderBy(sql`${assignmentsTable.id} DESC`)
      .limit(limit)
      .offset(offset);

    const assignments = await Promise.all(
      data.map(async (a) => {
        const [assignedCount] = await db.select({ count: count() }).from(assignmentStudentsTable).where(eq(assignmentStudentsTable.assignmentId, a.id));
        const [submissionCount] = await db.select({ count: count() }).from(assignmentStudentsTable).where(and(eq(assignmentStudentsTable.assignmentId, a.id), eq(assignmentStudentsTable.submitted, true)));
        return {
          ...a,
          assignedCount: assignedCount?.count ?? 0,
          submissionCount: submissionCount?.count ?? 0,
          dueDate: a.dueDate.toISOString(),
          createdAt: a.createdAt.toISOString(),
        };
      })
    );

    res.json({ data: assignments, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("List assignments error:", error);
    res.status(500).json({ error: "Failed to list assignments" });
  }
});

router.post("/assignments", async (req, res) => {
  try {
    const body = CreateAssignmentBody.parse(req.body);
    const { studentIds, ...assignmentData } = body;

    const [exam] = await db.select().from(examsTable).where(eq(examsTable.id, body.examId));
    if (!exam) {
      res.status(400).json({ error: "Exam not found" });
      return;
    }

    const [assignment] = await db.insert(assignmentsTable).values({ ...assignmentData, dueDate: new Date(body.dueDate) }).returning();

    for (const studentId of studentIds) {
      await db.insert(assignmentStudentsTable).values({ assignmentId: assignment.id, studentId });
    }

    res.status(201).json({
      ...assignment,
      subject: exam.subject,
      examTitle: exam.title,
      assignedCount: studentIds.length,
      submissionCount: 0,
      dueDate: assignment.dueDate.toISOString(),
      createdAt: assignment.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Create assignment error:", error);
    res.status(500).json({ error: "Failed to create assignment" });
  }
});

router.get("/assignments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [assignment] = await db
      .select({
        id: assignmentsTable.id,
        title: assignmentsTable.title,
        examId: assignmentsTable.examId,
        dueDate: assignmentsTable.dueDate,
        status: assignmentsTable.status,
        createdBy: assignmentsTable.createdBy,
        createdAt: assignmentsTable.createdAt,
        examTitle: examsTable.title,
        subject: examsTable.subject,
      })
      .from(assignmentsTable)
      .innerJoin(examsTable, eq(assignmentsTable.examId, examsTable.id))
      .where(eq(assignmentsTable.id, id));

    if (!assignment) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    const studentsData = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        submitted: assignmentStudentsTable.submitted,
        score: assignmentStudentsTable.score,
      })
      .from(assignmentStudentsTable)
      .innerJoin(usersTable, eq(assignmentStudentsTable.studentId, usersTable.id))
      .where(eq(assignmentStudentsTable.assignmentId, id));

    const [assignedCount] = await db.select({ count: count() }).from(assignmentStudentsTable).where(eq(assignmentStudentsTable.assignmentId, id));
    const [submissionCount] = await db.select({ count: count() }).from(assignmentStudentsTable).where(and(eq(assignmentStudentsTable.assignmentId, id), eq(assignmentStudentsTable.submitted, true)));

    res.json({
      ...assignment,
      assignedCount: assignedCount?.count ?? 0,
      submissionCount: submissionCount?.count ?? 0,
      dueDate: assignment.dueDate.toISOString(),
      createdAt: assignment.createdAt.toISOString(),
      students: studentsData,
    });
  } catch (error) {
    console.error("Get assignment error:", error);
    res.status(500).json({ error: "Failed to get assignment" });
  }
});

router.put("/assignments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = CreateAssignmentBody.parse(req.body);
    const { studentIds, ...assignmentData } = body;

    const [assignment] = await db.update(assignmentsTable).set({ ...assignmentData, dueDate: new Date(body.dueDate) }).where(eq(assignmentsTable.id, id)).returning();
    if (!assignment) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    await db.delete(assignmentStudentsTable).where(eq(assignmentStudentsTable.assignmentId, id));
    for (const studentId of studentIds) {
      await db.insert(assignmentStudentsTable).values({ assignmentId: id, studentId });
    }

    const [exam] = await db.select().from(examsTable).where(eq(examsTable.id, body.examId));

    res.json({
      ...assignment,
      subject: exam?.subject ?? "",
      examTitle: exam?.title ?? "",
      assignedCount: studentIds.length,
      submissionCount: 0,
      dueDate: assignment.dueDate.toISOString(),
      createdAt: assignment.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Update assignment error:", error);
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

router.post("/assignments/:id/close", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(assignmentsTable).set({ status: "closed" }).where(eq(assignmentsTable.id, id));
    res.json({ success: true, message: "Assignment closed" });
  } catch (error) {
    console.error("Close assignment error:", error);
    res.status(500).json({ error: "Failed to close assignment" });
  }
});

export default router;
