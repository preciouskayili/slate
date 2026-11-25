export const CONNECTION_COLORS: Record<string, string> = {
  zinc: "#a1a1aa",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  emerald: "#10b981",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  pink: "#ec4899",
};

export const connectionColor = (name: string) => CONNECTION_COLORS[name] ?? CONNECTION_COLORS.zinc;
