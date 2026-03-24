import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import TeacherPostCard from "../components/TeacherPostCard";
import { TEACHER_POSTS_MOCK } from "../constants/teacherPostsMock";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";

export default function TeacherPostsScreen() {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;

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
        <Text style={styles.lead}>Tips and updates from verified educators.</Text>
        {TEACHER_POSTS_MOCK.map((post, index) => (
          <TeacherPostCard
            key={post.id}
            post={post}
            style={index > 0 ? styles.cardGap : undefined}
          />
        ))}
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
    marginBottom: 18,
  },
  cardGap: { marginTop: 12 },
});
