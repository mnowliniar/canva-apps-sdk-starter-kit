import React, { useEffect, useState, useRef } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { upload } from "@canva/asset";
import { addElementAtPoint, createRichtextRange } from "@canva/design";
import { requestOpenExternalUrl } from "@canva/platform";
import { auth } from "@canva/user";
import { Accordion, AccordionItem, Alert, Badge, Button, Checkbox, ColorSelector, FormField, HorizontalCard, Link, ProgressBar, Rows, SegmentedControl, Select, Tab, TabList, TabPanel, TabPanels, Tabs, Text, TextInput, tokens } from "@canva/app-ui-kit";
import { GEO_TYPE_MESSAGES, TIMESPAN_MESSAGES, VIZ_MESSAGES } from "./generated/dynamic-messages";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */

const API = "https://data.indianarealtors.com/api/canva";
// Default accent used by the chart backend when no custom color is set.
const DEFAULT_BRAND_COLOR = "#006E8E";
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
  type?: string;
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

  // Translated lookups for DYNAMIC (DB-sourced) labels. The API still returns the raw
  // English value + id; we display the Canva-translated string keyed by id, and fall back
  // to the raw value when an id isn't in the generated catalog yet (e.g. a metric was added
  // but the app hasn't been regenerated/resubmitted). See generated/dynamic-messages.ts.
  // Catalog/DB labels arrive in Title Case ("Closed Sales", "ZIP Code"); Canva
  // requires sentence case in UI labels. Transform at display time, English only
  // (other locales follow their own casing rules), keeping acronyms and any
  // word containing digits untouched.
  const sentenceCaseEn = (s: string): string => {
    if (!intl.locale.toLowerCase().startsWith("en")) return s;
    let first = true;
    return s.replace(/\S+/g, (word) => {
      const keep = /^[A-Z0-9]{2,}$/.test(word) || /\d/.test(word);
      const out = first || keep ? word : word.toLowerCase();
      first = false;
      return out;
    });
  };

  const tGeoType = (value: string): string => {
    const m = GEO_TYPE_MESSAGES[value];
    return sentenceCaseEn(m ? intl.formatMessage(m) : value);
  };
  const tTimespanLabel = (t: Item): string => {
    const m = TIMESPAN_MESSAGES[String(t.id)];
    return m ? intl.formatMessage(m) : t.label || String(t.id);
  };
  const tVizTitle = (v: Item): string => {
    const m = VIZ_MESSAGES[String(v.id)];
    return sentenceCaseEn(m ? intl.formatMessage(m.title) : (v.title || v.name || ""));
  };
  const tVizSubtitle = (v: Item): string => {
    const m = VIZ_MESSAGES[String(v.id)];
    return m?.subtitle ? intl.formatMessage(m.subtitle) : (v.subtitle || "");
  };
  // Geo subtitles arrive from the server pre-baked as "{type} · {n} households".
  // Rebuild them client-side so they localize: translate the type via the catalog,
  // format the count for the locale, and pluralize "household(s)". Fall back to the
  // raw string if the shape is ever unexpected.
  const tGeoSubtitle = (g: Item): string => {
    const raw = g.subtitle || "";
    const numMatch = raw.match(/[\d,]+/);
    if (!g.type || !numMatch) return raw;
    const count = Number(numMatch[0].replace(/,/g, ""));
    if (!Number.isFinite(count)) return raw;
    return intl.formatMessage(
      {
        defaultMessage:
          "{geoType} · {count, plural, one {# household} other {# households}}",
        description:
          "Market list subtitle showing the geography type and its number of households",
      },
      { geoType: tGeoType(g.type), count },
    );
  };

  // --- Auth gate ---
  // We silently check (on boot) whether this Canva user is already linked to an IAR
  // member account. Linking unlocks protected markets/metrics; when unlinked the app
  // stays fully usable on public data. There is no manual link action because a
  // cross-site session can't be established from inside the Canva app iframe.
  const [authStatus, setAuthStatus] = useState<"checking" | "linked" | "unlinked">("checking");

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
      setAuthStatus(r.ok && data?.linked ? "linked" : "unlinked");
    } catch {
      setAuthStatus("unlinked");
    }
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
        defaultMessage: "Tall card",
        description: "Preset size label for a tall KPI card widget",
      }),
      w: 200,
      h: 250,
    },
    {
      id: "kpi-wide",
      label: intl.formatMessage({
        defaultMessage: "Wide card",
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
        defaultMessage: "Regular card",
        description: "Preset size label for a regular three-stat strip card widget",
      }),
      w: 650,
      h: 300,
    },
    {
      id: "strip-wide",
      label: intl.formatMessage({
        defaultMessage: "Wide card",
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
      // 200 clipped the "Past 24 months" note + source line out of the card;
      // 245 fits the full stack at both normal and large font sizes.
      h: 245,
    },
  ];

  const TEXT_PRESETS = [
    {
      id: "text-wide",
      label: intl.formatMessage({
        defaultMessage: "Text box",
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

  // ---- Widget preview SVGs (as data URIs for HorizontalCard thumbnails) ----
  const PREVIEW_SVG_BY_WIDGET: Record<string, string> = {
    chart:
      '<svg width="56" height="36" viewBox="0 0 56 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.85" y="1.79" width="28.45" height="4.55" rx="2" ry="2" fill="#e6e7e8"/><rect x="1.85" y="8.69" width="52.29" height="25.59" rx="2" ry="2" fill="#e6e7e8"/><polyline points="2.64 27.82 11.58 23.1 21.72 25.07 30.2 19.94 40.91 22.9 53.33 17.55" fill="none" stroke="#a7a9ac" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/></svg>',
    kpi:
      '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="36" viewBox="0 0 56 36"><rect x="1.85" y="1.79" width="28.45" height="4.55" rx="2" ry="2" fill="#e6e7e8"/><rect x="1.85" y="8.69" width="52.29" height="5.21" rx="2" ry="2" fill="#a7a9ac"/><polyline points="4.34 30.55 11.31 28.04 19.22 29.09 25.83 26.36 34.19 27.93 43.87 25.09" fill="none" stroke="#d1d3d4" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>',
    text:
      '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="36" viewBox="0 0 56 36"><rect x="1.85" y="6.27" width="28.45" height="4.55" rx="2" ry="2" fill="#a7a9ac"/><rect x="1.85" y="13.17" width="52.29" height="5.21" rx="2" ry="2" fill="#d1d3d4"/><rect x="1.85" y="20.45" width="52.29" height="5.21" rx="2" ry="2" fill="#d1d3d4"/></svg>',
    strip:
      '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="36" viewBox="0 0 56 36"><rect x=".73" y="7.72" width="16.6" height="19.39" rx="2" ry="2" fill="#e6e7e8"/><rect x="2.93" y="11.13" width="12.2" height="5.21" rx="2" ry="2" fill="#a7a9ac"/><rect x="19.83" y="7.72" width="16.6" height="19.39" rx="2" ry="2" fill="#e6e7e8"/><rect x="38.93" y="7.72" width="16.6" height="19.39" rx="2" ry="2" fill="#e6e7e8"/><rect x="22.03" y="11.1" width="12.2" height="5.21" rx="2" ry="2" fill="#a7a9ac"/><rect x="41.14" y="11.13" width="12.2" height="5.21" rx="2" ry="2" fill="#a7a9ac"/></svg>',
    dot_range_h:
      '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="36" viewBox="0 0 56 36"><rect x="2.6" y="3.8" width="49.96" height="27.42" rx="2" ry="2" fill="#f1f2f2"/><rect x="4.66" y="6.5" width="23.47" height="5.21" rx="2" ry="2" fill="#d1d3d4"/><rect x="4.66" y="21.85" width="45.6" height="4" rx="2" ry="2" fill="#d1d3d4"/><circle cx="38.72" cy="23.69" r="3.26" fill="#a7a9ac"/></svg>',
  };
  const svgDataUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;


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

  // ui
  const [q, setQ] = useState("");
  const [step, setStep] = useState<Step>(0);
  const [mainTab, setMainTab] = useState<"create" | "saved">("create");

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
  const [confirmDeleteArmed, setConfirmDeleteArmed] = useState<boolean>(false);
  const pendingVizIdsRef = useRef<string[] | null>(null);
  const pendingGeoIdRef = useRef<string | null>(null);

  // post-insert UX
  const [lastInsertCount, setLastInsertCount] = useState<number>(0);
  const [postInsertMode, setPostInsertMode] = useState<boolean>(false);

  // loader/progress — determinate, driven by real insertion milestones
  const [isInserting, setIsInserting] = useState(false);
  const [progress, setProgress] = useState(0);

  function bump(to: number) { setProgress(p => Math.max(p, to)); }
  function finishProgress() {
    setProgress(100);
    setTimeout(() => setIsInserting(false), 250);
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

    setPostInsertMode(false);
    setLastInsertCount(0);

    // Start on step 0 while the market resolves; the geos effect will jump to step 2.
    setStep(0);
    setMainTab("create");
  }

  // choose helpers
  function chooseGeoType(t: string) {
    setGeoType(t);
    setGeo(null);
    setTimespan(null);
    setSelectedVizzes([]);
    setQ("");
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
    setProgress(2);

    try {
      // Text widget: fetch metric-driven text and insert as "nuggets" (separate text elements)
      // so users can drag/drop individual facts without copy/paste.
      if (widget === "text") {
        // Determinate progress: fetching payloads covers 0–50%, adding elements 50–100%.
        const fetchTotal = Math.max(1, selectedVizzes.length);

        // Fetch text payloads for each selected metric
        const payloads: { title: string; subtitle: string; bullets: string[] }[] = [];
        for (const v of selectedVizzes) {
          const u = new URL(TEXT);
          u.searchParams.set("viz_id", String(v.id));
          u.searchParams.set("geo_id", String(geo.id));
          u.searchParams.set("proptype", "all");

          const td = await jWithCanva<{ title: string; subtitle: string; bullets: string[] }>(u.toString());
          if (td) payloads.push(td);
          bump(Math.round((payloads.length / fetchTotal) * 50));
        }
        const elementTotal = Math.max(
          1,
          payloads.reduce((sum, td) => sum + 1 + (td?.bullets?.length ?? 0), 0),
        );
        let elementsAdded = 0;

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

          await addElementAtPoint({
            type: "richtext",
            range: headerRange,
            top,
            left,
            width,
            height: headerHeight,
          } as any);
          elementsAdded += 1;
          bump(50 + Math.round((elementsAdded / elementTotal) * 50));

          top += headerHeight + gap;

          // Each bullet becomes its own nugget (one movable text element)
          if (td?.bullets?.length) {
            for (const b of td.bullets) {
              const nuggetRange = createRichtextRange();
              nuggetRange.appendText(b, { fontWeight: "normal" } as any);

              await addElementAtPoint({
                type: "richtext",
                range: nuggetRange,
                top,
                left,
                width,
                height: nuggetHeight,
              } as any);
              elementsAdded += 1;
              bump(50 + Math.round((elementsAdded / elementTotal) * 50));

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
      // Determinate progress: each chart has 3 real milestones (metadata, PNG, added to design).
      const milestoneTotal = selectedVizzes.length * 3;
      const chartPct = (milestonesDone: number) =>
        Math.round((milestonesDone / milestoneTotal) * 100);
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

        const jd = await jWithCanva<{ png_url: string }>(meta.toString());
        if (!jd?.png_url) throw new Error("chart_data missing png_url");
        bump(chartPct(i * 3 + 1));

        const dataUrl = await fetchPngAsDataUrl(jd.png_url);
        bump(chartPct(i * 3 + 2));

        const asset = await upload({
          type: "image",
          mimeType: "image/png",
          url: dataUrl,
          thumbnailUrl: dataUrl,
          aiDisclosure: "none",
        });

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
        bump(chartPct(i * 3 + 3));
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
              defaultMessage: "Adding… {progress}%",
              description: "Primary button label shown while charts are being added to the design",
            },
            { progress: Math.round(progress) },
          )
        : intl.formatMessage({
            defaultMessage: "Add to design",
            description: "Primary button label used to add the selected charts to the Canva design",
          }));
  return (
    <div style={shell}>
      {/* Fully controlled tabs: each Tab/TabPanel gets active/onClick — in this
          UI Kit version a Tabs-level activeId alone swallows clicks silently. */}
      <Tabs>
        <TabList align="stretch">
          <Tab id="create" active={mainTab === "create"} onClick={() => setMainTab("create")}>
            {intl.formatMessage({
              defaultMessage: "Create",
              description: "Tab label for the main flow where the user builds and adds charts",
            })}
          </Tab>
          <Tab id="saved" active={mainTab === "saved"} onClick={() => setMainTab("saved")}>
            {intl.formatMessage({
              defaultMessage: "Saved",
              description: "Tab label for the list of saved sets",
            })}
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel id="create" active={mainTab === "create"}>
      {(geo || selectedVizzes.length > 0) && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 4 }}>
          {geo && (
            <div style={{ display: "flex", gap: 4, alignItems: "baseline" }}>
              <Text size="small" tone="secondary" tagName="span">
                <FormattedMessage defaultMessage="Market:" description="Inline summary label for the selected market" />
              </Text>
              <Text size="small" variant="bold" tagName="span">{geo.name || geo.label}</Text>
            </div>
          )}
          {selectedVizzes.length > 0 && (
            <div style={{ display: "flex", gap: 4, alignItems: "baseline" }}>
              <Text size="small" tone="secondary" tagName="span">
                <FormattedMessage defaultMessage="Metrics:" description="Inline summary label for the selected metrics" />
              </Text>
              <Text size="small" variant="bold" tagName="span">
                {(() => {
                  const first = selectedVizzes[0] ? tVizTitle(selectedVizzes[0]) : "";
                  const extra = selectedVizzes.length - 1;
                  return extra > 0
                    ? intl.formatMessage(
                        { defaultMessage: "{first} +{extra}", description: "Summary showing the first selected metric name and a count of additional ones" },
                        { first, extra }
                      )
                    : first;
                })()}
              </Text>
            </div>
          )}
        </div>
      )}

      {/* Auth status — shown only when a member's IAR account is silently linked.
          When unlinked, the app stays fully functional on public data and shows no
          connection UI (no manual action is possible from inside the Canva iframe). */}
      {authStatus === "linked" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, marginBottom: 10 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: tokens.colorContentPositiveFg, flexShrink: 0 }} />
          <Text size="small" tone="secondary" tagName="span">
            <FormattedMessage
              defaultMessage="Connected to IAR"
              description="Compact status text shown when the Canva user is linked"
            />
          </Text>
        </div>
      )}

      {/* Step 0: Market picker (type + search + list) */}
      {step === 0 && (
        <Section
          badge="1"
          badgeLabel={intl.formatMessage({
            defaultMessage: "Step 1 of 3",
            description: "Accessible label for the step one indicator badge",
          })}
          title={intl.formatMessage({
            defaultMessage: "Pick your market",
            description: "Section title for the first step where the user selects a market",
          })}
        >
          <div style={{ marginTop: 4, marginBottom: 8 }}>
            <FormField
              label={intl.formatMessage({
                defaultMessage: "Market type",
                description: "Label for the geo type dropdown",
              })}
              control={(props) => (
                <Select
                  {...props}
                  stretch
                  placeholder={intl.formatMessage({
                    defaultMessage: "Choose a type",
                    description: "Placeholder for the geo type dropdown",
                  })}
                  value={geoType || undefined}
                  options={visibleGeoTypes.map((t) => ({ value: t, label: tGeoType(t) }))}
                  onChange={(value) => chooseGeoType(value as string)}
                />
              )}
            />
          </div>

          {geoType && (
            <FormField
              label={intl.formatMessage({
                defaultMessage: "Market",
                description: "Label for the searchable market dropdown",
              })}
              control={(props) => (
                <Select
                  {...props}
                  stretch
                  placeholder={intl.formatMessage({
                    defaultMessage: "Choose a market",
                    description: "Placeholder for the market dropdown before a market is selected",
                  })}
                  searchable={{
                    // The server filters via the q param; show its results as-is.
                    filterFn: (_query, options) => options,
                    onInputChange: (query) => setQ(query),
                    inputPlaceholder: intl.formatMessage({
                      defaultMessage: "Search markets",
                      description: "Placeholder text in the market search input",
                    }),
                  }}
                  value={geo ? String(geo.id) : undefined}
                  options={geos.map((g) => ({
                    value: String(g.id),
                    label: g.name || g.label || String(g.id),
                    description: tGeoSubtitle(g),
                  }))}
                  onChange={(id) => {
                    const hit = geos.find((g) => String(g.id) === String(id)) || null;
                    if (hit) setGeo(hit);
                  }}
                />
              )}
            />
          )}
        </Section>
      )}

      {/* Step 1: Timespan + Viz (combined) */}
      {step === 1 && (
        <Section
          badge="2"
          badgeLabel={intl.formatMessage({
            defaultMessage: "Step 2 of 3",
            description: "Accessible label for the step two indicator badge",
          })}
          title={intl.formatMessage({
            defaultMessage: "Pick a timeframe and metrics",
            description: "Section title for the second step where the user chooses a timeframe and metrics",
          })}
        >
          <div style={{ marginTop: 4 }}>
            <FormField
              label={intl.formatMessage({
                defaultMessage: "Timeframe",
                description: "Label above the dropdown used to select the metric timeframe",
              })}
              control={(props) => (
                <Select
                  {...props}
                  stretch
                  placeholder={intl.formatMessage({
                    defaultMessage: "Select a timeframe",
                    description: "Placeholder for the timeframe dropdown when nothing is selected",
                  })}
                  value={timespan ? String(timespan.id) : undefined}
                  options={timespans.map((t) => ({ value: String(t.id), label: tTimespanLabel(t) }))}
                  onChange={(id) => {
                    const t = timespans.find((x) => String(x.id) === id) || null;
                    if (t) setTimespan(t);
                  }}
                />
              )}
            />
          </div>

          <div style={{ marginTop: 8 }}>
            <FormField
              label={intl.formatMessage({
                defaultMessage: "Metrics",
                description: "Label above the metric multi-select in step two",
              })}
              description={
                !timespan
                  ? intl.formatMessage({
                      defaultMessage: "Choose a timeframe to load metrics.",
                      description: "Helper text shown before the user selects a timeframe",
                    })
                  : vizzes.length === 0
                    ? intl.formatMessage({
                        defaultMessage: "No metrics found for this timeframe.",
                        description: "Helper text shown when no metrics are available for the selected timeframe",
                      })
                    : intl.formatMessage(
                        {
                          defaultMessage: "Choose up to {max}. Selected: {count} of {max}.",
                          description: "Helper text showing how many metrics are selected out of the maximum allowed",
                        },
                        { count: selectedVizzes.length, max: BUNDLE_MAX },
                      )
              }
              control={(props) => {
                const sorted = [...vizzes].sort((a, b) =>
                  tVizTitle(a).toLowerCase().localeCompare(tVizTitle(b).toLowerCase(), intl.locale),
                );
                const toOption = (v: Item) => ({
                  value: String(v.id),
                  label: tVizTitle(v),
                  description: tVizSubtitle(v) || undefined,
                  disabled: !isSelectedViz(v.id) && selectedVizzes.length >= BUNDLE_MAX,
                });
                const recommended = sorted.filter(isRecommendedViz).map(toOption);
                const others = sorted.filter((v) => !isRecommendedViz(v)).map(toOption);
                return (
                  <Select
                    {...props}
                    stretch
                    type="multi"
                    searchable
                    disabled={!timespan || vizzes.length === 0}
                    placeholder={intl.formatMessage({
                      defaultMessage: "Choose metrics",
                      description: "Placeholder for the metric multi-select before any metric is selected",
                    })}
                    value={selectedVizzes.map((v) => String(v.id))}
                    options={[
                      ...(recommended.length
                        ? [
                            {
                              label: intl.formatMessage({
                                defaultMessage: "Recommended",
                                description: "Group label for recommended metrics in the metric dropdown",
                              }),
                              options: recommended,
                            },
                          ]
                        : []),
                      {
                        label: intl.formatMessage({
                          defaultMessage: "All metrics",
                          description: "Group label for the remaining metrics in the metric dropdown",
                        }),
                        options: others,
                      },
                    ]}
                    onChange={(values) => {
                      const ids = (values as string[]).slice(0, BUNDLE_MAX);
                      setSelectedVizzes(
                        ids
                          .map((id) => vizzes.find((v) => String(v.id) === id))
                          .filter((v): v is Item => Boolean(v)),
                      );
                    }}
                  />
                );
              }}
            />
          </div>
        </Section>
      )}

      {/* Step 2: Options & insert */}
      {step === 2 && (
        <Section
          badge="3"
          badgeLabel={intl.formatMessage({
            defaultMessage: "Step 3 of 3",
            description: "Accessible label for the step three indicator badge",
          })}
          title={intl.formatMessage({
            defaultMessage: "Options & insert",
            description: "Section title for the third step where the user chooses widget options and inserts charts",
          })}
        >
          {/* Post-insert: focused view — success alert + next actions only */}
          {postInsertMode && (
            <div style={{ marginBottom: 14 }}>
              <Rows spacing="2u">
                <Alert
                  tone="positive"
                  onDismiss={() => {
                    setPostInsertMode(false);
                    setLastInsertCount(0);
                  }}
                >
                  {intl.formatMessage(
                    {
                      defaultMessage:
                        "Added {count, plural, one {# card} other {# cards}} to your design.",
                      description: "Success message shown after charts are added to the Canva design",
                    },
                    { count: lastInsertCount },
                  )}
                </Alert>

                <FormField
                  label={intl.formatMessage({
                    defaultMessage: "Save this set",
                    description: "Label for the input used to name a saved set after insertion",
                  })}
                  description={intl.formatMessage({
                    defaultMessage: "Load it next time and skip setup.",
                    description: "Helper text encouraging the user to save the current bundle after insertion",
                  })}
                  control={(props) => (
                    <TextInput
                      {...props}
                      placeholder={intl.formatMessage({
                        defaultMessage: "Name this saved set",
                        description: "Placeholder text in the input used to name a saved set after insertion",
                      })}
                      value={templateName}
                      onChange={(value) => setTemplateName(value)}
                    />
                  )}
                />
                <Button
                  variant="secondary"
                  stretch
                  onClick={saveNewTemplate}
                  disabled={!geo || !timespan || selectedVizzes.length === 0}
                >
                  {intl.formatMessage({
                    defaultMessage: "Save",
                    description: "Button label used to save the current bundle as a saved set",
                  })}
                </Button>

                <Button
                  variant="secondary"
                  stretch
                  onClick={() => {
                    if (!geo || selectedVizzes.length === 0) return;
                    generateAndInsertCaption({
                      geo_id: geo.id,
                      viz_id: selectedVizzes[0]!.id,
                      proptype,
                    });
                  }}
                  disabled={!geo || selectedVizzes.length === 0}
                >
                  {intl.formatMessage({
                    defaultMessage: "Generate AI caption",
                    description: "Button label used to generate and insert an AI-written caption for the selected metric",
                  })}
                </Button>

                <Button
                  variant="secondary"
                  stretch
                  onClick={() => {
                    setPostInsertMode(false);
                    setLastInsertCount(0);
                    setStep(0);
                  }}
                >
                  {intl.formatMessage({
                    defaultMessage: "Start over",
                    description: "Button label that returns the user to the beginning of the setup flow after insertion",
                  })}
                </Button>
              </Rows>
            </div>
          )}
          {!postInsertMode && (
          <div style={{ marginBottom: 12 }}>
            <div>
              <div style={{ marginBottom: 8 }}>
                <Text variant="bold" tagName="div">
                  <FormattedMessage
                    defaultMessage="Choose widget"
                    description="Heading above the widget selection cards in step three"
                  />
                </Text>
              </div>
              <Rows spacing="1u">
                {WIDGETS.map((w) => {
                  const active = widget === w.id;
                  return (
                    // Selection ring: HorizontalCard has no selected prop, so draw the
                    // purple border highlight (per design review) around the active card.
                    <div
                      key={w.id}
                      style={{
                        borderRadius: 8,
                        boxShadow: active ? `0 0 0 2px ${tokens.colorActionSelectedBorder}` : "none",
                      }}
                    >
                      <HorizontalCard
                        title={w.label}
                        description={w.desc}
                        ariaLabel={w.label}
                        thumbnail={{
                          url: svgDataUrl(PREVIEW_SVG_BY_WIDGET[w.id] ?? PREVIEW_SVG_BY_WIDGET.chart!),
                          alt: w.label,
                        }}
                        onClick={() => setWidget(w.id as any)}
                      />
                    </div>
                  );
                })}
              </Rows>
            </div>
            {/* Size — hidden entirely when the widget only offers one preset */}
            {presetSet.length > 1 && (
              <div style={{ margin: "12px 0 6px" }}>
                <FormField
                  label={intl.formatMessage({
                    defaultMessage: "Size",
                    description: "Label above the preset size selector for the selected widget",
                  })}
                  control={({ id }: { id: string }) => (
                    <SegmentedControl
                      id={id}
                      options={presetSet.map((p) => ({ value: p.id, label: p.label }))}
                      value={presetId}
                      onChange={(value) => setPresetId(value)}
                    />
                  )}
                />
              </div>
            )}
            <div style={{ marginTop: 10 }}>
            <Accordion>
              <AccordionItem
                title={intl.formatMessage({
                  defaultMessage: "Options",
                  description: "Title of the collapsible widget options panel",
                })}
              >
              <div style={{ display: "grid", gap: 8 }}>
                {(widget === "chart" || widget === "strip") && (
                  <Checkbox
                    checked={showTitle}
                    onChange={(_value, checked) => setShowTitle(checked)}
                    label={intl.formatMessage({
                      defaultMessage: "Show title block",
                      description: "Checkbox label that controls whether the chart title block is shown",
                    })}
                  />
                )}
                <FormField
                  label={intl.formatMessage({
                    defaultMessage: "Brand color",
                    description: "Label for the swatch that opens the brand color picker flyout",
                  })}
                  description={intl.formatMessage({
                    defaultMessage: "Applied to charts and accents.",
                    description: "Helper text under the brand color swatch",
                  })}
                  control={() => (
                    <ColorSelector
                      color={normalizeHex(color) || DEFAULT_BRAND_COLOR}
                      onChange={(value) => setColor(value)}
                      onDeleteColor={color ? () => setColor("") : undefined}
                    />
                  )}
                />
                <FormField
                  label={intl.formatMessage({
                    defaultMessage: "Background",
                    description: "Label for the dropdown used to choose the widget background color",
                  })}
                  control={(props) => (
                  <Select
                    {...props}
                    stretch
                    value={bg}
                    options={[
                      { value: "white", label: intl.formatMessage({ defaultMessage: "White", description: "Background color option for a white widget background" }) },
                      { value: "transparent", label: intl.formatMessage({ defaultMessage: "Transparent", description: "Background color option for a transparent widget background" }) },
                      { value: "#faf8f5", label: intl.formatMessage({ defaultMessage: "Warm white", description: "Background color option for a warm white widget background" }) },
                      { value: "#f3f4f6", label: intl.formatMessage({ defaultMessage: "Light gray", description: "Background color option for a light gray widget background" }) },
                      { value: "#f0fbfb", label: intl.formatMessage({ defaultMessage: "Soft IAR teal", description: "Background color option for a soft IAR teal widget background" }) },
                    ]}
                    onChange={(value) => setBg(value as string)}
                  />
                  )}
                />
                <FormField
                  label={intl.formatMessage({
                    defaultMessage: "Font size",
                    description: "Label for the dropdown used to choose the widget font size",
                  })}
                  control={(props) => (
                  <Select
                    {...props}
                    stretch
                    value={fontSize}
                    options={[
                      { value: "normal", label: intl.formatMessage({ defaultMessage: "Normal", description: "Font size option for the normal widget font size" }) },
                      { value: "large", label: intl.formatMessage({ defaultMessage: "Large", description: "Font size option for the large widget font size" }) },
                      { value: "compact", label: intl.formatMessage({ defaultMessage: "Compact", description: "Font size option for the compact widget font size" }) },
                    ]}
                    onChange={(value) => setFontSize(value as string)}
                  />
                  )}
                />
                <Checkbox
                  checked={border}
                  onChange={(_value, checked) => setBorder(checked)}
                  label={intl.formatMessage({
                    defaultMessage: "Show card border",
                    description: "Checkbox label that controls whether a border is shown around the widget",
                  })}
                />
              </div>
              </AccordionItem>
            </Accordion>
            </div>
          </div>
          )}
        </Section>
      )}

      {/* Loading — determinate progress bar shown inline while charts are added */}
      {isInserting && (
        <div role="status" aria-live="polite" style={{ marginTop: 12 }}>
          <Rows spacing="1u">
            <Text variant="bold" tagName="div">
              <FormattedMessage
                defaultMessage="Adding to your design…"
                description="Heading shown above the progress bar while charts are being added"
              />
            </Text>
            <ProgressBar
              value={Math.round(progress)}
              ariaLabel={intl.formatMessage({
                defaultMessage: "Progress adding charts to the design",
                description: "Accessible label for the progress bar shown while charts are being added",
              })}
            />
            <Text size="small" tone="secondary" tagName="div">
              <FormattedMessage
                defaultMessage="This can take up to 30 seconds depending on data and network."
                description="Helper text explaining that adding charts may take some time"
              />
            </Text>
          </Rows>
        </div>
      )}

      {/* Nav — hidden while the post-insert panel is up so the post-generate
          view stays focused; dismissing the success alert restores it */}
      {!(step === 2 && postInsertMode) && (
        <>
          <div style={{ height: 12 }} />
          <div style={{ display: "grid", gap: 8 }}>
            <Button
              variant="primary"
              stretch
              onClick={step < 2 ? next : insert}
              disabled={buttonDisabled}
              loading={isInserting}
            >
              {buttonLabel}
            </Button>
            {step > 0 && (
              <Button
                variant="secondary"
                stretch
                onClick={back}
                disabled={isInserting}
              >
                {intl.formatMessage({
                  defaultMessage: "Go back",
                  description: "Secondary navigation button label used to go to the previous step",
                })}
              </Button>
            )}
          </div>
        </>
      )}
      {step === 0 && (
        <div style={{ marginTop: 10 }}>
          <Text size="small" tone="secondary" alignment="center" tagName="div">
            <FormattedMessage
              defaultMessage="New here? <link>Getting started</link>"
              description="Footer help text; only the short 'Getting started' phrase is a link to the guide"
              values={{
                link: (chunks) => (
                  <Link
                    href="https://data.indianarealtors.com/canva/learn"
                    requestOpenExternalUrl={() => {
                      requestOpenExternalUrl({
                        url: "https://data.indianarealtors.com/canva/learn",
                      }).catch(console.error);
                    }}
                  >
                    {chunks}
                  </Link>
                ),
              }}
            />
          </Text>
        </div>
      )}
          </TabPanel>

          <TabPanel id="saved" active={mainTab === "saved"}>
            {allTemplatesSorted.length === 0 ? (
              // Empty state — centered within the app panel
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 280,
                  padding: 16,
                }}
              >
                <Text tone="secondary" alignment="center" tagName="div">
                  <FormattedMessage
                    defaultMessage="No saved sets yet. After you add charts to a design, save the set to reuse it here."
                    description="Empty-state message shown on the Saved tab when the user has no saved sets"
                  />
                </Text>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <Rows spacing="2u">
                  <FormField
                    label={intl.formatMessage({
                      defaultMessage: "Saved sets",
                      description: "Label for the dropdown listing the user's saved sets",
                    })}
                    description={intl.formatMessage({
                      defaultMessage: "Saved sets are stored on this device.",
                      description: "Helper text explaining that saved sets are stored locally on the current device",
                    })}
                    control={(props) => (
                      <Select
                        {...props}
                        stretch
                        placeholder={intl.formatMessage({
                          defaultMessage: "Choose a saved set",
                          description: "Placeholder in the saved sets dropdown before a saved set is selected",
                        })}
                        value={activeTemplateId || undefined}
                        options={allTemplatesSorted.map((t) => ({
                          value: t.id,
                          label: t.name,
                          description: t.geoLabel || undefined,
                        }))}
                        onChange={(id) => {
                          setActiveTemplateId(id as string);
                          setConfirmDeleteArmed(false);
                        }}
                      />
                    )}
                  />
                  <Button
                    variant="primary"
                    stretch
                    disabled={!activeTemplate}
                    onClick={() => {
                      if (activeTemplate) loadTemplate(activeTemplate);
                    }}
                  >
                    {intl.formatMessage({
                      defaultMessage: "Load set",
                      description: "Button label to load the currently selected saved set",
                    })}
                  </Button>
                  <Button
                    variant="secondary"
                    stretch
                    disabled={!activeTemplate}
                    onClick={() => {
                      if (!activeTemplate) return;
                      if (!confirmDeleteArmed) {
                        armDeleteOnce();
                        return;
                      }
                      deleteActiveTemplate();
                      setConfirmDeleteArmed(false);
                    }}
                  >
                    {confirmDeleteArmed
                      ? intl.formatMessage({
                          defaultMessage: "Click again to delete",
                          description: "Delete confirmation button text shown after the first click on delete saved set",
                        })
                      : intl.formatMessage({
                          defaultMessage: "Delete saved set",
                          description: "Button label to delete the currently selected saved set",
                        })}
                  </Button>
                </Rows>
              </div>
            )}
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  );
}

/* ---------- UI bits ---------- */
function Section(props: {
  badge?: string;
  badgeLabel?: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, marginTop: 12 }}>
        {props.badge && (
          <Badge tone="assist" shape="circle" text={props.badge} ariaLabel={props.badgeLabel} />
        )}
        <Text variant="bold" tagName="div">{props.title}</Text>
      </div>
      {props.children}
    </div>
  );
}

/* ---------- Styles ---------- */
// The Canva sandbox already provides left padding; apply our own to the
// remaining sides only (16px top/right/bottom per design review).
const shell: React.CSSProperties = {
  padding: "16px 16px 16px 0",
};

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
