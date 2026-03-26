import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { X, Trash2 } from "lucide-react-native";

import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";
import {
  networkLoggerClear,
  networkLoggerGetLogs,
  networkLoggerSubscribe,
  type NetworkLogEntry,
} from "../../services/networkLogger";
import {
  DEFAULT_MOBILE_API_BASE_URL_PREFIX,
  getMobileApiBaseUrlPrefix,
  setMobileApiBaseUrlPrefix,
} from "../../services/mobileApiBaseUrl";

type Props = {
  visible: boolean;
  onClose: () => void;
};

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function asPrettyJson(x: unknown): string {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

export function NetworkLogOverlay({ visible, onClose }: Props) {
  const [logs, setLogs] = useState<NetworkLogEntry[]>(() => networkLoggerGetLogs());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"logs" | "settings">("logs");
  const [basePrefix, setBasePrefix] = useState(DEFAULT_MOBILE_API_BASE_URL_PREFIX);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    return networkLoggerSubscribe(() => {
      setLogs(networkLoggerGetLogs());
    });
  }, []);

  useEffect(() => {
    if (!visible) {
      setSelectedId(null);
      setDetailOpen(false);
      setTab("logs");
      setSaveHint(null);
      return;
    }
    void (async () => {
      const current = await getMobileApiBaseUrlPrefix();
      setBasePrefix(current);
    })();
  }, [visible]);

  const selected = useMemo(
    () => (selectedId ? logs.find((l) => l.id === selectedId) ?? null : null),
    [logs, selectedId],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Network logs</Text>
              <View style={styles.tabs}>
                <Pressable
                  style={[styles.tab, tab === "logs" && styles.tabActive]}
                  onPress={() => setTab("logs")}
                >
                  <Text style={[styles.tabText, tab === "logs" && styles.tabTextActive]}>Logs</Text>
                </Pressable>
                <Pressable
                  style={[styles.tab, tab === "settings" && styles.tabActive]}
                  onPress={() => setTab("settings")}
                >
                  <Text style={[styles.tabText, tab === "settings" && styles.tabTextActive]}>API</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.headerActions}>
              {tab === "logs" ? (
                <Pressable style={styles.iconBtn} onPress={() => networkLoggerClear()}>
                  <Trash2 size={18} color="#FFFFFF" />
                </Pressable>
              ) : null}
              <Pressable style={styles.iconBtn} onPress={onClose}>
                <X size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>

          {tab === "logs" ? (
            <>
              <ScrollView
                style={styles.list}
                contentContainerStyle={{ paddingBottom: 12, paddingTop: 10 }}
                showsVerticalScrollIndicator={false}
              >
                {logs.length === 0 ? (
                  <Text style={styles.empty}>No requests yet.</Text>
                ) : (
                  logs.map((l) => {
                    const ok = l.ok;
                    return (
                      <Pressable
                        key={l.id}
                        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                        onPress={() => {
                          setSelectedId(l.id);
                          setDetailOpen(true);
                        }}
                      >
                        <View style={styles.rowTop}>
                          <Text style={styles.method}>{l.method}</Text>
                          <Text style={[styles.status, ok === false && styles.statusBad]}>
                            {l.status ?? (l.error ? "ERR" : "…")}
                          </Text>
                        </View>
                        <Text style={styles.url} numberOfLines={2}>
                          {l.url}
                        </Text>
                        <Text style={styles.urlSub} numberOfLines={1}>
                          {shortUrl(l.url)}
                        </Text>
                        <Text style={styles.meta}>
                          {formatTs(l.ts)}
                          {typeof l.durationMs === "number" ? ` · ${Math.round(l.durationMs)}ms` : ""}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>

              <Modal
                visible={detailOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setDetailOpen(false)}
              >
                <Pressable style={styles.detailBackdrop} onPress={() => setDetailOpen(false)}>
                  <Pressable style={styles.detailCard} onPress={(e) => e.stopPropagation()}>
                    <View style={styles.detailHeader}>
                      <Text style={styles.detailTitle}>
                        {selected ? `${selected.method} ${selected.url}` : "Request detail"}
                      </Text>
                      <Pressable style={styles.iconBtn} onPress={() => setDetailOpen(false)}>
                        <X size={18} color="#FFFFFF" />
                      </Pressable>
                    </View>

                    {selected ? (
                      <ScrollView
                        style={styles.detail}
                        contentContainerStyle={{ paddingBottom: 12 }}
                        showsVerticalScrollIndicator={false}
                      >
                        <Text style={styles.detailMeta}>
                          {formatTs(selected.ts)}
                          {typeof selected.durationMs === "number" ? ` · ${Math.round(selected.durationMs)}ms` : ""}
                          {typeof selected.status === "number" ? ` · ${selected.status}` : ""}
                        </Text>

                        {selected.error ? (
                          <View style={styles.block}>
                            <Text style={styles.blockTitle}>Error</Text>
                            <Text style={styles.code}>{selected.error}</Text>
                          </View>
                        ) : null}

                        <View style={styles.block}>
                          <Text style={styles.blockTitle}>Request body</Text>
                          <Text style={styles.code}>
                            {selected.requestBody === undefined ? "—" : asPrettyJson(selected.requestBody)}
                          </Text>
                        </View>

                        <View style={styles.block}>
                          <Text style={styles.blockTitle}>Response body</Text>
                          <Text style={styles.code}>
                            {selected.responseBody === undefined ? "—" : asPrettyJson(selected.responseBody)}
                          </Text>
                        </View>
                      </ScrollView>
                    ) : (
                      <Text style={styles.empty}>No selection.</Text>
                    )}
                  </Pressable>
                </Pressable>
              </Modal>
            </>
          ) : (
            <View style={styles.settings}>
              <Text style={styles.settingsLabel}>Backend API base URL</Text>
              <Text style={styles.settingsHint}>
                Only the part before <Text style={styles.mono}>/api/mobile</Text> can be changed.
              </Text>
              <TextInput
                value={basePrefix}
                onChangeText={(t) => {
                  setBasePrefix(t);
                  setSaveHint(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={DEFAULT_MOBILE_API_BASE_URL_PREFIX}
                placeholderTextColor="rgba(226,232,240,0.45)"
                style={styles.input}
              />
              <Text style={styles.preview}>
                Effective base: <Text style={styles.mono}>{basePrefix.trim().replace(/\/+$/, "") || DEFAULT_MOBILE_API_BASE_URL_PREFIX}/api/mobile</Text>
              </Text>

              <View style={styles.settingsActions}>
                <Pressable
                  style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed]}
                  onPress={() => {
                    void (async () => {
                      const normalized = await setMobileApiBaseUrlPrefix(basePrefix);
                      setBasePrefix(normalized);
                      setSaveHint("Saved. Restart the app to take effect.");
                    })();
                  }}
                >
                  <Text style={styles.saveBtnText}>Save</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.resetBtn, pressed && styles.resetBtnPressed]}
                  onPress={() => {
                    void (async () => {
                      const normalized = await setMobileApiBaseUrlPrefix(DEFAULT_MOBILE_API_BASE_URL_PREFIX);
                      setBasePrefix(normalized);
                      setSaveHint("Reset to default. Restart the app to take effect.");
                    })();
                  }}
                >
                  <Text style={styles.resetBtnText}>Reset default</Text>
                </Pressable>
              </View>

              {saveHint ? <Text style={styles.saveHint}>{saveHint}</Text> : null}
            </View>
          )}

          {Platform.OS === "web" ? (
            <Text style={styles.hint}>Tip: On web, gesture toggle may not work; use the close button.</Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    padding: 14,
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#0B1220",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxHeight: "86%",
  },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0, flex: 1 },
  title: {
    color: "#FFFFFF",
    fontFamily: fonts.bold,
    fontSize: 16,
    letterSpacing: 0.2,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 3,
  },
  tab: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  tabActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  tabText: { color: "rgba(226,232,240,0.75)", fontFamily: fonts.semiBold, fontSize: 12 },
  tabTextActive: { color: "#FFFFFF" },
  headerActions: { flexDirection: "row", gap: 10 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  list: { paddingHorizontal: 10 },
  row: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: 10,
  },
  rowPressed: { opacity: 0.85 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  method: { color: "#E2E8F0", fontFamily: fonts.bold, fontSize: 12 },
  status: { color: "#A7F3D0", fontFamily: fonts.bold, fontSize: 12 },
  statusBad: { color: "#FCA5A5" },
  url: { color: "#F8FAFC", fontFamily: fonts.semiBold, fontSize: 12, marginTop: 4 },
  urlSub: {
    color: "rgba(226,232,240,0.65)",
    fontFamily: fonts.medium,
    fontSize: 11,
    marginTop: 4,
  },
  meta: { color: "rgba(226,232,240,0.7)", fontFamily: fonts.medium, fontSize: 11, marginTop: 6 },
  detailBackdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.55)", padding: 14, justifyContent: "center" },
  detailCard: {
    backgroundColor: "#0B1220",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxHeight: "86%",
  },
  detailHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  detail: { paddingHorizontal: 12, paddingTop: 10 },
  detailTitle: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 13 },
  detailMeta: { color: "rgba(226,232,240,0.7)", fontFamily: fonts.medium, fontSize: 11, marginTop: 6 },
  block: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  blockTitle: { color: "#E2E8F0", fontFamily: fonts.bold, fontSize: 12, marginBottom: 8 },
  code: {
    color: "#F8FAFC",
    fontFamily: Platform.OS === "ios" ? "Menlo" : Platform.OS === "android" ? "monospace" : fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
  empty: { color: "rgba(226,232,240,0.75)", fontFamily: fonts.medium, padding: 12 },
  hint: { color: "rgba(226,232,240,0.6)", fontFamily: fonts.medium, fontSize: 11, padding: 10 },
  settings: { paddingHorizontal: 14, paddingVertical: 14 },
  settingsLabel: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 13 },
  settingsHint: { color: "rgba(226,232,240,0.7)", fontFamily: fonts.medium, fontSize: 12, marginTop: 6, lineHeight: 18 },
  mono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : Platform.OS === "android" ? "monospace" : fonts.regular,
  },
  input: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    color: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Platform.OS === "ios" ? "Menlo" : Platform.OS === "android" ? "monospace" : fonts.regular,
    fontSize: 12,
  },
  preview: { color: "rgba(226,232,240,0.7)", fontFamily: fonts.medium, fontSize: 12, marginTop: 10 },
  settingsActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  saveBtn: {
    flex: 1,
    backgroundColor: "rgba(59, 130, 246, 0.35)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.55)",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 13 },
  resetBtn: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  resetBtnPressed: { opacity: 0.85 },
  resetBtnText: { color: "rgba(226,232,240,0.9)", fontFamily: fonts.bold, fontSize: 13 },
  saveHint: { marginTop: 12, color: "rgba(167, 243, 208, 0.95)", fontFamily: fonts.semiBold, fontSize: 12 },
});

