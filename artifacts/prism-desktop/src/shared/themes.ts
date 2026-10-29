export const STARRY_ID = "theme.starry";
export const ORIGINAL_ID = "theme.original";

export type ThemeState = {
  claimedThemeIds: string[];
  selectedThemeId: string;
  effectiveThemeId: string;
  availableThemeIds: string[];
  warning: string | null;
};

export type ThemeProduct = {
  id: string;
  name: string;
  category: "Themes";
  description: string;
  priceType: "free";
  previewAsset: string;
  themeId: string;
  availability: "local";
};

export const themeProducts: readonly ThemeProduct[] = [{
  id: STARRY_ID,
  name: "Starry",
  category: "Themes",
  description: "A calm midnight-blue theme with soft blue accents and a subtle starfield.",
  priceType: "free",
  previewAsset: "starry",
  themeId: STARRY_ID,
  availability: "local",
}];

// This local package manifest is deliberately independent of song/project data.
export const starryPackage = { id: STARRY_ID, version: 1, compatibility: 1 };
