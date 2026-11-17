export const TEAMS = ['events', 'partnerships', 'projects', 'community', 'finance'] as const;
export type Team = (typeof TEAMS)[number];

export const STATUSES = ['open', 'in_progress', 'blocked', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  open: '⚪ Open',
  in_progress: '🔵 In progress',
  blocked: '⛔ Blocked',
  done: '✅ Done',
};

export const COLORS = {
  red: 0xe74c3c,
  orange: 0xe67e22,
  yellow: 0xf1c40f,
  green: 0x2ecc71,
  teal: 0x1abc9c,
  blue: 0x3498db,
  purple: 0x9b59b6,
  pink: 0xe91e63,
  grey: 0x95a5a6,
} as const;
export type Color = keyof typeof COLORS;
export const COLOR_NAMES = Object.keys(COLORS) as Color[];
export const DEFAULT_COLOR: Color = 'blue';

export const isTeam = (v: string): v is Team => (TEAMS as readonly string[]).includes(v);
export const isStatus = (v: string): v is Status => (STATUSES as readonly string[]).includes(v);
export const isColor = (v: string): v is Color => v in COLORS;

export const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
