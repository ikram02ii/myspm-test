import { biologyRubric } from "./biologyRubric";
import { chemistryRubric } from "./chemistryRubric";
import { generalRubric } from "./generalRubric";
import { mathematicsRubric } from "./mathematicsRubric";
import { physicsRubric } from "./physicsRubric";

function normalizeSubject(subject?: string): string {
  return (subject || "").trim().toLowerCase();
}

export function getSubjectSpecificRubric(subject?: string): string[] {
  const normalized = normalizeSubject(subject);

  if (normalized === "biology") {
    return biologyRubric();
  }

  if (normalized === "physics") {
    return physicsRubric();
  }

  if (normalized === "chemistry") {
    return chemistryRubric();
  }

  if (normalized === "mathematics" || normalized === "additional mathematics" || normalized === "add math") {
    return mathematicsRubric();
  }

  return generalRubric(subject);
}

