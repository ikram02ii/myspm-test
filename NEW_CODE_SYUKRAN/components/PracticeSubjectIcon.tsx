import React from "react";
import {
  Atom,
  BookOpen,
  Calculator,
  FlaskConical,
  Landmark,
  Languages,
  Leaf,
  Sigma,
} from "lucide-react-native";

import type { PracticeSubjectIconId } from "../constants/practiceSubjects";

export default function PracticeSubjectIcon({
  type,
  color,
  size = 22,
}: {
  type: PracticeSubjectIconId;
  color: string;
  size?: number;
}) {
  if (type === "calc") return <Calculator size={size} color={color} />;
  if (type === "landmark") return <Landmark size={size} color={color} />;
  if (type === "sigma") return <Sigma size={size} color={color} />;
  if (type === "flask") return <FlaskConical size={size} color={color} />;
  if (type === "atom") return <Atom size={size} color={color} />;
  if (type === "leaf") return <Leaf size={size} color={color} />;
  if (type === "book") return <BookOpen size={size} color={color} />;
  return <Languages size={size} color={color} />;
}
