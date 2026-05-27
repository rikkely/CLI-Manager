import type { ITheme } from "@xterm/xterm";

export interface TerminalThemePreset {
  id: string;
  name: string;
  theme: ITheme;
  family?: string;
  tone?: "light" | "dark";
}

export type LightTerminalPalette =
  | "warm-paper"
  | "cream-green"
  | "ink-red"
  | "saas-analytics-dashboard"
  | "apple-pure"
  | "apple-mist"
  | "apple-warm"
  | "apple-mono";
export type DarkTerminalPalette = "night-indigo" | "forest-night" | "graphite-red" | "investment-platform";

const tokyoNightDark: ITheme = {
  background: "#1a1b26",
  foreground: "#c0caf5",
  cursor: "#c0caf5",
  selectionBackground: "#364a82",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};

const tokyoNightLight: ITheme = {
  background: "#f5f5f5",
  foreground: "#343b58",
  cursor: "#343b58",
  selectionBackground: "#b4c0e0",
  black: "#0f0f14",
  red: "#8c4351",
  green: "#485e30",
  yellow: "#8f5e15",
  blue: "#34548a",
  magenta: "#5a4a78",
  cyan: "#0f4b6e",
  white: "#343b58",
  brightBlack: "#9699a3",
  brightRed: "#8c4351",
  brightGreen: "#485e30",
  brightYellow: "#8f5e15",
  brightBlue: "#34548a",
  brightMagenta: "#5a4a78",
  brightCyan: "#0f4b6e",
  brightWhite: "#343b58",
};

const forestNightDark: ITheme = {
  background: "#111714",
  foreground: "#d8e5dc",
  cursor: "#d8e5dc",
  selectionBackground: "#2a3a31",
  black: "#0d1410",
  red: "#dc6e74",
  green: "#6bc28f",
  yellow: "#d8b15f",
  blue: "#6ea88f",
  magenta: "#7c9b84",
  cyan: "#66a79a",
  white: "#c8d8ce",
  brightBlack: "#4b5f55",
  brightRed: "#e6848a",
  brightGreen: "#7dd0a0",
  brightYellow: "#e2be74",
  brightBlue: "#81b8a2",
  brightMagenta: "#8eab96",
  brightCyan: "#79b8aa",
  brightWhite: "#e6efe9",
};

const graphiteRedDark: ITheme = {
  background: "#171616",
  foreground: "#e6dfdb",
  cursor: "#e6dfdb",
  selectionBackground: "#3a3232",
  black: "#121111",
  red: "#e06a6a",
  green: "#64b487",
  yellow: "#d3a053",
  blue: "#b48a77",
  magenta: "#c08a7a",
  cyan: "#8ea091",
  white: "#d2c8c3",
  brightBlack: "#5b4f4f",
  brightRed: "#e97f7f",
  brightGreen: "#79c49a",
  brightYellow: "#ddb168",
  brightBlue: "#c09a89",
  brightMagenta: "#ca9b8e",
  brightCyan: "#9db0a3",
  brightWhite: "#f1eae6",
};

const warmPaperLight: ITheme = {
  background: "#fffdf8",
  foreground: "#3a3126",
  cursor: "#5b4f41",
  selectionBackground: "#e7dcc8",
  black: "#2d261d",
  red: "#c84a4a",
  green: "#2f8f62",
  yellow: "#b8842a",
  blue: "#8b6b45",
  magenta: "#a35b3a",
  cyan: "#6f7b57",
  white: "#6f6252",
  brightBlack: "#8a7b6a",
  brightRed: "#d66161",
  brightGreen: "#3ea574",
  brightYellow: "#c9973e",
  brightBlue: "#9b7a53",
  brightMagenta: "#b86a46",
  brightCyan: "#7f8e66",
  brightWhite: "#2d261d",
};

const creamGreenLight: ITheme = {
  background: "#fdfdf9",
  foreground: "#223224",
  cursor: "#3f5141",
  selectionBackground: "#dce5d8",
  black: "#1f2a20",
  red: "#b84b4b",
  green: "#2d8a5f",
  yellow: "#a77d2f",
  blue: "#3f7a4f",
  magenta: "#5a6a3f",
  cyan: "#3e6f63",
  white: "#54645a",
  brightBlack: "#6e7f70",
  brightRed: "#c76060",
  brightGreen: "#43a174",
  brightYellow: "#b88d41",
  brightBlue: "#4f8d60",
  brightMagenta: "#6e7f4d",
  brightCyan: "#4f8276",
  brightWhite: "#1f2a20",
};

const inkRedLight: ITheme = {
  background: "#ffffff",
  foreground: "#2a2722",
  cursor: "#494943",
  selectionBackground: "#ebe7df",
  black: "#1f1f1c",
  red: "#b63a3a",
  green: "#2b8a5a",
  yellow: "#b07a22",
  blue: "#7a5140",
  magenta: "#8a4a40",
  cyan: "#5f6d55",
  white: "#59564e",
  brightBlack: "#7b7b72",
  brightRed: "#c74a4a",
  brightGreen: "#3ea070",
  brightYellow: "#c08d35",
  brightBlue: "#8c604d",
  brightMagenta: "#9b5a4e",
  brightCyan: "#738266",
  brightWhite: "#1f1f1c",
};

const saasAnalyticsDashboardLight: ITheme = {
  background: "#f8fbff",
  foreground: "#1e293b",
  cursor: "#1e293b",
  selectionBackground: "#dbeafe",
  black: "#1e293b",
  red: "#dc2626",
  green: "#0f766e",
  yellow: "#d97706",
  blue: "#2563eb",
  magenta: "#7c3aed",
  cyan: "#0891b2",
  white: "#64748b",
  brightBlack: "#94a3b8",
  brightRed: "#ef4444",
  brightGreen: "#14b8a6",
  brightYellow: "#f59e0b",
  brightBlue: "#3b82f6",
  brightMagenta: "#8b5cf6",
  brightCyan: "#06b6d4",
  brightWhite: "#0f172a",
};

const investmentPlatformDark: ITheme = {
  background: "#0f172a",
  foreground: "#f8fafc",
  cursor: "#f8fafc",
  selectionBackground: "#1d4ed8",
  black: "#020617",
  red: "#f87171",
  green: "#34d399",
  yellow: "#f59e0b",
  blue: "#38bdf8",
  magenta: "#8b5cf6",
  cyan: "#22d3ee",
  white: "#cbd5e1",
  brightBlack: "#475569",
  brightRed: "#fca5a5",
  brightGreen: "#6ee7b7",
  brightYellow: "#fbbf24",
  brightBlue: "#7dd3fc",
  brightMagenta: "#c4b5fd",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
};

const dracula: ITheme = {
  background: "#282a36",
  foreground: "#f8f8f2",
  cursor: "#f8f8f2",
  selectionBackground: "#44475a",
  black: "#21222c",
  red: "#ff5555",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  blue: "#bd93f9",
  magenta: "#ff79c6",
  cyan: "#8be9fd",
  white: "#f8f8f2",
  brightBlack: "#6272a4",
  brightRed: "#ff6e6e",
  brightGreen: "#69ff94",
  brightYellow: "#ffffa5",
  brightBlue: "#d6acff",
  brightMagenta: "#ff92df",
  brightCyan: "#a4ffff",
  brightWhite: "#ffffff",
};

const monokai: ITheme = {
  background: "#272822",
  foreground: "#f8f8f2",
  cursor: "#f8f8f0",
  selectionBackground: "#49483e",
  black: "#272822",
  red: "#f92672",
  green: "#a6e22e",
  yellow: "#f4bf75",
  blue: "#66d9ef",
  magenta: "#ae81ff",
  cyan: "#a1efe4",
  white: "#f8f8f2",
  brightBlack: "#75715e",
  brightRed: "#f92672",
  brightGreen: "#a6e22e",
  brightYellow: "#f4bf75",
  brightBlue: "#66d9ef",
  brightMagenta: "#ae81ff",
  brightCyan: "#a1efe4",
  brightWhite: "#f9f8f5",
};

const nord: ITheme = {
  background: "#2e3440",
  foreground: "#d8dee9",
  cursor: "#d8dee9",
  selectionBackground: "#434c5e",
  black: "#3b4252",
  red: "#bf616a",
  green: "#a3be8c",
  yellow: "#ebcb8b",
  blue: "#81a1c1",
  magenta: "#b48ead",
  cyan: "#88c0d0",
  white: "#e5e9f0",
  brightBlack: "#4c566a",
  brightRed: "#bf616a",
  brightGreen: "#a3be8c",
  brightYellow: "#ebcb8b",
  brightBlue: "#81a1c1",
  brightMagenta: "#b48ead",
  brightCyan: "#8fbcbb",
  brightWhite: "#eceff4",
};

const solarizedDark: ITheme = {
  background: "#002b36",
  foreground: "#839496",
  cursor: "#839496",
  selectionBackground: "#073642",
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#eee8d5",
  brightBlack: "#586e75",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
};

const solarizedLight: ITheme = {
  background: "#fdf6e3",
  foreground: "#657b83",
  cursor: "#657b83",
  selectionBackground: "#eee8d5",
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#eee8d5",
  brightBlack: "#586e75",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
};

const oneDark: ITheme = {
  background: "#282c34",
  foreground: "#abb2bf",
  cursor: "#528bff",
  selectionBackground: "#3e4451",
  black: "#282c34",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#abb2bf",
  brightBlack: "#5c6370",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
};

const githubDark: ITheme = {
  background: "#24292e",
  foreground: "#e1e4e8",
  cursor: "#c8e1ff",
  selectionBackground: "#444d56",
  black: "#586069",
  red: "#ea4a5a",
  green: "#34d058",
  yellow: "#ffea7f",
  blue: "#2188ff",
  magenta: "#b392f0",
  cyan: "#39c5cf",
  white: "#d1d5da",
  brightBlack: "#959da5",
  brightRed: "#f97583",
  brightGreen: "#85e89d",
  brightYellow: "#ffea7f",
  brightBlue: "#79b8ff",
  brightMagenta: "#b392f0",
  brightCyan: "#56d4dd",
  brightWhite: "#fafbfc",
};

const githubLight: ITheme = {
  background: "#ffffff",
  foreground: "#24292e",
  cursor: "#044289",
  selectionBackground: "#c8c8fa",
  black: "#24292e",
  red: "#d73a49",
  green: "#22863a",
  yellow: "#e36209",
  blue: "#005cc5",
  magenta: "#6f42c1",
  cyan: "#032f62",
  white: "#6a737d",
  brightBlack: "#959da5",
  brightRed: "#cb2431",
  brightGreen: "#28a745",
  brightYellow: "#b08800",
  brightBlue: "#2188ff",
  brightMagenta: "#8a63d2",
  brightCyan: "#3192aa",
  brightWhite: "#d1d5da",
};

const catppuccinMocha: ITheme = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  selectionBackground: "#585b70",
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#bac2de",
  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#f5c2e7",
  brightCyan: "#94e2d5",
  brightWhite: "#a6adc8",
};

const catppuccinMacchiato: ITheme = {
  background: "#24273a",
  foreground: "#cad3f5",
  cursor: "#f4dbd6",
  selectionBackground: "#5b6078",
  black: "#494d64",
  red: "#ed8796",
  green: "#a6da95",
  yellow: "#eed49f",
  blue: "#8aadf4",
  magenta: "#f5bde6",
  cyan: "#8bd5ca",
  white: "#b8c0e0",
  brightBlack: "#5b6078",
  brightRed: "#ed8796",
  brightGreen: "#a6da95",
  brightYellow: "#eed49f",
  brightBlue: "#8aadf4",
  brightMagenta: "#f5bde6",
  brightCyan: "#8bd5ca",
  brightWhite: "#a5adcb",
};

const catppuccinLatte: ITheme = {
  background: "#eff1f5",
  foreground: "#4c4f69",
  cursor: "#dc8a78",
  selectionBackground: "#acb0be",
  black: "#5c5f77",
  red: "#d20f39",
  green: "#40a02b",
  yellow: "#df8e1d",
  blue: "#1e66f5",
  magenta: "#ea76cb",
  cyan: "#179299",
  white: "#acb0be",
  brightBlack: "#6c6f85",
  brightRed: "#d20f39",
  brightGreen: "#40a02b",
  brightYellow: "#df8e1d",
  brightBlue: "#1e66f5",
  brightMagenta: "#ea76cb",
  brightCyan: "#179299",
  brightWhite: "#bcc0cc",
};

const gruvboxDark: ITheme = {
  background: "#282828",
  foreground: "#ebdbb2",
  cursor: "#ebdbb2",
  selectionBackground: "#504945",
  black: "#282828",
  red: "#cc241d",
  green: "#98971a",
  yellow: "#d79921",
  blue: "#458588",
  magenta: "#b16286",
  cyan: "#689d6a",
  white: "#a89984",
  brightBlack: "#928374",
  brightRed: "#fb4934",
  brightGreen: "#b8bb26",
  brightYellow: "#fabd2f",
  brightBlue: "#83a598",
  brightMagenta: "#d3869b",
  brightCyan: "#8ec07c",
  brightWhite: "#ebdbb2",
};

const gruvboxLight: ITheme = {
  background: "#fbf1c7",
  foreground: "#3c3836",
  cursor: "#3c3836",
  selectionBackground: "#d5c4a1",
  black: "#fbf1c7",
  red: "#cc241d",
  green: "#98971a",
  yellow: "#d79921",
  blue: "#458588",
  magenta: "#b16286",
  cyan: "#689d6a",
  white: "#7c6f64",
  brightBlack: "#928374",
  brightRed: "#9d0006",
  brightGreen: "#79740e",
  brightYellow: "#b57614",
  brightBlue: "#076678",
  brightMagenta: "#8f3f71",
  brightCyan: "#427b58",
  brightWhite: "#3c3836",
};

const everforestDark: ITheme = {
  background: "#2d353b",
  foreground: "#d3c6aa",
  cursor: "#d3c6aa",
  selectionBackground: "#475258",
  black: "#343f44",
  red: "#e67e80",
  green: "#a7c080",
  yellow: "#dbbc7f",
  blue: "#7fbbb3",
  magenta: "#d699b6",
  cyan: "#83c092",
  white: "#d3c6aa",
  brightBlack: "#475258",
  brightRed: "#e67e80",
  brightGreen: "#a7c080",
  brightYellow: "#dbbc7f",
  brightBlue: "#7fbbb3",
  brightMagenta: "#d699b6",
  brightCyan: "#83c092",
  brightWhite: "#d3c6aa",
};

const everforestLight: ITheme = {
  background: "#fdf6e3",
  foreground: "#5c6a72",
  cursor: "#5c6a72",
  selectionBackground: "#e8e0c9",
  black: "#5c6a72",
  red: "#f85552",
  green: "#8da101",
  yellow: "#dfa000",
  blue: "#3a94c5",
  magenta: "#df69ba",
  cyan: "#35a77c",
  white: "#dfddc8",
  brightBlack: "#939f91",
  brightRed: "#f85552",
  brightGreen: "#8da101",
  brightYellow: "#dfa000",
  brightBlue: "#3a94c5",
  brightMagenta: "#df69ba",
  brightCyan: "#35a77c",
  brightWhite: "#5c6a72",
};

const rosePine: ITheme = {
  background: "#191724",
  foreground: "#e0def4",
  cursor: "#e0def4",
  selectionBackground: "#403d52",
  black: "#26233a",
  red: "#eb6f92",
  green: "#31748f",
  yellow: "#f6c177",
  blue: "#9ccfd8",
  magenta: "#c4a7e7",
  cyan: "#ebbcba",
  white: "#e0def4",
  brightBlack: "#6e6a86",
  brightRed: "#eb6f92",
  brightGreen: "#31748f",
  brightYellow: "#f6c177",
  brightBlue: "#9ccfd8",
  brightMagenta: "#c4a7e7",
  brightCyan: "#ebbcba",
  brightWhite: "#e0def4",
};

const rosePineMoon: ITheme = {
  background: "#232136",
  foreground: "#e0def4",
  cursor: "#e0def4",
  selectionBackground: "#44415a",
  black: "#393552",
  red: "#eb6f92",
  green: "#3e8fb0",
  yellow: "#f6c177",
  blue: "#9ccfd8",
  magenta: "#c4a7e7",
  cyan: "#ea9a97",
  white: "#e0def4",
  brightBlack: "#6e6a86",
  brightRed: "#eb6f92",
  brightGreen: "#3e8fb0",
  brightYellow: "#f6c177",
  brightBlue: "#9ccfd8",
  brightMagenta: "#c4a7e7",
  brightCyan: "#ea9a97",
  brightWhite: "#e0def4",
};

const rosePineDawn: ITheme = {
  background: "#faf4ed",
  foreground: "#575279",
  cursor: "#575279",
  selectionBackground: "#dfdad9",
  black: "#f2e9e1",
  red: "#b4637a",
  green: "#286983",
  yellow: "#ea9d34",
  blue: "#56949f",
  magenta: "#907aa9",
  cyan: "#d7827e",
  white: "#575279",
  brightBlack: "#9893a5",
  brightRed: "#b4637a",
  brightGreen: "#286983",
  brightYellow: "#ea9d34",
  brightBlue: "#56949f",
  brightMagenta: "#907aa9",
  brightCyan: "#d7827e",
  brightWhite: "#575279",
};

const kanagawaWave: ITheme = {
  background: "#1f1f28",
  foreground: "#dcd7ba",
  cursor: "#c8c093",
  selectionBackground: "#2d4f67",
  black: "#090618",
  red: "#c34043",
  green: "#76946a",
  yellow: "#c0a36e",
  blue: "#7e9cd8",
  magenta: "#957fb8",
  cyan: "#6a9589",
  white: "#c8c093",
  brightBlack: "#727169",
  brightRed: "#e82424",
  brightGreen: "#98bb6c",
  brightYellow: "#e6c384",
  brightBlue: "#7fb4ca",
  brightMagenta: "#938aa9",
  brightCyan: "#7aa89f",
  brightWhite: "#dcd7ba",
};

const ayuDark: ITheme = {
  background: "#0b0e14",
  foreground: "#b3b1ad",
  cursor: "#e6b450",
  selectionBackground: "#273747",
  black: "#01060e",
  red: "#f07178",
  green: "#c2d94c",
  yellow: "#ffb454",
  blue: "#59c2ff",
  magenta: "#d2a6ff",
  cyan: "#95e6cb",
  white: "#b3b1ad",
  brightBlack: "#686868",
  brightRed: "#f07178",
  brightGreen: "#c2d94c",
  brightYellow: "#ffb454",
  brightBlue: "#59c2ff",
  brightMagenta: "#d2a6ff",
  brightCyan: "#95e6cb",
  brightWhite: "#f8f8f2",
};

const ayuLight: ITheme = {
  background: "#fafafa",
  foreground: "#5c6166",
  cursor: "#ffaa33",
  selectionBackground: "#f0eee4",
  black: "#000000",
  red: "#f07171",
  green: "#86b300",
  yellow: "#f2ae49",
  blue: "#55b4d4",
  magenta: "#a37acc",
  cyan: "#4cbf99",
  white: "#5c6166",
  brightBlack: "#828c99",
  brightRed: "#f07171",
  brightGreen: "#86b300",
  brightYellow: "#f2ae49",
  brightBlue: "#55b4d4",
  brightMagenta: "#a37acc",
  brightCyan: "#4cbf99",
  brightWhite: "#ffffff",
};

const nightOwl: ITheme = {
  background: "#011627",
  foreground: "#d6deeb",
  cursor: "#80a4c2",
  selectionBackground: "#1d3b53",
  black: "#011627",
  red: "#ef5350",
  green: "#22da6e",
  yellow: "#addb67",
  blue: "#82aaff",
  magenta: "#c792ea",
  cyan: "#21c7a8",
  white: "#ffffff",
  brightBlack: "#575656",
  brightRed: "#ef5350",
  brightGreen: "#22da6e",
  brightYellow: "#ffeb95",
  brightBlue: "#82aaff",
  brightMagenta: "#c792ea",
  brightCyan: "#7fdbca",
  brightWhite: "#ffffff",
};

const materialPalenight: ITheme = {
  background: "#292d3e",
  foreground: "#a6accd",
  cursor: "#ffcc00",
  selectionBackground: "#444267",
  black: "#000000",
  red: "#f07178",
  green: "#c3e88d",
  yellow: "#ffcb6b",
  blue: "#82aaff",
  magenta: "#c792ea",
  cyan: "#89ddff",
  white: "#eeffff",
  brightBlack: "#676e95",
  brightRed: "#f07178",
  brightGreen: "#c3e88d",
  brightYellow: "#ffcb6b",
  brightBlue: "#82aaff",
  brightMagenta: "#c792ea",
  brightCyan: "#89ddff",
  brightWhite: "#ffffff",
};

const oneLight: ITheme = {
  background: "#fafafa",
  foreground: "#383a42",
  cursor: "#526eff",
  selectionBackground: "#bfceff",
  black: "#383a42",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#4078f2",
  magenta: "#a626a4",
  cyan: "#0184bc",
  white: "#a0a1a7",
  brightBlack: "#696c77",
  brightRed: "#e45649",
  brightGreen: "#50a14f",
  brightYellow: "#c18401",
  brightBlue: "#4078f2",
  brightMagenta: "#a626a4",
  brightCyan: "#0184bc",
  brightWhite: "#ffffff",
};

export const TERMINAL_THEME_PRESETS: TerminalThemePreset[] = [
  { id: "tokyoNightDark", name: "Tokyo Night Dark", theme: tokyoNightDark, family: "tokyo-night", tone: "dark" },
  { id: "tokyoNightLight", name: "Tokyo Night Light", theme: tokyoNightLight, family: "tokyo-night", tone: "light" },
  { id: "forestNightDark", name: "Forest Night Dark", theme: forestNightDark, family: "atelier", tone: "dark" },
  { id: "graphiteRedDark", name: "Graphite Red Dark", theme: graphiteRedDark, family: "atelier", tone: "dark" },
  { id: "investmentPlatformDark", name: "Investment Platform Dark", theme: investmentPlatformDark, family: "atelier", tone: "dark" },
  { id: "warmPaperLight", name: "Warm Paper Light", theme: warmPaperLight, family: "atelier", tone: "light" },
  { id: "creamGreenLight", name: "Cream Green Light", theme: creamGreenLight, family: "atelier", tone: "light" },
  { id: "inkRedLight", name: "Ink Red Light", theme: inkRedLight, family: "atelier", tone: "light" },
  { id: "saasAnalyticsDashboardLight", name: "SaaS Analytics Dashboard Light", theme: saasAnalyticsDashboardLight, family: "atelier", tone: "light" },
  { id: "dracula", name: "Dracula", theme: dracula, family: "classic", tone: "dark" },
  { id: "monokai", name: "Monokai", theme: monokai, family: "classic", tone: "dark" },
  { id: "nord", name: "Nord", theme: nord, family: "nord", tone: "dark" },
  { id: "solarizedDark", name: "Solarized Dark", theme: solarizedDark, family: "solarized", tone: "dark" },
  { id: "solarizedLight", name: "Solarized Light", theme: solarizedLight, family: "solarized", tone: "light" },
  { id: "oneDark", name: "One Dark", theme: oneDark, family: "one-dark", tone: "dark" },
  { id: "githubDark", name: "GitHub Dark", theme: githubDark, family: "github", tone: "dark" },
  { id: "githubLight", name: "GitHub Light", theme: githubLight, family: "github", tone: "light" },
  { id: "catppuccinMocha", name: "Catppuccin Mocha", theme: catppuccinMocha, family: "catppuccin", tone: "dark" },
  { id: "catppuccinMacchiato", name: "Catppuccin Macchiato", theme: catppuccinMacchiato, family: "catppuccin", tone: "dark" },
  { id: "catppuccinLatte", name: "Catppuccin Latte", theme: catppuccinLatte, family: "catppuccin", tone: "light" },
  { id: "gruvboxDark", name: "Gruvbox Dark", theme: gruvboxDark, family: "gruvbox", tone: "dark" },
  { id: "gruvboxLight", name: "Gruvbox Light", theme: gruvboxLight, family: "gruvbox", tone: "light" },
  { id: "everforestDark", name: "Everforest Dark", theme: everforestDark, family: "everforest", tone: "dark" },
  { id: "everforestLight", name: "Everforest Light", theme: everforestLight, family: "everforest", tone: "light" },
  { id: "rosePine", name: "Rosé Pine", theme: rosePine, family: "rose-pine", tone: "dark" },
  { id: "rosePineMoon", name: "Rosé Pine Moon", theme: rosePineMoon, family: "rose-pine", tone: "dark" },
  { id: "rosePineDawn", name: "Rosé Pine Dawn", theme: rosePineDawn, family: "rose-pine", tone: "light" },
  { id: "kanagawaWave", name: "Kanagawa Wave", theme: kanagawaWave, family: "kanagawa", tone: "dark" },
  { id: "ayuDark", name: "Ayu Dark", theme: ayuDark, family: "ayu", tone: "dark" },
  { id: "ayuLight", name: "Ayu Light", theme: ayuLight, family: "ayu", tone: "light" },
  { id: "nightOwl", name: "Night Owl", theme: nightOwl, family: "night-owl", tone: "dark" },
  { id: "materialPalenight", name: "Material Palenight", theme: materialPalenight, family: "material", tone: "dark" },
  { id: "oneLight", name: "One Light", theme: oneLight, family: "one-dark", tone: "light" },
];

const themeMap = new Map(TERMINAL_THEME_PRESETS.map((p) => [p.id, p.theme]));

function resolveAutoLightThemeId(lightPalette: LightTerminalPalette = "warm-paper"): string {
  if (lightPalette === "cream-green") return "creamGreenLight";
  if (lightPalette === "ink-red") return "inkRedLight";
  if (lightPalette === "saas-analytics-dashboard") return "saasAnalyticsDashboardLight";
  if (lightPalette === "apple-pure") return "githubLight";
  if (lightPalette === "apple-mist") return "githubLight";
  if (lightPalette === "apple-warm") return "warmPaperLight";
  if (lightPalette === "apple-mono") return "githubLight";
  return "warmPaperLight";
}

function resolveAutoDarkThemeId(darkPalette: DarkTerminalPalette = "night-indigo"): string {
  if (darkPalette === "forest-night") return "forestNightDark";
  if (darkPalette === "graphite-red") return "graphiteRedDark";
  if (darkPalette === "investment-platform") return "investmentPlatformDark";
  return "tokyoNightDark";
}

function resolveAutoLightTheme(lightPalette: LightTerminalPalette = "warm-paper"): ITheme {
  return themeMap.get(resolveAutoLightThemeId(lightPalette)) ?? warmPaperLight;
}

function resolveAutoDarkTheme(darkPalette: DarkTerminalPalette = "night-indigo"): ITheme {
  return themeMap.get(resolveAutoDarkThemeId(darkPalette)) ?? tokyoNightDark;
}

export function resolveAutoTerminalThemeId(
  resolvedTheme: "dark" | "light",
  lightPalette: LightTerminalPalette = "warm-paper",
  darkPalette: DarkTerminalPalette = "night-indigo"
): string {
  return resolvedTheme === "dark" ? resolveAutoDarkThemeId(darkPalette) : resolveAutoLightThemeId(lightPalette);
}

export function getTerminalTheme(
  themeName: string,
  resolvedTheme: "dark" | "light",
  lightPalette: LightTerminalPalette = "warm-paper",
  darkPalette: DarkTerminalPalette = "night-indigo"
): ITheme {
  if (themeName === "auto") {
    return resolvedTheme === "dark" ? resolveAutoDarkTheme(darkPalette) : resolveAutoLightTheme(lightPalette);
  }
  return themeMap.get(themeName) ?? (resolvedTheme === "dark" ? resolveAutoDarkTheme(darkPalette) : resolveAutoLightTheme(lightPalette));
}

export function getTerminalBackground(
  themeName: string,
  resolvedTheme: "dark" | "light",
  lightPalette: LightTerminalPalette = "warm-paper",
  darkPalette: DarkTerminalPalette = "night-indigo"
): string {
  return getTerminalTheme(themeName, resolvedTheme, lightPalette, darkPalette).background!;
}

/**
 * Return a shallow clone of `theme` with a (possibly translucent) dark
 * background and a translucent selection color suitable for rendering over a
 * DOM background image. Other colors are untouched.
 *
 * Required when `allowTransparency: true` is set on the xterm `Terminal`
 * instance — see `research/xterm-transparent-background.md`.
 *
 * `darkenPct` (0–100) is the user's "background darken" slider. We use a
 * fraction of it as the alpha floor on the default cell background — this
 * stops small-glyph edge pixels (which carry subpixel alpha) from
 * alpha-blending directly into high-frequency image pixels (which makes the
 * glyphs look mushy). With a stable dark substrate beneath each cell, glyph
 * edges resolve cleanly even over busy images. The image still shows through
 * because the floor alpha < 1.
 *
 * The coefficient (0.6) is calibrated so:
 *   darken=0   → cell bg alpha=0    (image fully visible, original behavior)
 *   darken=50  → cell bg alpha=0.30 (image still visible, text legible)
 *   darken=100 → cell bg alpha=0.60 (image mostly hidden, text crisp)
 */
export function applyTransparency(theme: ITheme, darkenPct: number = 0): ITheme {
  const clamped = Math.max(0, Math.min(100, darkenPct));
  const floor = (clamped / 100) * 0.6;
  const next: ITheme = { ...theme, background: `rgba(0,0,0,${floor.toFixed(3)})` };
  const selection = theme.selectionBackground;
  // Only override opaque selection backgrounds (HEX or rgb without alpha).
  // Already-translucent rgba selections are kept as-is.
  if (typeof selection === "string" && !/^rgba\s*\(/i.test(selection)) {
    next.selectionBackground = "rgba(255,255,255,0.18)";
  }
  return next;
}
