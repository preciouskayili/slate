interface SlateBridge {
  electron?: boolean;
  token?: string;
  apiBase?: string;
}

export const bridge: SlateBridge = (window as unknown as { slate?: SlateBridge }).slate ?? {};
export const isElectron = Boolean(bridge.electron);
