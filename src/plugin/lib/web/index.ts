import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative } from "path";

export interface WebProjectProfile { detected: boolean; framework: "nextjs" | "react" | "unknown"; signals: string[]; verification: string[]; risks: string[] }
export interface WebRouteInfo { path: string; kind: "page" | "layout" | "route" | "component"; dynamic: boolean; serverAction: boolean; clientComponent: boolean }
export interface WebVisualQaPlan { required: boolean; tools: string[]; viewports: string[]; checks: string[]; evidence: string[] }
export interface WebPatternRecommendation { surface: string; recommendedPattern: string; rationale: string }
export interface WebProjectScan extends WebProjectProfile { routes: WebRouteInfo[]; stateHooks: string[]; accessibilityRisks: string[]; envKeys: string[]; visualQa: WebVisualQaPlan; patternRecommendations: WebPatternRecommendation[]; frontendFlow: string[] }

export function buildWebAdvancedFlow(files: string[]): WebProjectProfile {
  const corpus = files.join("\n").toLowerCase();
  const next = /next\.config|app\/|pages\/|server action|route\.ts/.test(corpus);
  const react = next || /src\/.*\.(tsx|jsx)|useeffect|usestate|vite\.config/.test(corpus);
  const signals = [next ? "nextjs routing/build surface" : undefined, react ? "react component surface" : undefined, /\.env|process\.env/.test(corpus) ? "environment config" : undefined].filter(Boolean) as string[];
  const verification = next ? ["npm run build", "npm test"] : react ? ["npm test", "npm run lint"] : [];
  const risks = [next ? "Server/client boundary and caching behavior require build verification." : undefined, /dangerouslysetinnerhtml|innerhtml/.test(corpus) ? "Potential XSS-prone rendering path." : undefined].filter(Boolean) as string[];
  return { detected: react || next, framework: next ? "nextjs" : react ? "react" : "unknown", signals, verification, risks };
}

function walk(root: string, max = 200): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    if (out.length >= max || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist" || entry.name === "coverage" || entry.name === "tests" || entry.name === "__tests__") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(tsx|jsx|ts|js|mjs|cjs)$|^package\.json$|^next\.config\./.test(entry.name)) out.push(path);
    }
  };
  visit(root);
  return out;
}

export function scanWebProject(root: string): WebProjectScan {
  const paths = walk(root);
  const rels = paths.map((path) => relative(root, path).replace(/\\/g, "/"));
  const base = buildWebAdvancedFlow(rels);
  const routes: WebRouteInfo[] = [];
  const stateHooks = new Set<string>();
  const accessibilityRisks: string[] = [];
  const envKeys = new Set<string>();
  let hasForms = false;
  for (const path of paths) {
    const rel = relative(root, path).replace(/\\/g, "/");
    const text = readFileSync(path, "utf8");
    const isRoute = /(?:^|\/)(?:app|pages|src\/app|src\/pages|src\/routes)\/.*route\.(ts|js)$/.test(rel);
    const isPage = /(?:^|\/)(?:app|pages|src\/app|src\/pages)\/.*page\.(tsx|jsx|ts|js)$/.test(rel);
    const isLayout = /(?:^|\/)(?:app|pages|src\/app|src\/pages)\/.*layout\.(tsx|jsx|ts|js)$/.test(rel);
    const isComponent = /\.(tsx|jsx)$/.test(rel) && !isPage && !isLayout;
    if (isRoute || isPage || isLayout || isComponent) routes.push({ path: rel, kind: isRoute ? "route" : isPage ? "page" : isLayout ? "layout" : "component", dynamic: /\[[^\]]+\]/.test(rel), serverAction: /['"]use server['"]/.test(text), clientComponent: /['"]use client['"]/.test(text) });
    for (const hook of text.matchAll(/\b(useState|useEffect|useReducer|useMemo|useCallback|useContext)\b/g)) stateHooks.add(hook[1]!);
    if (/\.(tsx|jsx)$/.test(rel) && /<img\b(?![^>]*\balt=)/i.test(text)) accessibilityRisks.push(`${rel}: img without alt`);
    if (/\.(tsx|jsx)$/.test(rel) && /<button\b(?![^>]*>|[^<]*<\/button>)/i.test(text)) accessibilityRisks.push(`${rel}: button content should be verified`);
    if (!hasForms && /<form\b|react-hook-form|zod|yup|valibot/i.test(text)) hasForms = true;
    for (const env of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) envKeys.add(env[1]!);
  }
  const routeRels = routes.map((route) => route.path);
  const hasDashboard = routeRels.some((rel) => /dashboard|analytics|metrics|report/i.test(rel));
  const hasSettings = routeRels.some((rel) => /settings|preferences|account|billing/i.test(rel));
  const patternRecommendations: WebPatternRecommendation[] = [
    hasDashboard ? { surface: "dashboard", recommendedPattern: "Data Dashboard", rationale: "Dashboard-like routes need KPI/chart/table hierarchy, data freshness, empty/partial states, and actionable metrics." } : undefined,
    hasSettings ? { surface: "settings", recommendedPattern: "Settings / Preferences", rationale: "Settings-like routes need grouped sections, save state, permission handling, and isolated destructive actions." } : undefined,
    hasForms ? { surface: "forms", recommendedPattern: "Forms / Onboarding", rationale: "Form signals need inline validation, server rejection handling, partial save/submit states, and clear field microcopy." } : undefined,
    routes.length && !hasDashboard && !hasSettings && !hasForms ? { surface: "general-web", recommendedPattern: base.framework === "nextjs" ? "Product App / Next.js Surface" : "React Product Surface", rationale: "Detected route/component surface should reuse existing design tokens and map backend states before visual polish." } : undefined,
  ].filter(Boolean) as WebPatternRecommendation[];
  const visualQa: WebVisualQaPlan = {
    required: routes.length > 0,
    tools: ["Playwright/browser snapshot", "desktop screenshot", "tablet screenshot", "mobile screenshot", "console/network review"],
    viewports: ["1440x900 desktop", "1024x768 tablet", "390x844 mobile"],
    checks: ["hierarchy", "spacing rhythm", "typography", "contrast", "responsive layout", "interaction states", "backend empty/error/loading/permission states", "anti-AI smell"],
    evidence: ["screenshot or browser snapshot", "console/network result", "visual QA rubric score", "remaining visual risks"],
  };
  const frontendFlow = [
    "Inspect existing UI tokens/components before introducing visual language.",
    "Select UI pattern from ui-pattern-library based on domain and route/data shape.",
    "Map backend contracts and async states before implementation.",
    "Use human-ui-design checklist to avoid generic AI-looking UI.",
    "Run visual-qa-rubric with browser screenshots when a runnable app is available.",
  ];
  const risks = [...base.risks, ...accessibilityRisks, routes.some((r) => r.serverAction) ? "Server Actions require auth/input validation review." : undefined, routes.length ? "Visual QA needs browser screenshot evidence before UI completion claims." : undefined].filter(Boolean) as string[];
  return { ...base, detected: base.detected || routes.length > 0, routes, stateHooks: [...stateHooks], accessibilityRisks, envKeys: [...envKeys], visualQa, patternRecommendations, frontendFlow, risks };
}
