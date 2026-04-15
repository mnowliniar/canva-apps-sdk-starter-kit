import React, { useEffect, useState, useRef } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { upload } from "@canva/asset";
import { addElementAtPoint, createRichtextRange } from "@canva/design";
import { requestOpenExternalUrl } from "@canva/platform";
import { auth } from "@canva/user";

/* eslint-disable react/forbid-elements */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */

const API = "https://data.indianarealtors.com/api/canva";
const TEXT = `${API}/text_data`;
const LS_TOKEN_KEY = "iar_canva_access_token_v1";

function loadToken(): string {
  try {
    return localStorage.getItem(LS_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}


function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function j<T>(u: string, token: string) {
  const r = await fetch(u, { headers: { ...authHeaders(token) } });
  if (!r.ok) throw new Error(`${u} (${r.status})`);
  return (await r.json()) as T;
}


// Helper to generate and insert AI caption
async function generateAndInsertCaption(params: {
  geo_id: number | string;
  viz_id: number | string;
  proptype?: string;
}) {
  try {
    const qs = new URLSearchParams({
      geo_id: String(params.geo_id),
      viz_id: String(params.viz_id),
      proptype: params.proptype ?? "all",
    });
    const token = loadToken();
    const res = await fetch(`${API}/caption?${qs.toString()}`, { headers: { ...authHeaders(token) } });
    if (!res.ok) throw new Error(`AI caption request failed (${res.status})`);

    const data = await res.json(); // { caption: "...", payload: {...} }

    const range = createRichtextRange();
    range.appendText(data.caption ?? "", { fontWeight: "normal" } as any);

    await addElementAtPoint({
      type: "richtext",
      range,
      top: 0,
      left: 0,
      width: 550,
      height: 180,
    } as any);
  } catch (e) {
    console.error(e);
  }
}

type Item = {
  id: string | number;
  name?: string;
  title?: string;
  subtitle?: string;
  label?: string;
  protected?: boolean;
};

// Saved Sets (Templates)
type SavedTemplate = {
  id: string;
  name: string;
  geoType: string;
  geoId: string;
  geoLabel?: string;
  timespanId: string;
  vizIds: string[]; // up to 3
  widget: "kpi" | "strip" | "chart" | "dot_range_h" | "text";
  presetId: string;
  options: {
    showTitle: boolean;
    color: string;
    bg: string;
    border: boolean;
    fontSize: string;
  };
  savedAt: string; // ISO
};

const LS_KEY = "iar_canva_saved_sets_v1";

function loadAllTemplates(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedTemplate[]) : [];
  } catch {
    return [];
  }
}

function saveAllTemplates(items: SavedTemplate[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

type Step = 0 | 1 | 2;

export function App() {
  const intl = useIntl();
  const steps = [
    intl.formatMessage({
      defaultMessage: "Pick your market",
      description: "Step label for the first step in the app flow",
    }),
    intl.formatMessage({
      defaultMessage: "Pick metrics",
      description: "Step label for the second step in the app flow",
    }),
    intl.formatMessage({
      defaultMessage: "Options & insert",
      description: "Step label for the third step in the app flow",
    }),
  ] as const;
  // --- Auth gate ---
  const [authStatus, setAuthStatus] = useState<"checking" | "linked" | "unlinked">("checking");
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");

  async function getCanvaHeaders(): Promise<Record<string, string>> {
    try {
      const token = await auth.getCanvaUserToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  async function jWithCanva<T>(u: string) {
    const r = await fetch(u, { headers: { ...(await getCanvaHeaders()) } });
    if (!r.ok) throw new Error(`${u} (${r.status})`);
    return (await r.json()) as T;
  }

  async function trySilentLink() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const headers = await getCanvaHeaders();
      if (!headers.Authorization) {
        setAuthStatus("unlinked");
        return;
      }

      const r = await fetch(`${API}/auth/silent-link`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({}),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAuthStatus("unlinked");
        setAuthError(String(data?.detail || data?.error || `Silent link failed (${r.status})`));
        return;
      }

      setAuthStatus(data?.linked ? "linked" : "unlinked");
    } catch (e: any) {
      setAuthStatus("unlinked");
      setAuthError(String(e?.message || e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function createLinkTicket() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const headers = await getCanvaHeaders();
      const r = await fetch(`${API}/auth/create-link-ticket`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({}),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(String(data?.detail || data?.error || `Create link ticket failed (${r.status})`));
      }
      return data;
    } finally {
      setAuthBusy(false);
    }
  }

  async function openLinkFlow() {
    try {
      const data = await createLinkTicket();
      if (data?.linked) {
        setAuthStatus("linked");
        return;
      }
      if (!data?.link_url) {
        throw new Error("No link URL was returned.");
      }
      await requestOpenExternalUrl({ url: data.link_url });
    } catch (e: any) {
      setAuthError(String(e?.message || e));
    }
  }

  function logout() {
    setAuthStatus("unlinked");
    setAuthError("");
  }
  const CHART_PRESETS = [
    {
      id: "chart-square",
      label: intl.formatMessage({
        defaultMessage: "Square",
        description: "Preset size label for a square chart widget",
      }),
      w: 600,
      h: 600,
    },
    {
      id: "chart-wide",
      label: intl.formatMessage({
        defaultMessage: "Wide",
        description: "Preset size label for a wide chart widget",
      }),
      w: 600,
      h: 400,
    },
  ];

  const KPI_PRESETS = [
    {
      id: "kpi-tall",
      label: intl.formatMessage({
        defaultMessage: "Tall Card",
        description: "Preset size label for a tall KPI card widget",
      }),
      w: 200,
      h: 250,
    },
    {
      id: "kpi-wide",
      label: intl.formatMessage({
        defaultMessage: "Wide Card",
        description: "Preset size label for a wide KPI card widget",
      }),
      w: 550,
      h: 110,
    },
  ];

  const STRIP_PRESETS = [
    {
      id: "strip-reg",
      label: intl.formatMessage({
        defaultMessage: "Regular Card",
        description: "Preset size label for a regular three-stat strip card widget",
      }),
      w: 650,
      h: 300,
    },
    {
      id: "strip-wide",
      label: intl.formatMessage({
        defaultMessage: "Wide Card",
        description: "Preset size label for a wide three-stat strip card widget",
      }),
      w: 850,
      h: 300,
    },
  ];

  const DOT_PRESETS = [
    {
      id: "range-square",
      label: intl.formatMessage({
        defaultMessage: "Regular",
        description: "Preset size label for a regular range plot widget",
      }),
      w: 325,
      h: 200,
    },
  ];

  const TEXT_PRESETS = [
    {
      id: "text-wide",
      label: intl.formatMessage({
        defaultMessage: "Text Box",
        description: "Preset size label for a text summary widget",
      }),
      w: 550,
      h: 200,
    },
  ];

  const SMALL_PRESETS = [
    {
      id: "little-chart-square",
      label: intl.formatMessage({
        defaultMessage: "Square",
        description: "Preset size label for a square compact chart widget",
      }),
      w: 600,
      h: 600,
    },
    {
      id: "little-chart-wide",
      label: intl.formatMessage({
        defaultMessage: "Wide",
        description: "Preset size label for a wide compact chart widget",
      }),
      w: 600,
      h: 400,
    },
  ];
  const WIDGETS = [
    {
      id: "kpi",
      label: intl.formatMessage({
        defaultMessage: "Single stat card",
        description: "Widget option label for the single KPI stat card",
      }),
      desc: intl.formatMessage({
        defaultMessage: "One big number with a sparkline.",
        description: "Widget option description for the single KPI stat card",
      }),
      preview: "kpi",
    },
    {
      id: "strip",
      label: intl.formatMessage({
        defaultMessage: "Three stat strip",
        description: "Widget option label for the three-stat strip card",
      }),
      desc: intl.formatMessage({
        defaultMessage: "Three quick stats side-by-side.",
        description: "Widget option description for the three-stat strip card",
      }),
      preview: "strip",
    },
    {
      id: "chart",
      label: intl.formatMessage({
        defaultMessage: "Full chart",
        description: "Widget option label for the full chart widget",
      }),
      desc: intl.formatMessage({
        defaultMessage: "Change over time or by category.",
        description: "Widget option description for the full chart widget",
      }),
      preview: "chart",
    },
    {
      id: "text",
      label: intl.formatMessage({
        defaultMessage: "Text summary",
        description: "Widget option label for the text summary widget",
      }),
      desc: intl.formatMessage({
        defaultMessage: "Copy-ready takeaways (2–3 facts).",
        description: "Widget option description for the text summary widget",
      }),
      preview: "text",
    },
    {
      id: "dot_range_h",
      label: intl.formatMessage({
        defaultMessage: "Range plot",
        description: "Widget option label for the range plot widget",
      }),
      desc: intl.formatMessage({
        defaultMessage: "Compares the latest value to an expected range.",
        description: "Widget option description for the range plot widget",
      }),
      preview: "range",
    },
  ] as const;

  const PREVIEW_LABELS: Record<string, string> = {
  kpi: intl.formatMessage({
    defaultMessage: "kpi",
    description: "Fallback preview label for the KPI widget preview",
  }),
  strip: intl.formatMessage({
    defaultMessage: "strip",
    description: "Fallback preview label for the strip widget preview",
  }),
  chart: intl.formatMessage({
    defaultMessage: "chart",
    description: "Fallback preview label for the chart widget preview",
  }),
  text: intl.formatMessage({
    defaultMessage: "text",
    description: "Fallback preview label for the text widget preview",
  }),
  range: intl.formatMessage({
    defaultMessage: "range",
    description: "Fallback preview label for the range widget preview",
  }),
};

  // ---- Widget preview SVGs (inline; swap paths anytime) ----
  const PreviewChart = () => (
    <svg width="56" height="36" viewBox="0 0 56 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.85" y="1.79" width="28.45" height="4.55" rx="2" ry="2" fill="#e6e7e8" />
      <rect x="1.85" y="8.69" width="52.29" height="25.59" rx="2" ry="2" fill="#e6e7e8" />
      <polyline
        points="2.64 27.82 11.58 23.1 21.72 25.07 30.2 19.94 40.91 22.9 53.33 17.55"
        fill="none"
        stroke="#a7a9ac"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <rect width="56" height="36" fill="none" />
    </svg>
  );

  const PreviewKpi = () => (
    <svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" width="56" height="36" viewBox="0 0 56 36">
      <rect x="1.85" y="1.79" width="28.45" height="4.55" rx="2" ry="2" fill="#e6e7e8"/>
      <rect x="1.85" y="8.69" width="52.29" height="5.21" rx="2" ry="2" fill="#a7a9ac"/>
      <polyline points="4.34 30.55 11.31 28.04 19.22 29.09 25.83 26.36 34.19 27.93 43.87 25.09" fill="none" stroke="#d1d3d4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
      <rect width="56" height="36" fill="none"/>
    </svg>
  );

  const PreviewText = () => (
    <svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" width="56" height="36" viewBox="0 0 56 36">
      <rect x="1.85" y="6.27" width="28.45" height="4.55" rx="2" ry="2" fill="#a7a9ac"/>
      <rect x="1.85" y="13.17" width="52.29" height="5.21" rx="2" ry="2" fill="#d1d3d4"/>
      <rect x="1.85" y="20.45" width="52.29" height="5.21" rx="2" ry="2" fill="#d1d3d4"/>
      <rect width="56" height="36" fill="none"/>
    </svg>
  );

  const PreviewStrip = () => (
    <svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" width="56" height="36" viewBox="0 0 56 36">
      <rect x=".73" y="7.72" width="16.6" height="19.39" rx="2" ry="2" fill="#e6e7e8"/>
      <rect x="2.93" y="11.13" width="12.2" height="5.21" rx="2" ry="2" fill="#a7a9ac"/>
      <rect x="19.83" y="7.72" width="16.6" height="19.39" rx="2" ry="2" fill="#e6e7e8"/>
      <rect x="38.93" y="7.72" width="16.6" height="19.39" rx="2" ry="2" fill="#e6e7e8"/>
      <rect width="56" height="36" fill="none"/>
      <rect x="22.03" y="11.1" width="12.2" height="5.21" rx="2" ry="2" fill="#a7a9ac"/>
      <rect x="41.14" y="11.13" width="12.2" height="5.21" rx="2" ry="2" fill="#a7a9ac"/>
    </svg>
  );

  const PreviewRange = () => (
    <svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" width="56" height="36" viewBox="0 0 56 36">
      <rect x="2.6" y="3.8" width="49.96" height="27.42" rx="2" ry="2" fill="#f1f2f2"/>
      <rect x="4.66" y="6.5" width="23.47" height="5.21" rx="2" ry="2" fill="#d1d3d4"/>
      <rect x="4.66" y="21.85" width="45.6" height="4" rx="2" ry="2" fill="#d1d3d4"/>
      <rect width="56" height="36" fill="none"/>
      <circle cx="38.72" cy="23.69" r="3.26" fill="#a7a9ac"/>
    </svg>
  );

  const PREVIEW_BY_WIDGET: Record<string, React.ReactNode> = {
    chart: <PreviewChart />,
    kpi: <PreviewKpi />,
    text: <PreviewText />,
    strip: <PreviewStrip />,
    dot_range_h: <PreviewRange />,
  };


  const PRESET_MAP = {
    kpi: KPI_PRESETS,
    strip: STRIP_PRESETS,
    chart: CHART_PRESETS,
    text: TEXT_PRESETS,
    dot_range_h: DOT_PRESETS,
    little_chart: SMALL_PRESETS
  } as const;

  const RECOMMENDED_VIZ_IDS = new Set<string>([
    "8","10","63","29","28","6","69","7","65","118","11","55","112"
  ]);
  const isRecommendedViz = (v: Item) => RECOMMENDED_VIZ_IDS.has(String(v.id));
  // data
  const [geoTypes, setGeoTypes] = useState<string[]>([]);
  const [geos, setGeos] = useState<Item[]>([]);
  const [timespans, setTimespans] = useState<Item[]>([]);
  const [vizzes, setVizzes] = useState<Item[]>([]);
  const ALLOWED_GEO_TYPES = ["county", "zip code", "state", "township"];
  const visibleGeoTypes = geoTypes.filter((t) =>
    ALLOWED_GEO_TYPES.includes(String(t).toLowerCase().trim())
  );

  // selections
  const [geoType, setGeoType] = useState<string>("");
  const [geo, setGeo] = useState<Item | null>(null);
  const [timespan, setTimespan] = useState<Item | null>(null);

  const BUNDLE_MAX = 3;
  const [selectedVizzes, setSelectedVizzes] = useState<Item[]>([]);

  const isSelectedViz = (id: string | number) =>
    selectedVizzes.some((v) => String(v.id) === String(id));

  function addVizToBundle(v: Item) {
    if (isSelectedViz(v.id)) return;
    if (selectedVizzes.length >= BUNDLE_MAX) return;
    setSelectedVizzes((prev) => [...prev, v]);
  }

  function removeVizFromBundle(id: string | number) {
    setSelectedVizzes((prev) => prev.filter((v) => String(v.id) !== String(id)));
  }

  function clearBundle() {
    setSelectedVizzes([]);
  }

  // ui
  const [q, setQ] = useState("");
  const [vizQ, setVizQ] = useState("");
  const [step, setStep] = useState<Step>(0);

  // options
  const [widget, setWidget] = useState<"kpi"|"strip"|"chart"|"dot_range_h"|"text">("kpi");
  const presetSet = PRESET_MAP[widget] ?? CHART_PRESETS;
  const [presetId, setPresetId] = useState(presetSet[0]!.id);
  const activePreset = presetSet.find(p => p.id === presetId) ?? presetSet[0];
  useEffect(() => {
    if (!presetSet.some((p) => p.id === presetId)) {
      setPresetId(presetSet[0]!.id);
    }
  }, [widget]);
  const [proptype] = useState<"all" | "dsf" | "tco">("all");
  const [showTitle, setShowTitle] = useState(true);
  const [color, setColor] = useState<string>(""); // hex like #006E8E (empty = use default)
  const [bg, setBg] = useState<string>("white"); // transparent | white
  const [border, setBorder] = useState<boolean>(false);
  const [fontSize, setFontSize] = useState<string>("normal"); // compact | normal | large

  // saved sets (localStorage)
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string>("");
  const [templateName, setTemplateName] = useState<string>("");
  const [showManageSets, setShowManageSets] = useState<boolean>(false);
  const [confirmDeleteArmed, setConfirmDeleteArmed] = useState<boolean>(false);
  const pendingVizIdsRef = useRef<string[] | null>(null);
  const pendingGeoIdRef = useRef<string | null>(null);

  // post-insert UX
  const [lastInsertCount, setLastInsertCount] = useState<number>(0);
  const [postInsertMode, setPostInsertMode] = useState<boolean>(false);

  // loader/progress
  const [isInserting, setIsInserting] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<number | null>(null);

  function startProgress() {
    setProgress(8);
    if (progressRef.current) return;
    progressRef.current = window.setInterval(() => {
      setProgress(p => Math.min(90, p + Math.max(0.4, (90 - p) * 0.03)));
    }, 200);
  }
  function bump(to: number) { setProgress(p => Math.max(p, to)); }
  function finishProgress() {
    setProgress(100);
    setTimeout(() => setIsInserting(false), 250);
  }
  function stopProgress() {
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
  }

  // boot
  useEffect(() => {
    j<{ items: string[] }>(`${API}/geo_types`, "").then((d) => setGeoTypes(d.items));
    j<{ items: Item[] }>(`${API}/timespans`, "").then((d) => setTimespans(d.items));
    setTemplates(loadAllTemplates());
    void trySilentLink();
  }, []);

  // default timeframe (monthly) once timespans load
  useEffect(() => {
    if (timespan || timespans.length === 0) return;
    const monthly = timespans.find((t) => String(t.id) === "month");
    setTimespan(monthly ?? timespans[0]!);
  }, [timespans, timespan]);

  // geos for type
  useEffect(() => {
    if (!geoType) {
      setGeos([]);
      return;
    }
    const url = new URL(`${API}/geos`);
    url.searchParams.set("type", geoType);
    if (q) url.searchParams.set("q", q);
    j<{ items: Item[] }>(url.toString(), "").then((d) => {
      const items = authStatus === "linked"
        ? d.items
        : d.items.filter((g) => !g.protected);
      setGeos(items);
    });
  }, [geoType, q, authStatus]);

  // vizzes for geo+timespan
  useEffect(() => {
    if (!geo || !timespan) {
      setVizzes([]);
      setSelectedVizzes([]);
      return;
    }
    const url = new URL(`${API}/vizzes`);
    url.searchParams.set("geo_id", String(geo.id));
    url.searchParams.set("timespan", String(timespan.id));
    j<{ items: Item[] }>(url.toString(), "").then((d) => {
      const items = authStatus === "linked"
        ? d.items
        : d.items.filter((v) => !v.protected);
      setVizzes(items);
      setSelectedVizzes((prev) =>
        prev.filter((v) => items.some((item) => String(item.id) === String(v.id)))
      );
    });
  }, [geo, timespan, authStatus]);

  // Apply pending viz ids from template after vizzes load
  useEffect(() => {
    const pending = pendingVizIdsRef.current;
    if (!pending || pending.length === 0) return;
    if (!vizzes || vizzes.length === 0) return;

    const picked: Item[] = [];
    for (const id of pending) {
      const hit = vizzes.find((v) => String(v.id) === String(id));
      if (hit) picked.push(hit);
      if (picked.length >= BUNDLE_MAX) break;
    }

    setSelectedVizzes(picked);
    pendingVizIdsRef.current = null;
  }, [vizzes]);

  // Apply pending geo id from template after geos load
  useEffect(() => {
    const pendingGeoId = pendingGeoIdRef.current;
    if (!pendingGeoId) return;
    if (!geos || geos.length === 0) return;

    const hit = geos.find((g) => String(g.id) === String(pendingGeoId)) || null;
    if (!hit) return;

    setGeo(hit);
    pendingGeoIdRef.current = null;

    // jump straight to insert step once market is resolved
    setStep(2);
  }, [geos]);

  // Templates (saved sets)
  const allTemplatesSorted = [...templates].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));

  const activeTemplate = allTemplatesSorted.find((t) => t.id === activeTemplateId) || null;
  const canLoadAnyTemplate = allTemplatesSorted.length > 0;

  // Template helpers
  function snapshotCurrentTemplate(name: string): SavedTemplate | null {
    if (!geo || !timespan) return null;
    if (selectedVizzes.length === 0) return null;

    const vizIds = selectedVizzes.map((v) => String(v.id)).slice(0, BUNDLE_MAX);

    return {
      id: makeId(),
      name:
        name.trim() ||
        intl.formatMessage({
          defaultMessage: "Untitled",
          description: "Fallback name used when the user saves a set without entering a custom name",
        }),
      geoType,
      geoId: String(geo.id),
      geoLabel: (geo.name || geo.label) as any,
      timespanId: String(timespan.id),
      vizIds,
      widget,
      presetId,
      options: {
        showTitle,
        color,
        bg,
        border,
        fontSize,
      },
      savedAt: new Date().toISOString(),
    };
  }

  function saveNewTemplate() {
    const t = snapshotCurrentTemplate(templateName);
    if (!t) return;
    const next = [t, ...templates];
    setTemplates(next);
    saveAllTemplates(next);
    setActiveTemplateId(t.id);
    setTemplateName("");
    setPostInsertMode(false);
  }


  function armDeleteOnce() {
    setConfirmDeleteArmed(true);
    window.setTimeout(() => setConfirmDeleteArmed(false), 3500);
  }

  function deleteActiveTemplate() {
    if (!activeTemplate) return;
    const next = templates.filter((x) => x.id !== activeTemplate.id);
    setTemplates(next);
    saveAllTemplates(next);
    setActiveTemplateId("");
    setPostInsertMode(false);
    setLastInsertCount(0);
  }


  function loadTemplate(t: SavedTemplate) {
    // Market: set geoType so geos load, then apply geoId once geos arrive.
    setGeoType(t.geoType);
    setGeo(null);
    setQ("");
    pendingGeoIdRef.current = String(t.geoId);

    // Options
    setWidget(t.widget);
    setPresetId(t.presetId);
    setShowTitle(t.options.showTitle);
    setColor(t.options.color);
    setBg(t.options.bg);
    setBorder(t.options.border);
    setFontSize(t.options.fontSize);

    // Timeframe drives vizzes; set it now.
    const ts = timespans.find((x) => String(x.id) === String(t.timespanId)) || null;
    if (ts) setTimespan(ts);

    // Bundle: apply viz selection once vizzes load.
    pendingVizIdsRef.current = [...t.vizIds];

    setVizQ("");
    setPostInsertMode(false);
    setLastInsertCount(0);

    // Start on step 0 while the market resolves; the geos effect will jump to step 2.
    setStep(0);
  }

  // choose helpers
  function chooseGeoType(t: string) {
    setGeoType(t);
    setGeo(null);
    setTimespan(null);
    setSelectedVizzes([]);
    setVizQ("");
    setStep(0); // stay on market picker; list reloads
  }

  const MAX_STEP: Step = 2;

  const canContinue =
    (step === 0 && !!(geoType && geo)) ||
    (step === 1 && selectedVizzes.length > 0) ||
    step === MAX_STEP;

  const canInsert = step === MAX_STEP && !!geo && selectedVizzes.length > 0;

  function clampStep(n: number): Step {
    // n is clamped to 0..2, then asserted as the Step union
    return Math.min(MAX_STEP, Math.max(0, n)) as Step;
  }

  function next() {
    if (!canContinue) return;
    setStep((s) => clampStep(s + 1));
  }

  function back() {
    setStep((s) => clampStep(s - 1));
  }

  function adjustedHeight(baseH: number): number {
    // Only KPI + Strip need a height tweak when font size changes
    if (widget !== "kpi" && widget !== "strip") return baseH;
    const mult = fontSize === "compact" ? 0.85 : fontSize === "large" ? 1.1 : 1.0;
    return Math.max(1, Math.round(baseH * mult));
  }



  async function insert() {
    if (!geo || selectedVizzes.length === 0 || isInserting) return;

    setIsInserting(true);
    setPostInsertMode(false);
    setLastInsertCount(0);
    startProgress();

    try {
      // Text widget: fetch metric-driven text and insert as "nuggets" (separate text elements)
      // so users can drag/drop individual facts without copy/paste.
      if (widget === "text") {
        bump(12);

        // Fetch text payloads for each selected metric
        const payloads: { title: string; subtitle: string; bullets: string[] }[] = [];
        for (const v of selectedVizzes) {
          const u = new URL(TEXT);
          u.searchParams.set("viz_id", String(v.id));
          u.searchParams.set("geo_id", String(geo.id));
          u.searchParams.set("proptype", "all");

          // progress bump per metric
          const i = selectedVizzes.indexOf(v);
          bump(12 + Math.round((i / Math.max(1, selectedVizzes.length)) * 40));
          const td = await jWithCanva<{ title: string; subtitle: string; bullets: string[] }>(u.toString());
          if (td) payloads.push(td);
        }

        // Layout: stack items vertically with small spacing.
        // Canva will let users drag/drop these into their own templates.
        const left = 0;
        let top = 4;
        const gap = 12;
        // Sizes tuned for readability; not tied to preset height.
        const headerHeight = 12;
        const nuggetHeight = 12;
        const width = activePreset!.w;

        for (const td of payloads) {

          // Header (title + subtitle) as its own box
          const headerRange = createRichtextRange();
          if (td?.title) {
            headerRange.appendText(td.title, { fontWeight: "bold" } as any);
          }
          if (td?.subtitle) {
            headerRange.appendText(
              intl.formatMessage({
                defaultMessage: " – ",
                description: "Separator inserted between the title and subtitle in generated text summary headers",
              }),
              { fontWeight: "normal" } as any,
            );
            headerRange.appendText(td.subtitle, { fontWeight: "normal" } as any);
          }

          bump(20);
          await addElementAtPoint({
            type: "richtext",
            range: headerRange,
            top,
            left,
            width,
            height: headerHeight,
          } as any);

          top += headerHeight + gap;

          // Each bullet becomes its own nugget (one movable text element)
          if (td?.bullets?.length) {
            for (const b of td.bullets) {
              const nuggetRange = createRichtextRange();
              nuggetRange.appendText(b, { fontWeight: "normal" } as any);

              bump(20);
              await addElementAtPoint({
                type: "richtext",
                range: nuggetRange,
                top,
                left,
                width,
                height: nuggetHeight,
              } as any);

              top += nuggetHeight + gap;
            }
          }

          // Extra breathing room between metrics
          top += gap;
        }

        setLastInsertCount(selectedVizzes.length);
        setPostInsertMode(true);
        finishProgress();
        return;
      }

      // Bundle insert: for each selected metric, fetch a PNG and insert it as an image element.
      for (let i = 0; i < selectedVizzes.length; i++) {
        const v = selectedVizzes[i];

        const meta = new URL(`${API}/chart_data`);
        meta.searchParams.set("viz_id", String(v!.id));
        meta.searchParams.set("geo_id", String(geo.id));
        meta.searchParams.set("proptype", "all");
        meta.searchParams.set("w", String(activePreset!.w));
        meta.searchParams.set("h", String(adjustedHeight(activePreset!.h)));
        meta.searchParams.set("bg", bg);
        meta.searchParams.set("fontsize", fontSize);
        if (border) meta.searchParams.set("border", "1");
        meta.searchParams.set("widget", widget);
        if (showTitle) meta.searchParams.set("title", "1");
        const hex = normalizeHex(color);
        if (hex) meta.searchParams.set("color", hex);

        // progress bump per metric
        bump(12 + Math.round((i / Math.max(1, selectedVizzes.length)) * 35));
        const jd = await jWithCanva<{ png_url: string }>(meta.toString());
        if (!jd?.png_url) throw new Error("chart_data missing png_url");

        bump(15 + Math.round((i / Math.max(1, selectedVizzes.length)) * 40));
        const dataUrl = await fetchPngAsDataUrl(jd.png_url);

        bump(80);
        const asset = await upload({
          type: "image",
          mimeType: "image/png",
          url: dataUrl,
          thumbnailUrl: dataUrl,
          aiDisclosure: "none",
        });

        bump(90);
        await addElementAtPoint({
          type: "image",
          ref: asset.ref,
          altText: {
            text: intl.formatMessage({
              defaultMessage: "IAR chart",
              description: "Alt text applied to inserted chart images in Canva",
            }),
            decorative: false,
          },
          // simple stacking offset so items don't land exactly on top of each other
          top: i * 20,
          left: i * 20,
          width: activePreset!.w,
          height: adjustedHeight(activePreset!.h),
        } as any);
      }
      setLastInsertCount(selectedVizzes.length);
      setPostInsertMode(true);
      finishProgress();
    } catch (e) {
      console.error(e);
      setPostInsertMode(false);
      setLastInsertCount(0);
      setProgress(100);
      setTimeout(() => setIsInserting(false), 600);
    } finally {
      stopProgress();
    }
  }
  const isLastStep = step === 2;
  const buttonDisabled = isLastStep
    ? (!canInsert || isInserting)
    : (!canContinue || isInserting);
  const buttonLabel = step < 2
    ? intl.formatMessage({
        defaultMessage: "Continue",
        description: "Primary button label used to advance to the next step",
      })
    : (isInserting
        ? intl.formatMessage(
            {
              defaultMessage: "Inserting… {progress}%",
              description: "Primary button label shown while charts are being inserted into Canva",
            },
            { progress: Math.round(progress) },
          )
        : intl.formatMessage({
            defaultMessage: "Insert",
            description: "Primary button label used to insert the selected charts into Canva",
          }));
  return (
    <div style={shell}>
      <Header step={step} steps={steps} />
      <div style={{ height: 8 }} />

      <div style={summaryBar}>
        <div style={summaryRow}>
          <div style={summaryLabel}>
            <FormattedMessage
              defaultMessage="Market"
              description="Label in the summary bar for the selected market"
            />
          </div>
          <div style={summaryValue}>
            {geo
              ? (geo.name || geo.label)
              : intl.formatMessage({
                  defaultMessage: "—",
                  description: "Placeholder shown in the summary bar when no market is selected",
                })}
          </div>
        </div>
        <div style={summaryRow}>
          <div style={summaryLabel}>
            <FormattedMessage
              defaultMessage="Metrics"
              description="Label in the summary bar for the selected metrics bundle"
            />
          </div>
          <div style={summaryValue}>
            {selectedVizzes.length
              ? (() => {
                  const first =
                    (selectedVizzes[0]?.title ||
                      selectedVizzes[0]?.name ||
                      selectedVizzes[0]?.label ||
                      "") as string;
                  const extra = selectedVizzes.length - 1;
                  return first + (extra > 0 ? ` +${extra}` : "");
                })()
              : intl.formatMessage({
                  defaultMessage: "—",
                  description: "Placeholder shown in the summary bar when no metrics are selected",
                })}
          </div>
        </div>
      </div>

      <div style={{ height: 10 }} />
      <div style={{ marginBottom: 8, fontSize: 12 }}>
        {authStatus === "linked" ? (
          <span style={{ color: "#1f5f3b", fontWeight: 700 }}>
            <FormattedMessage
              defaultMessage="Linked to your IAR account"
              description="Compact status text shown when the Canva user is linked"
            />
          </span>
        ) : (
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={openLinkFlow}
              disabled={authBusy}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: 12,
                fontWeight: 700,
                color: "#6a5cff",
                textDecoration: "underline",
                cursor: authBusy ? "not-allowed" : "pointer",
                opacity: authBusy ? 0.6 : 1,
              }}
            >
              {authBusy
                ? intl.formatMessage({
                    defaultMessage: "Preparing link…",
                    description: "Inline link text while preparing account link",
                  })
                : intl.formatMessage({
                    defaultMessage: "Connect your IAR account",
                    description: "Inline link text to start account linking",
                  })}
            </button>

            <button
              type="button"
              onClick={() => void trySilentLink()}
              disabled={authBusy}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: 12,
                color: "#888",
                textDecoration: "underline",
                cursor: authBusy ? "not-allowed" : "pointer",
              }}
            >
              <FormattedMessage
                defaultMessage="Refresh"
                description="Inline link to retry silent linking after returning from connect flow"
              />
            </button>

            {authError && (
              <span style={{ color: "#b00" }}>{authError}</span>
            )}
          </span>
        )}
      </div>

      {/* Step 0: Market picker (type + search + list) */}
      {step === 0 && authStatus === "linked" && (
        <div style={{ marginTop: 8, textAlign: "right" }}>
          <button
            type="button"
            onClick={logout}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              fontSize: 11,
              fontWeight: 700,
              color: "#888",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            <FormattedMessage
              defaultMessage="Disconnect"
              description="Button label that disconnects the currently connected IAR account"
            />
          </button>
        </div>
      )}
      {step === 0 && (
        <Section
          title={intl.formatMessage({
            defaultMessage: "Pick your market",
            description: "Section title for the first step where the user selects a market",
          })}
        >
          {/* Saved sets (optional shortcut) */}
          <details style={{ marginBottom: 14 }}>
            <summary
              style={{
                listStyle: "none",
                cursor: "pointer",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                border: "1px solid #eee",
                borderRadius: 10,
                background: "white",
                fontSize: 12,
              }}
            >
              <span>
                <FormattedMessage
                  defaultMessage="Saved sets"
                  description="Summary label for the collapsible saved sets section in the market selection step"
                />
              </span>
              <span style={{ color: "#888", fontWeight: 700 }}>
                <FormattedMessage
                  defaultMessage="Optional"
                  description="Small badge text indicating the saved sets shortcut is optional"
                />
              </span>
            </summary>

            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "stretch",
                  marginBottom: 8,
                }}
              >
                <select
                  value={activeTemplateId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setActiveTemplateId(id);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    height: 44,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                  disabled={!canLoadAnyTemplate}
                >
                  <option value="">
                    {intl.formatMessage({
                      defaultMessage: "Load a saved set…",
                      description: "Placeholder option in the saved sets dropdown before a saved set is selected",
                    })}
                  </option>
                  {allTemplatesSorted.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => {
                    const t = allTemplatesSorted.find((x) => x.id === activeTemplateId);
                    if (t) loadTemplate(t);
                  }}
                  disabled={!activeTemplateId}
                  style={{
                    padding: "0 14px",
                    height: 44,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "white",
                    fontWeight: 800,
                    cursor: activeTemplateId ? "pointer" : "not-allowed",
                    opacity: activeTemplateId ? 1 : 0.5,
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  }}
                >
                  <FormattedMessage
                    defaultMessage="Load"
                    description="Button label to load the currently selected saved set"
                  />
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 11, color: "#888" }}>
                  <FormattedMessage
                    defaultMessage="Saved sets are stored on this device."
                    description="Helper text explaining that saved sets are stored locally on the current device"
                  />
                </div>

                <button
                  onClick={() => {
                    setShowManageSets((s) => !s);
                    setConfirmDeleteArmed(false);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    fontSize: 11,
                    color: "#888",
                    fontWeight: 700,
                    cursor: "pointer",
                    textDecoration: "underline",
                    whiteSpace: "nowrap",
                  }}
                  aria-expanded={showManageSets}
                >
                  <FormattedMessage
                    defaultMessage="Manage saved sets"
                    description="Button label that opens the panel for managing saved sets"
                  />
                </button>
              </div>

              {showManageSets && (
                <div
                  style={{
                    marginTop: 10,
                    border: "1px solid #eee",
                    borderRadius: 10,
                    padding: 10,
                    background: "#fafafa",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#333" }}>
                    <FormattedMessage
                      defaultMessage="Manage saved sets"
                      description="Heading for the panel where the user can manage saved sets"
                    />
                  </div>

                  <div style={{ fontSize: 12, color: "#666" }}>
                    {activeTemplate ? (
                      <>
                        <FormattedMessage
                          defaultMessage="Selected:"
                          description="Label shown before the name of the currently selected saved set in the manage panel"
                        />{" "}
                        <span style={{ fontWeight: 800, color: "#111" }}>
                          {activeTemplate.name}
                        </span>
                      </>
                    ) : (
                      <FormattedMessage
                        defaultMessage="Select a saved set above to manage it."
                        description="Instruction shown in the manage saved sets panel when no saved set is selected"
                      />
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button
                      onClick={() => {
                        if (!activeTemplate) return;
                        if (!confirmDeleteArmed) {
                          armDeleteOnce();
                          return;
                        }
                        deleteActiveTemplate();
                        setConfirmDeleteArmed(false);
                      }}
                      disabled={!activeTemplate}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid #ddd",
                        background: "white",
                        fontWeight: 800,
                        cursor: !activeTemplate ? "not-allowed" : "pointer",
                        opacity: !activeTemplate ? 0.5 : 1,
                      }}
                    >
                      {confirmDeleteArmed ? (
                        <FormattedMessage
                          defaultMessage="Click again to delete"
                          description="Delete confirmation button text shown after the first click on delete saved set"
                        />
                      ) : (
                        <FormattedMessage
                          defaultMessage="Delete saved set"
                          description="Button label to delete the currently selected saved set"
                        />
                      )}
                    </button>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => {
                        setShowManageSets(false);
                        setConfirmDeleteArmed(false);
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        padding: 0,
                        fontSize: 11,
                        color: "#888",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      <FormattedMessage
                        defaultMessage="Done"
                        description="Button label to close the manage saved sets panel"
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </details>
          <div style={{ marginTop:4, marginBottom: 8 }}>
            <FormattedMessage
              defaultMessage="Type"
              description="Label above the chips used to choose the market geography type"
            />
          </div>
          <div style={{ ...chips, marginBottom: 10 }}>
            {visibleGeoTypes.map((t) => (
              <Chip
                key={t}
                active={t === geoType}
                onClick={() => chooseGeoType(t)}
                label={t}
              />
            ))}
          </div>

          <input
            placeholder={intl.formatMessage({
              defaultMessage: "Search markets",
              description: "Placeholder text in the market search input",
            })}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={search}
            disabled={!geoType}
          />

          {geo && (
            <div style={{ margin: "6px 0 10px", fontSize: 12, color: "#444" }}>
              <strong>
                <FormattedMessage
                  defaultMessage="Selected market:"
                  description="Label shown before the currently selected market name"
                />

              {/* eslint-disable-next-line formatjs/no-literal-string-in-jsx */}
              </strong>{" "}
              {geo.name || geo.label}
            </div>
          )}

          <List>
            {!geoType && (
              <Empty>
                <FormattedMessage
                  defaultMessage="Choose a type to load markets"
                  description="Empty-state message shown before the user selects a market type"
                />
              </Empty>
            )}
            {!!geoType &&
              geos.map((g) => (
                <Row
                  key={String(g.id)}
                  active={geo?.id === g.id}
                  title={g.name || g.label}
                  subtitle={g.subtitle}
                  onClick={() => {
                    setGeo(g);
                  }}
                />
              ))}
            {!!geoType && geos.length === 0 && (
              <Empty>
                <FormattedMessage
                  defaultMessage="Start typing to filter…"
                  description="Empty-state message shown when the user should type to filter the market list"
                />
              </Empty>
            )}
          </List>
        </Section>
      )}

      {/* Step 1: Timespan + Viz (combined) */}
      {step === 1 && (
        <Section
          title={intl.formatMessage({
            defaultMessage: "Pick a timeframe and metrics",
            description: "Section title for the second step where the user chooses a timeframe and metrics",
          })}
        >
          <div style={{ marginTop:4, marginBottom: 8 }}>
            <FormattedMessage
              defaultMessage="Timeframe"
              description="Label above the dropdown used to select the metric timeframe"
            />
          </div>
          <select
            value={timespan ? String(timespan.id) : ""}
            onChange={(e) => {
              const id = e.target.value;
              const t = timespans.find((x) => String(x.id) === id) || null;
              if (t) setTimespan(t);
            }}
            style={{ width: "100%", padding: "10px 12px", height: 44, border: "1px solid #ddd", borderRadius: 8, marginBottom: 12, boxSizing: "border-box" }}
          >
            {timespans.map((t) => (
              <option key={String(t.id)} value={String(t.id)}>
                {t.label || String(t.id)}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop:4, marginBottom: 8 }}>
            <div>
              <FormattedMessage
                defaultMessage="Metrics"
                description="Label above the list of metrics in step two"
              />
            </div>
            <div style={{ color: selectedVizzes.length >= BUNDLE_MAX ? "#6a5cff" : "#666" }}>
              {intl.formatMessage(
                {
                  defaultMessage: "Bundle ({count}/{max})",
                  description: "Label showing how many metrics are currently selected out of the maximum allowed",
                },
                { count: selectedVizzes.length, max: BUNDLE_MAX },
              )}
            </div>
          </div>

          {selectedVizzes.length > 0 && (
            <div style={{ ...chips, marginBottom: 10 }}>
              {selectedVizzes.map((v) => (
                <div
                  key={String(v.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 16,
                    border: "1px solid #ddd",
                    background: "white",
                    fontSize: 12,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }}>
                    {v.title || v.name || v.label}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeVizFromBundle(v.id);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      color: "#666",
                      fontWeight: 900,
                      lineHeight: 1,
                    }}
                    aria-label={intl.formatMessage({
                      defaultMessage: "Remove metric",
                      description: "Accessible label for the button that removes a selected metric chip",
                    })}
                    title={intl.formatMessage({
                      defaultMessage: "Remove",
                      description: "Tooltip text for the button that removes a selected metric chip",
                    })}

                  >
                      {intl.formatMessage({
                        defaultMessage: "×",
                        description: "Icon glyph used in the metric chip remove button",
                      })}
                  </button>
                </div>
              ))}

              <button
                onClick={() => clearBundle()}
                style={{
                  padding: "6px 10px",
                  borderRadius: 16,
                  border: "1px solid #eee",
                  background: "#fafafa",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "#666",
                }}
              >
                <FormattedMessage
                  defaultMessage="Clear"
                  description="Button label that clears all currently selected metrics from the bundle"
                />
              </button>
            </div>
          )}

          <input
            placeholder={selectedVizzes.length >= BUNDLE_MAX
              ? intl.formatMessage({
                  defaultMessage: "Bundle full (3)",
                  description: "Placeholder shown in the metric search input when the user has already selected the maximum number of metrics",
                })
              : intl.formatMessage({
                  defaultMessage: "Search metrics",
                  description: "Placeholder text in the metric search input",
                })}
            value={vizQ}
            onChange={(e) => setVizQ(e.target.value)}
            style={search}
            disabled={!timespan}
          />

          <List>
            {(() => {
              const needle = vizQ.trim().toLowerCase();
              const base = !needle
                ? vizzes
                : vizzes.filter((v) => {
                    const hay = `${v.title ?? ""} ${v.name ?? ""} ${v.subtitle ?? ""} ${v.label ?? ""}`.toLowerCase();
                    return hay.includes(needle);
                  });

              const filtered = [...base].sort((a, b) => {
                const ar = isRecommendedViz(a) ? 0 : 1;
                const br = isRecommendedViz(b) ? 0 : 1;
                if (ar !== br) return ar - br;
                const at = String(a.title || a.name || a.label || "").toLowerCase();
                const bt = String(b.title || b.name || b.label || "").toLowerCase();
                return at.localeCompare(bt);
              });

              if (!timespan) {
                return (
                  <Empty>
                    <FormattedMessage
                      defaultMessage="Choose a timeframe to load metrics"
                      description="Empty-state message shown before the user selects a timeframe"
                    />
                  </Empty>
                );
              }
              if (vizzes.length === 0) {
                return (
                  <Empty>
                    <FormattedMessage
                      defaultMessage="No metrics found for this timeframe"
                      description="Empty-state message shown when no metrics are available for the selected timeframe"
                    />
                  </Empty>
                );
              }
              if (filtered.length === 0) {
                return (
                  <Empty>
                    <FormattedMessage
                      defaultMessage="No matches"
                      description="Empty-state message shown when no metrics match the search term"
                    />
                  </Empty>
                );
              }

              return filtered.map((v) => {
                const selected = isSelectedViz(v.id);
                const disabledAdd = !selected && selectedVizzes.length >= BUNDLE_MAX;

                return (
                  <div
                    key={String(v.id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      alignItems: "center",
                      padding: 9,
                      background: selected ? "#f2f7ff" : isRecommendedViz(v) ? "#fbfbff" : "white",
                      borderBottom: "1px solid #f4f4f4",
                      borderLeft: isRecommendedViz(v) ? "3px solid #d9d6ff" : "3px solid transparent",
                      cursor: "default",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.25 }}>
                        {v.title || v.name}
                      </div>
                      {(v.subtitle || isRecommendedViz(v)) && (
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                          {v.subtitle && (
                            <div style={{ fontSize: 12, lineHeight: 1.25, color: "#666", flex: 1 }}>
                              {v.subtitle}
                            </div>
                          )}
                          {isRecommendedViz(v) && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#6a5cff",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                              }}
                            >
                              <FormattedMessage
                                defaultMessage="Recommended"
                                description="Badge shown next to metrics that are recommended by default"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        if (selected) removeVizFromBundle(v.id);
                        else addVizToBundle(v);
                      }}
                      disabled={disabledAdd}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 16,
                        border: selected ? "1px solid #c9c6ff" : "1px solid #ddd",
                        background: selected ? "#f5f4ff" : "white",
                        cursor: disabledAdd ? "not-allowed" : "pointer",
                        fontSize: 12,
                        fontWeight: 800,
                        color: disabledAdd ? "#aaa" : "#111",
                        opacity: disabledAdd ? 0.6 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selected ? (
                        <FormattedMessage
                          defaultMessage="Remove"
                          description="Button label used to remove a metric from the selected bundle"
                        />
                      ) : (
                        <FormattedMessage
                          defaultMessage="Add"
                          description="Button label used to add a metric to the selected bundle"
                        />
                      )}
                    </button>
                  </div>
                );
              });
            })()}
          </List>
        </Section>
      )}

      {/* Step 2: Options & insert */}
      {step === 2 && (
        <Section
          title={intl.formatMessage({
            defaultMessage: "Options & insert",
            description: "Section title for the third step where the user chooses widget options and inserts charts",
          })}
        >
          {/* Post-insert actions (save/export after you insert) */}
          {postInsertMode && (
            <div style={{
              border: "1px solid #e9e9ef",
              borderRadius: 12,
              padding: 12,
              background: "#fbfbff",
              marginBottom: 14,
              display: "grid",
              gap: 10,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 12 }}>
                  {intl.formatMessage(
                    {
                      defaultMessage: "Inserted {count} {itemLabel}",
                      description: "Confirmation message shown after charts are inserted into Canva",
                    },
                    {
                      count: lastInsertCount,
                      itemLabel:
                        lastInsertCount === 1
                          ? intl.formatMessage({
                              defaultMessage: "card",
                              description: "Singular noun used in the post-insert confirmation message",
                            })
                          : intl.formatMessage({
                              defaultMessage: "cards",
                              description: "Plural noun used in the post-insert confirmation message",
                            }),
                    },
                  )}
                </div>
                <button
                  onClick={() => {
                    setPostInsertMode(false);
                    setLastInsertCount(0);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    color: "#666",
                    fontWeight: 900,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  <FormattedMessage
                    defaultMessage="Dismiss"
                    description="Button label that closes the post-insert confirmation panel"
                  />
                </button>
              </div>

              <div style={{ fontSize: 12, color: "#666" }}>
                <FormattedMessage
                  defaultMessage="Save this bundle so you can load it next time and skip setup."
                  description="Helper text encouraging the user to save the current bundle after insertion"
                />
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder={intl.formatMessage({
                    defaultMessage: "Name this saved set",
                    description: "Placeholder text in the input used to name a saved set after insertion",
                  })}
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 180,
                    padding: 10,
                    height: 44,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={saveNewTemplate}
                  disabled={!geo || !timespan || selectedVizzes.length === 0}
                  style={{
                    padding: "10px 12px",
                    height: 44,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                    opacity: !geo || !timespan || selectedVizzes.length === 0 ? 0.5 : 1,
                  }}
                >
                  <FormattedMessage
                    defaultMessage="Save"
                    description="Button label used to save the current bundle as a saved set"
                  />
                </button>
              </div>

              {/* New button: Generate AI caption */}
              <button
                onClick={() => {
                  if (!geo || selectedVizzes.length === 0) return;

                  // Caption endpoint expects the same query params as the text/chart requests.
                  // Use the first selected metric as the caption source.
                  generateAndInsertCaption({
                    geo_id: geo.id,
                    viz_id: selectedVizzes[0]!.id,
                    proptype,
                  });
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  height: 44,
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#ffffff",
                  fontWeight: 900,
                  cursor: "pointer",
                  color: "#333",
                }}
              >
                <FormattedMessage
                  defaultMessage="Generate AI caption"
                  description="Button label used to generate and insert an AI-written caption for the selected metric"
                />
              </button>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    // Keep market + options; just return to the beginning of the flow
                    setPostInsertMode(false);
                    setLastInsertCount(0);
                    setStep(0);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    height: 44,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                    color: "#333",
                  }}
                >
                  <FormattedMessage
                    defaultMessage="Start over"
                    description="Button label that returns the user to the beginning of the setup flow after insertion"
                  />
                </button>
              </div>

            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                <FormattedMessage
                  defaultMessage="Choose widget"
                  description="Heading above the widget selection cards in step three"
                />
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {WIDGETS.map((w) => {
                  const active = widget === w.id;
                  return (
                    <button
                      key={w.id}
                      onClick={() => setWidget(w.id as any)}
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderRadius: 12,
                        border: active ? "1px solid #c9c6ff" : "1px solid #e6e6ee",
                        background: active ? "#f5f4ff" : "white",
                        cursor: "pointer",
                        display: "grid",
                        gridTemplateColumns: "64px 1fr",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      {/* Widget preview SVG */}
                      <div
                        style={{
                          width: 64,
                          height: 44,
                          borderRadius: 10,
                          background: "#f2f2f2",
                          border: "1px solid #e3e3e3",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                        aria-hidden="true"
                      >
                        {PREVIEW_BY_WIDGET[w.id] ?? (
                          <svg width="56" height="36" viewBox="0 0 56 36" xmlns="http://www.w3.org/2000/svg">
                            <rect x="1" y="1" width="54" height="34" rx="6" fill="#f7f7f7" stroke="#d9d9d9" />
                            <text x="28" y="21" textAnchor="middle" fontSize="9" fill="#9a9a9a" fontFamily="Inter, system-ui, sans-serif">
                            {PREVIEW_LABELS[w.preview] ?? w.preview}
                            </text>
                          </svg>
                        )}
                      </div>

                      <div style={{ display: "grid", gap: 2 }}>
                        <div style={{ fontWeight: 800, fontSize: 12, lineHeight: 1.15, color: "#111" }}>
                          {w.label}
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.25, color: "#666" }}>
                          {w.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ fontWeight: 600, margin: "12px 0 6px" }}>
              <FormattedMessage
                defaultMessage="Size"
                description="Heading above the preset size buttons for the selected widget"
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {presetSet.map(p => (
                <button key={p.id}
                  onClick={() => setPresetId(p.id)}
                  style={{
                    padding:"6px 10px", borderRadius:16, border:"1px solid #ddd",
                    background: presetId === p.id ? "#eef5ff" : "white"
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontWeight: 700, cursor: "pointer", userSelect: "none" }}>
                <FormattedMessage
                  defaultMessage="Options"
                  description="Summary label for the collapsible widget options panel"
                />
              </summary>
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {(widget === "chart" || widget === "strip") && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={showTitle}
                      onChange={(e) => setShowTitle(e.target.checked)}
                    />
                    <span>
                      <FormattedMessage
                        defaultMessage="Show title block"
                        description="Checkbox label that controls whether the chart title block is shown"
                      />
                    </span>
                  </label>
                )}
                <label style={{ display: "grid", gap: 4 }}>
                  <span>
                    <FormattedMessage
                      defaultMessage="Brand color (hex)"
                      description="Label for the input where the user can enter a custom hex brand color"
                    />
                  </span>
                  <input
                    placeholder={intl.formatMessage({
                      defaultMessage: "#006E8E",
                      description: "Placeholder example shown in the custom brand color hex input",
                    })}
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    style={{ width: "100%", padding: 6, border: "1px solid #ddd", borderRadius: 6, boxSizing:"border-box" }}
                  />
                  {normalizeHex(color) === "" && color.trim() !== "" && (
                    <span style={{ color: "#b00", fontSize: 12 }}>
                      <FormattedMessage
                        defaultMessage="Enter a valid hex (e.g. #006E8E)"
                        description="Validation message shown when the user enters an invalid hex color"
                      />
                    </span>
                  )}
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>
                    <FormattedMessage
                      defaultMessage="Background"
                      description="Label for the dropdown used to choose the widget background color"
                    />
                  </span>
                  <select
                    value={bg}
                    onChange={(e) => setBg(e.target.value)}
                    style={{ width: "100%", padding: 6, border: "1px solid #ddd", borderRadius: 6, boxSizing: "border-box" }}
                  >
                    <option value="white">
                      {intl.formatMessage({
                        defaultMessage: "White",
                        description: "Background color option for a white widget background",
                      })}
                    </option>
                    <option value="transparent">
                      {intl.formatMessage({
                        defaultMessage: "Transparent",
                        description: "Background color option for a transparent widget background",
                      })}
                    </option>
                    <option value="#faf8f5">
                      {intl.formatMessage({
                        defaultMessage: "Warm White",
                        description: "Background color option for a warm white widget background",
                      })}
                    </option>
                    <option value="#f3f4f6">
                      {intl.formatMessage({
                        defaultMessage: "Light Gray",
                        description: "Background color option for a light gray widget background",
                      })}
                    </option>
                    <option value="#f0fbfb">
                      {intl.formatMessage({
                        defaultMessage: "Soft IAR Teal",
                        description: "Background color option for a soft IAR teal widget background",
                      })}
                    </option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>
                    <FormattedMessage
                      defaultMessage="Font size"
                      description="Label for the dropdown used to choose the widget font size"
                    />
                  </span>
                  <select
                    value={fontSize}
                    onChange={(e) => setFontSize(e.target.value)}
                    style={{
                      width: "100%",
                      padding: 6,
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="normal">
                      {intl.formatMessage({
                        defaultMessage: "Normal",
                        description: "Font size option for the normal widget font size",
                      })}
                    </option>
                    <option value="large">
                      {intl.formatMessage({
                        defaultMessage: "Large",
                        description: "Font size option for the large widget font size",
                      })}
                    </option>
                    <option value="compact">
                      {intl.formatMessage({
                        defaultMessage: "Compact",
                        description: "Font size option for the compact widget font size",
                      })}
                    </option>
                  </select>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={border}
                    onChange={(e) => setBorder(e.target.checked)}
                  />
                  <span>
                    <FormattedMessage
                      defaultMessage="Show card border"
                      description="Checkbox label that controls whether a border is shown around the widget"
                    />
                  </span>
                </label>
              </div>
            </details>
          </div>
        </Section>
      )}

      {/* Loader overlay */}
      {isInserting && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
          }}
        >
          <div style={{
            width: 320, padding: 16, borderRadius: 12, background: "white",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)"
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              <FormattedMessage
                defaultMessage="Inserting…"
                description="Heading shown in the loader overlay while charts are being inserted"
              />
            </div>
            <div style={{ height: 10, background: "#eee", borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
              <div style={{
                height: "100%",
                width: `${Math.round(progress)}%`,
                background: "#6a5cff",
                transition: "width 160ms linear"
              }} />
            </div>
            <div style={{ fontSize: 12, color: "#666" }}>
              <FormattedMessage
                defaultMessage="This can take up to ~30s depending on data & network."
                description="Helper text in the loader overlay explaining that insertion may take some time"
              />
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{ height: 12 }} />
      <div style={nav}>
        <button onClick={back} disabled={step === 0 || isInserting} style={secondary}>
          <FormattedMessage
            defaultMessage="Back"
            description="Secondary navigation button label used to go to the previous step"
          />
        </button>
        <button
          onClick={step < 2 ? next : insert}
          disabled={buttonDisabled}
          style={{
            ...primary,
            opacity: buttonDisabled ? 0.5 : 1,
            cursor: buttonDisabled ? "not-allowed" : "pointer",
          }}
        >
          {buttonLabel}
        </button>
      </div>
      {step === 0 && (
        <div style={{ marginTop: 10, textAlign: "center" }}>
          <button
            type="button"
            onClick={async () => {
              try {
                await requestOpenExternalUrl({
                  url: "https://data.indianarealtors.com/canva/learn",
                });
              } catch (e) {
                console.error(e);
              }
            }}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              fontSize: 12,
              fontWeight: 700,
              color: "#6a5cff",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            <FormattedMessage
              defaultMessage="New here? Getting started →"
              description="Footer help link inviting first-time users to open the getting started guide"
            />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- UI bits ---------- */
function Header({ step, steps }: { step: Step; steps: readonly string[] }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {steps.map((_, i) => (
          <div
            key={i}
            style={{
              height: 4,
              flex: 1,
              borderRadius: 2,
              background: i <= step ? "#6a5cff" : "#e8e8ef",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Section(props: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#333", marginBottom: 12, marginTop: 12 }}>
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 10px",
        borderRadius: 16,
        border: "1px solid #ddd",
        background: active ? "#eef5ff" : "white",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <div style={list}>
      <div style={{ maxHeight: 200, overflow: "auto" }}>{children}</div>
    </div>
  );
}

function Row({
  active,
  recommended,
  title,
  subtitle,
  onClick,
}: {
  active?: boolean;
  recommended?: boolean;
  title?: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 9,
        cursor: "pointer",
        background: active ? "#f2f7ff" : (recommended ? "#fbfbff" : "white"),
        borderBottom: "1px solid #f4f4f4",
        borderLeft: recommended ? "3px solid #d9d6ff" : "3px solid transparent",
      }}
    >
    <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.25 }}>
      {title}
    </div>

    {(subtitle || recommended) && (
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        {subtitle && (
          <div style={{ fontSize: 12, lineHeight: 1.25, color: "#666", flex: 1 }}>
            {subtitle}
          </div>
        )}
        {recommended && (
          <div
            style={{
              fontSize: 11,
              color: "#6a5cff",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            <FormattedMessage
              defaultMessage="Recommended"
              description="Badge shown next to recommended items in reusable row components"
            />
          </div>
        )}
      </div>
    )}
    </div>
  );
}


/* ---------- Styles ---------- */
const shell: React.CSSProperties = {
  padding: 12,
  fontFamily: "Inter, system-ui, sans-serif",
};

const summaryBar: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 10,
  padding: 10,
  display: "grid",
  gap: 8,
  background: "white",
};

const summaryRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "baseline",
  justifyContent: "space-between",
};

const summaryLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#666",
  minWidth: 70,
};

const summaryValue: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textAlign: "right",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 200,
};

const chips: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const search: React.CSSProperties = {
  width: "100%",
  padding: 8,
  marginBottom: 8,
  border: "1px solid #ddd",
  borderRadius: 6,
  boxSizing: "border-box",
};

const list: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 6,
};


const nav: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const primary: React.CSSProperties = {
  flex: 1,
  padding: 10,
  borderRadius: 8,
  border: "none",
  background: "#6a5cff",
  color: "white",
  fontWeight: 700,
};

const secondary: React.CSSProperties = {
  flex: 1,
  padding: 10,
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "white",
  fontWeight: 700,
};

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, color: "#777", fontSize: 12, textAlign: "center" }}>
      {children}
    </div>
  );
}

async function fetchPngAsDataUrl(url: string): Promise<string> {
  const token = await auth.getCanvaUserToken().catch(() => "");
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "image/png",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`PNG fetch failed: ${res.status}`);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `data:image/png;base64,${b64}`;
}

function normalizeHex(x: string) {
  const t = x.trim();
  if (!t) return "";
  const v = t.startsWith("#") ? t : `#${t}`;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : "";
}
