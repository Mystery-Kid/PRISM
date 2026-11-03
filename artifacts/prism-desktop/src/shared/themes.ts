export const STARRY_ID = "theme.starry";
export const ORIGINAL_ID = "theme.original";
export const DAY_ID = "theme.day";
export const BUILT_IN_THEME_IDS: readonly string[] = [ORIGINAL_ID, DAY_ID];

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
  description: "A midnight-blue theme with the supplied moon, sparse stars, and restrained teal accents.",
  priceType: "free",
  previewAsset: "starry",
  themeId: STARRY_ID,
  availability: "local",
}];

// This local package manifest is deliberately independent of song/project data.
export const starryPackage = { id: STARRY_ID, version: 1, compatibility: 1 };
