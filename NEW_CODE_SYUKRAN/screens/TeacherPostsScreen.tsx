import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import TeacherPostCard from "../components/TeacherPostCard";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import { fetchMobileDashboard } from "../services/mobileDashboard";
import type { TeacherFeedPost } from "../types/teacherFeedPost";

export default function TeacherPostsScreen() {
  const insets = useSafeAreaInsets();
  const webTopPadding = Platform.OS === "web" ? 67 : 0;
  const [posts, setPosts] = useState<TeacherFeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMobileDashboard(50);
      setPosts(data.teacherPosts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load posts");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: webTopPadding }]}>
      {loading ? (
        <View style={[styles.centered, { paddingTop: insets.top + 40 }]}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: insets.bottom + 120,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.lead}>Tips and updates from educators you follow.</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {!error && posts.length === 0 ? (
            <Text style={styles.empty}>No posts yet.</Text>
          ) : null}
          {posts.map((post, index) => (
            <TeacherPostCard
              key={post.id}
              post={post}
              style={index > 0 ? styles.cardGap : undefined}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBackground },
  scroll: { flex: 1 },
  centered: { flex: 1, alignItems: "center" },
  lead: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 18,
  },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: "#B91C1C",
    marginBottom: 12,
  },
  empty: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  cardGap: { marginTop: 12 },
});
