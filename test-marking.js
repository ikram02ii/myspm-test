/**
 * AMA Backend Test Script
 * Run with:  node test-marking.js
 *
 * Edit the QUESTIONS array below with your own questions and student answers.
 * Each test case runs one after another and prints a clean result summary.
 */

const BASE_URL = "http://localhost:3000/api/rag/grade";

// ─── Add your test cases here ────────────────────────────────────────────────

const QUESTIONS = [
  {
    
      label: "Bio 001",
      question: "State the function of the nucleus.",
      studentAnswer: "Controls all activities of the cell.",
      subject: "Biology",
      form: "4",
      maxScore: 1,
    },
    
    {
      label: "Bio 002",
      question: "State the function of the nucleus.",
      studentAnswer: "It controls what the cell does.",
      subject: "Biology",
      form: "4",
      maxScore: 1,
    },
    
    {
      label: "Bio 003",
      question: "State the function of the nucleus.",
      studentAnswer: "Contains genetic information.",
      subject: "Biology",
      form: "4",
      maxScore: 1,
    },
    
    {
      label: "Bio 004",
      question: "State the function of the nucleus.",
      studentAnswer: "Produces energy for the cell.",
      subject: "Biology",
      form: "4",
      maxScore: 1,
    },
    
    {
      label: "Bio 005",
      question: "Explain why mitochondria are called the powerhouse of the cell.",
      studentAnswer: "They release energy through respiration.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 006",
      question: "Explain why mitochondria are called the powerhouse of the cell.",
      studentAnswer: "Energy is produced in mitochondria.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 007",
      question: "Explain why mitochondria are called the powerhouse of the cell.",
      studentAnswer: "They contain enzymes for respiration.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 008",
      question: "Explain why mitochondria are called the powerhouse of the cell.",
      studentAnswer: "They store water for the cell.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 009",
      question: "Define diffusion.",
      studentAnswer: "Movement of particles from high concentration to low concentration.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 010",
      question: "Define diffusion.",
      studentAnswer: "Particles move from crowded areas to less crowded areas.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 011",
      question: "Define diffusion.",
      studentAnswer: "Movement of water molecules through a partially permeable membrane.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 012",
      question: "Explain the process of osmosis.",
      studentAnswer: "Water molecules move from a region of high water concentration to a region of low water concentration through a partially permeable membrane.",
      subject: "Biology",
      form: "4",
      maxScore: 3,
    },
    
    {
      label: "Bio 013",
      question: "Explain the process of osmosis.",
      studentAnswer: "Water moves from where there is more water to where there is less water through a membrane.",
      subject: "Biology",
      form: "4",
      maxScore: 3,
    },
    
    {
      label: "Bio 014",
      question: "Explain the process of osmosis.",
      studentAnswer: "Water moves from high concentration to low concentration.",
      subject: "Biology",
      form: "4",
      maxScore: 3,
    },
    
    {
      label: "Bio 015",
      question: "Explain the process of osmosis.",
      studentAnswer: "Salt moves through a membrane.",
      subject: "Biology",
      form: "4",
      maxScore: 3,
    },
    
    {
      label: "Bio 016",
      question: "Compare aerobic respiration and anaerobic respiration.",
      studentAnswer: "Aerobic respiration requires oxygen while anaerobic respiration does not.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 017",
      question: "Compare aerobic respiration and anaerobic respiration.",
      studentAnswer: "Aerobic uses oxygen but anaerobic happens without oxygen.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 018",
      question: "Compare aerobic respiration and anaerobic respiration.",
      studentAnswer: "Aerobic respiration requires oxygen.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 019",
      question: "Compare aerobic respiration and anaerobic respiration.",
      studentAnswer: "Both require oxygen.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 020",
      question: "Explain why root hair cells are adapted for absorption.",
      studentAnswer: "They have a large surface area for absorbing water and mineral salts.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 021",
      question: "Explain why root hair cells are adapted for absorption.",
      studentAnswer: "They are long and can absorb more water.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 022",
      question: "Explain why root hair cells are adapted for absorption.",
      studentAnswer: "They contain chloroplasts.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 023",
      question: "State the function of chlorophyll.",
      studentAnswer: "Absorbs light energy for photosynthesis.",
      subject: "Biology",
      form: "4",
      maxScore: 1,
    },
    
    {
      label: "Bio 024",
      question: "State the function of chlorophyll.",
      studentAnswer: "Captures sunlight.",
      subject: "Biology",
      form: "4",
      maxScore: 1,
    },
    
    {
      label: "Bio 025",
      question: "State the function of chlorophyll.",
      studentAnswer: "Produces oxygen.",
      subject: "Biology",
      form: "4",
      maxScore: 1,
    },
    
    {
      label: "Bio 026",
      question: "Explain why leaves are adapted for photosynthesis.",
      studentAnswer: "Leaves are broad and contain many chloroplasts to absorb more light.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 027",
      question: "Explain why leaves are adapted for photosynthesis.",
      studentAnswer: "Leaves are wide so they can get more sunlight.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 028",
      question: "Explain why leaves are adapted for photosynthesis.",
      studentAnswer: "Leaves are green.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 029",
      question: "State the products of aerobic respiration.",
      studentAnswer: "Carbon dioxide, water and energy.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
    
    {
      label: "Bio 030",
      question: "State the products of aerobic respiration.",
      studentAnswer: "Oxygen and glucose.",
      subject: "Biology",
      form: "4",
      maxScore: 2,
    },
  // Add more test cases below ↓
  // {
  //   label: "Test 4 — Your question",
  //   question: "...",
  //   studentAnswer: "...",
  //   subject: "Chemistry",
  //   form: "5",
  //   maxScore: 3,
  // },
];

// ─────────────────────────────────────────────────────────────────────────────

async function gradeOne(testCase) {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: testCase.question,
      studentAnswer: testCase.studentAnswer,
      subject: testCase.subject,
      form: testCase.form,
      maxScore: testCase.maxScore,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  return res.json();
}

function printResult(testCase, result) {
  const bar = "─".repeat(60);
  console.log(`\n${bar}`);
  console.log(`📋  ${testCase.label}`);
  console.log(`${bar}`);
  console.log(`Question  : ${testCase.question}`);
  console.log(`Answer    : ${testCase.studentAnswer}`);
  console.log(`\n⭐  Score  : ${result.score} / ${result.maxScore}`);
  console.log(`\n📝  Mark Breakdown:`);

  if (Array.isArray(result.markBreakdown)) {
    for (const row of result.markBreakdown) {
      const icon = row.awarded ? "  ✅" : "  ❌";
      console.log(`${icon}  [${row.marks}mk] ${row.idea}`);
      if (row.reason) console.log(`       → ${row.reason}`);
    }
  }

  if (result.feedback) {
    console.log(`\n💬  Feedback:`);
    console.log(`   ${result.feedback}`);
  }

  if (result.modelAnswer) {
    console.log(`\n📖  Model Answer:`);
    console.log(`   ${result.modelAnswer}`);
  }
}

async function runAll() {
  console.log("🚀  AMA Backend Test");
  console.log(`    Endpoint : ${BASE_URL}`);
  console.log(`    Tests    : ${QUESTIONS.length}`);

  let passed = 0;
  let failed = 0;

  for (const testCase of QUESTIONS) {
    try {
      const result = await gradeOne(testCase);
      printResult(testCase, result);
      passed++;
    } catch (err) {
      console.error(`\n❌  ${testCase.label} FAILED`);
      console.error(`   ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅  Passed: ${passed}   ❌  Failed: ${failed}`);
  console.log(`${"═".repeat(60)}\n`);
}

runAll();
