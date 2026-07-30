import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { SpeakingGradeResponse } from "../services/mobileSpeaking";

type Props = {
  transcript?: string | null;
  markingText?: string | null;
  grade?: SpeakingGradeResponse | null;
  grades?: SpeakingGradeResponse[] | null;
  gradeTitles?: string[] | null;
  /** When this changes (e.g. new question), collapse the transcript again. */
  transcriptResetKey?: string | number | null;
};

function bandColor(band: string): string {
  const b = band.toLowerCase();
  if (b === "strong" || b === "excellent" || b === "good") return "#15803D";
  if (b === "adequate" || b === "fair") return "#A16207";
  return "#B91C1C";
}

function CriterionRow({
  label,
  score,
  maxScore,
  band,
  justification,
  showJustification,
}: {
  label: string;
  score: number;
  maxScore: number;
  band: string;
  justification: string;
  showJustification: boolean;
}) {
  return (
    <View style={styles.criterionRow}>
      <View style={styles.criterionHeader}>
        <Text style={styles.criterionLabel}>{label}</Text>
        <Text style={[styles.criterionScore, { color: bandColor(band) }]}>
          {score}/{maxScore}
        </Text>
      </View>
      <Text style={styles.criterionBand}>{band}</Text>
      {showJustification && justification.trim() ? (
        <Text style={styles.criterionJust}>{justification.trim()}</Text>
      ) : null}
    </View>
  );
}

function GradeCard({
  grade,
  title,
  defaultExpanded,
}: {
  grade: SpeakingGradeResponse;
  title?: string;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showDetails, setShowDetails] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const phaseLabel = grade.phase === "prepare" ? "Preparation" : "Response";
  const hasDetails =
    (grade.criteria?.length ?? 0) > 0 ||
    grade.strengths.length > 0 ||
    grade.improvements.length > 0;

  return (
    <View style={styles.gradeCard}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={styles.gradeHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={styles.gradeHeaderLeft}>
          {title ? <Text style={styles.gradeTitle}>{title}</Text> : null}
          <Text style={styles.scorePhase}>{phaseLabel}</Text>
        </View>
        <View style={styles.gradeHeaderRight}>
          <Text style={styles.scoreNumberCompact}>
            {grade.score}/{grade.maxScore}
          </Text>
          <Text style={[styles.scoreBand, { color: bandColor(grade.band) }]}>{grade.band}</Text>
          <Text style={styles.expandChevron}>{expanded ? "▾" : "▸"}</Text>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.gradeBody}>
          {grade.feedback.trim() ? (
            <Text style={styles.overallFeedback}>{grade.feedback.trim()}</Text>
          ) : null}

          {hasDetails ? (
            <Pressable
              onPress={() => setShowDetails((v) => !v)}
              style={styles.modelToggle}
              accessibilityRole="button"
            >
              <Text style={styles.modelToggleText}>
                {showDetails ? "Hide criteria & tips" : "Show criteria & tips"}
              </Text>
            </Pressable>
          ) : null}

          {showDetails && grade.criteria?.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Criteria</Text>
              {grade.criteria.map((c) => (
                <CriterionRow
                  key={c.id}
                  label={c.label}
                  score={c.score}
                  maxScore={c.maxScore}
                  band={c.band}
                  justification={c.justification}
                  showJustification
                />
              ))}
            </View>
          ) : null}

          {showDetails && grade.strengths.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Strengths</Text>
              {grade.strengths.map((s, i) => (
                <Text key={`s-${i}`} style={styles.bullet}>
                  • {s}
                </Text>
              ))}
            </View>
          ) : null}

          {showDetails && grade.improvements.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Improve</Text>
              {grade.improvements.map((s, i) => (
                <Text key={`i-${i}`} style={styles.bullet}>
                  • {s}
                </Text>
              ))}
            </View>
          ) : null}

          {grade.modelResponse?.trim() ? (
            <View style={styles.section}>
              <Pressable onPress={() => setShowModel((v) => !v)} style={styles.modelToggle}>
                <Text style={styles.modelToggleText}>
                  {showModel ? "Hide model answer" : "Show model answer"}
                </Text>
              </Pressable>
              {showModel ? (
                <Text style={styles.modelBody}>{grade.modelResponse.trim()}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function SpeakingFeedbackPanel({
  transcript,
  markingText,
  grade,
  grades,
  gradeTitles,
  transcriptResetKey,
}: Props) {
  const trimmedTranscript = transcript?.trim() ?? "";
  const trimmedMarking = markingText?.trim() ?? "";
  const gradeList =
    grades && grades.length > 0 ? grades : grade ? [grade] : [];
  const multiGrade = gradeList.length > 1;

  // Collapsed by default; remember expand/collapse for the current question.
  // Do not auto-open when transcription text arrives or updates.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  useEffect(() => {
    setTranscriptOpen(false);
  }, [transcriptResetKey]);

  if (!trimmedTranscript && !trimmedMarking && gradeList.length === 0) {
    return <Text style={styles.empty}>No feedback was returned for this prompt.</Text>;
  }

  return (
    <View style={styles.wrap}>
      {trimmedTranscript ? (
        <View style={styles.transcriptBox}>
          <Pressable
            onPress={() => setTranscriptOpen((v) => !v)}
            style={styles.transcriptHeader}
            accessibilityRole="button"
          >
            <Text style={styles.sectionTitle}>What you said</Text>
            <Text style={styles.transcriptToggle}>{transcriptOpen ? "Hide" : "Show"}</Text>
          </Pressable>
          {transcriptOpen ? (
            <Text style={styles.transcriptBody} selectable>
              {trimmedTranscript}
            </Text>
          ) : (
            <Text style={styles.transcriptCollapsedHint}>Tap Show to read your transcript</Text>
          )}
        </View>
      ) : null}

      {gradeList.length > 0
        ? gradeList.map((g, idx) => (
            <GradeCard
              key={`${g.phase}-${idx}-${g.score}`}
              grade={g}
              title={gradeTitles?.[idx]}
              // Multi-question sessions: all collapsed so the page stays short.
              // Single response: open the summary; criteria stay tucked away.
              defaultExpanded={!multiGrade}
            />
          ))
        : trimmedMarking
          ? (
              <View style={styles.markingBox}>
                <Text style={styles.sectionTitle}>Examiner feedback</Text>
                <Text style={styles.markingBody} selectable>
                  {trimmedMarking}
                </Text>
              </View>
            )
          : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginTop: 8 },
  transcriptBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.pillBorderBrand,
    padding: 12,
    gap: 6,
  },
  transcriptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  transcriptToggle: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: theme.brand,
  },
  transcriptCollapsedHint: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  markingBox: {
    backgroundColor: theme.brandSoftSage,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    padding: 12,
    gap: 6,
  },
  gradeCard: {
    backgroundColor: theme.brandSoftSage,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    overflow: "hidden",
  },
  gradeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  gradeHeaderLeft: { flex: 1, gap: 2 },
  gradeHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  gradeBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(15, 23, 42, 0.06)",
    paddingTop: 12,
  },
  gradeTitle: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: theme.brandDeep,
  },
  scoreNumberCompact: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: theme.brandDeep,
  },
  scorePhase: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  scoreBand: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  expandChevron: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
    width: 14,
    textAlign: "center",
  },
  overallFeedback: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
  },
  section: { gap: 6 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: theme.brandDeep,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  criterionRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  criterionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  criterionLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: colors.text,
  },
  criterionScore: {
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  criterionBand: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    textTransform: "capitalize",
  },
  criterionJust: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  bullet: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 19,
  },
  modelToggle: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  modelToggleText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: theme.brand,
  },
  modelBody: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 19,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 10,
  },
  transcriptBody: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
  },
  markingBody: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
  },
  empty: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 8,
    lineHeight: 21,
  },
});
