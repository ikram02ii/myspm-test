import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import type { CameraStackParamList } from "../navigation/CameraStack";
import { fetchScanHistory, type ScanHistoryItem } from "../services/mobileScan";

type Props = NativeStackScreenProps<CameraStackParamList, "CameraHistory">;

const BRAND = theme.brand;

export default function CameraHistoryScreen({ navigation }: Props) {
  const [items, setItems] = useState<ScanHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchScanHistory();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };

  const renderItem = ({ item }: { item: ScanHistoryItem }) => {
    return (
      <Pressable
        style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
        onPress={() => navigation.navigate("CameraPreview", { photoUri: item.url })}
      >
        <Image source={{ uri: item.url }} style={styles.tileImg} resizeMode="cover" />
      </Pressable>
    );
  };

  const data3x3 = items.slice(0, 9);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={BRAND} />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No history yet</Text>
          <Text style={styles.emptySub}>Scan and capture a question to see it here.</Text>
        </View>
      ) : (
        <FlatList
          data={data3x3}
          keyExtractor={(x) => x.key}
          numColumns={3}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.tipCard}>
              <Text style={styles.tipTitle}>Tips</Text>
              <Text style={styles.tipText}>Press the picture to ask AI for the solution</Text>
            </View>
          }
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground },
  listContent: { padding: 12, paddingBottom: 24 },
  row: { gap: 10, marginBottom: 10 },
  tipCard: {
    marginBottom: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
  },
  tipTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 4,
  },
  tipText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#E2E8F0",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
  },
  tilePressed: { opacity: 0.92 },
  tileImg: { width: "100%", height: "100%" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  loadingText: { marginTop: 10, fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  errorText: { fontSize: 14, fontFamily: fonts.medium, color: "#B91C1C", textAlign: "center" },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text, textAlign: "center" },
  emptySub: { marginTop: 6, fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, textAlign: "center" },
});

