import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { Pin } from "lucide-react-native";

import type { TeacherFeedPost } from "../types/teacherFeedPost";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";

const BRAND = theme.brand;
const BRAND_SOFT = theme.brandSoft;
const BRAND_DEEP = theme.brandDeep;

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
  post: TeacherFeedPost;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <View style={styles.top}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{post.initials}</Text>
          </View>
          <View style={styles.author}>
            <Text style={styles.name}>{post.author}</Text>
            <Text style={styles.role}>
              {post.categoryLabel} · {post.audienceLabel} · {post.timeAgo}
            </Text>
          </View>
        </View>
      </View>
      {post.pinned ? (
        <View style={styles.pinnedIconWrap} accessibilityLabel="Pinned post">
          <Pin size={16} color={BRAND_DEEP} strokeWidth={2.5} />
        </View>
      ) : null}
      {post.title ? <Text style={styles.title}>{post.title}</Text> : null}
      {post.excerpt ? <Text style={styles.excerpt}>{post.excerpt}</Text> : null}
      {post.content ? (
        <Text style={[styles.body, post.excerpt ? styles.bodyAfterExcerpt : null]}>
          {post.content}
        </Text>
      ) : null}
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  top: { flex: 1, flexDirection: "row", gap: 12, alignItems: "flex-start", minWidth: 0 },
  pinnedIconWrap: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND_SOFT,
    borderWidth: 1,
    borderColor: theme.pillBorderBrand,
  },
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
  title: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
    lineHeight: 22,
    marginTop: 12,
  },
  excerpt: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    lineHeight: 21,
    marginTop: 8,
  },
  body: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 21,
    marginTop: 8,
  },
  bodyAfterExcerpt: { marginTop: 10 },
});
