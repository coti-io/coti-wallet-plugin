export const shortHash = (value: string | undefined | null) =>
  value && value.length > 12 ? `${value.slice(0, 10)}…` : value ?? 'n/a';
