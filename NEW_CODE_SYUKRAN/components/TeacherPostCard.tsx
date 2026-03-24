import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";

import type { TeacherPost } from "../constants/teacherPostsMock";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";

const BRAND = theme.brand;
const BRAND_SOFT = theme.brandSoft;

const cardShadow = {
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 14
};

export default function TeacherPostCard({
  post,
  style,
}: {
  post: TeacherPost;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.top}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{post.initials}</Text>
        </View>
        <View style={styles.author}>
          <Text style={styles.name}>{post.author}</Text>
          <Text style={styles.role}>
            {post.role} · {post.timeAgo}
          </Text>
        </View>
      </View>
      <Text style={styles.body}>{post.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    ...cardShadow,
  },
  top: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: BRAND_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontFamily: fonts.bold, color: BRAND },
  author: { flex: 1 },
  name: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  role: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 2 },
  body: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
    marginTop: 14,
  },
});
