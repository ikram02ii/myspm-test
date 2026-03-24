import React, { useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight } from "lucide-react-native";

import PracticeSubjectIcon from "../components/PracticeSubjectIcon";
import {
  PRACTICE_SUBJECT_CATALOG,
  type PracticeSubjectDef,
} from "../constants/practiceSubjects";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { PracticeStackParamList } from "../navigation/PracticeStack";

const BRAND = theme.brand;
const BRAND_SOFT = theme.brandSoft;
const CARD_BORDER = "rgba(15, 23, 42, 0.06)";

const cardShadow = {
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 14,
  elevation: 3,
};

type Props = NativeStackScreenProps<PracticeStackParamList, "AddPracticeSubject">;

export default function AddPracticeSubjectScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;
  const currentIds = route.params.currentSubjectIds;

  const available = useMemo(
    () => PRACTICE_SUBJECT_CATALOG.filter((s) => !currentIds.includes(s.id)),
    [currentIds]
  );

  const pick = (s: PracticeSubjectDef) => {
    navigation.navigate({
      name: "PracticeIndex",
      params: { addedSubjectId: s.id },
      merge: true,
    });
  };

  return (
    <View style={[styles.root, { paddingTop: webTopPadding }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>
          Choose a subject to add to your practice setup. You can switch between subjects anytime.
        </Text>
        {available.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>All set</Text>
            <Text style={styles.emptySub}>Every subject is already in your list.</Text>
          </View>
        ) : (
          available.map((s) => (
            <Pressable
              key={s.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => pick(s)}
            >
              <View style={styles.iconWrap}>
                <PracticeSubjectIcon type={s.icon} color={BRAND} size={22} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{s.label}</Text>
                <Text style={styles.rowMeta}>{s.topicsActive} topics active</Text>
              </View>
              <ChevronRight size={20} color={colors.textTertiary} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  scroll: { flex: 1 },
  lead: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 14,
    ...cardShadow,
  },
  rowPressed: { opacity: 0.92 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: BRAND_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  rowMeta: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 2 },
  empty: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    ...cardShadow,
  },
  emptyTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  emptySub: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginTop: 8,
    textAlign: "center",
  },
});
