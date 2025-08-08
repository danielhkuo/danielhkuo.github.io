export interface ThemeVariant {
  '--background': string;
  '--text': string;
  '--text-secondary': string;
  '--card-bg': string;
  '--border': string;
  '--secondary': string;
  '--accent': string;
  '--primary': string;
}

export interface CarbonThemeMapping {
  carbonTheme: "white" | "g10" | "g80" | "g90" | "g100";
  customOverrides: Record<string, string>;
}

export interface CarbonThemeVariant extends ThemeVariant {
  carbonMapping: CarbonThemeMapping;
}

export interface Theme {
  id: string;
  name: string;
  variants: {
    light: CarbonThemeVariant;
    dark: CarbonThemeVariant;
  };
}

export const themes: Theme[] = [
  {
    id: 'nord',
    name: 'Nord',
    variants: {
      light: {
        '--background': '#ECEFF4', // nord6
        '--text': '#2E3440',       // nord0
        '--text-secondary': '#4C566A', // nord3
        '--card-bg': '#E5E9F0',    // nord5
        '--border': '#D8DEE9',     // nord4
        '--primary': '#5E81AC',    // nord10
        '--secondary': '#81A1C1',  // nord9
        '--accent': '#88C0D0',     // nord8
        carbonMapping: {
          carbonTheme: "white",
          customOverrides: {
            '--cds-background': '#ECEFF4',
            '--cds-layer': '#E5E9F0',
            '--cds-layer-accent': '#D8DEE9',
            '--cds-field': '#E5E9F0',
            '--cds-border-subtle': '#D8DEE9',
            '--cds-border-strong': '#4C566A',
            '--cds-text-primary': '#2E3440',
            '--cds-text-secondary': '#4C566A',
            '--cds-text-placeholder': '#4C566A',
            '--cds-text-helper': '#4C566A',
            '--cds-text-error': '#BF616A',
            '--cds-link-primary': '#5E81AC',
            '--cds-link-secondary': '#81A1C1',
            '--cds-icon-primary': '#2E3440',
            '--cds-icon-secondary': '#4C566A',
            '--cds-support-error': '#BF616A',
            '--cds-support-success': '#A3BE8C',
            '--cds-support-warning': '#EBCB8B',
            '--cds-support-info': '#88C0D0',
            '--cds-interactive': '#5E81AC',
            '--cds-hover-primary': '#81A1C1',
            '--cds-hover-secondary': '#88C0D0',
            '--cds-active-primary': '#5E81AC',
            '--cds-active-secondary': '#81A1C1',
            '--cds-selected': '#5E81AC',
            '--cds-selected-light': '#88C0D0',
            '--cds-highlight': '#88C0D0',
            '--cds-overlay': 'rgba(46, 52, 64, 0.5)',
            '--cds-toggle-off': '#4C566A',
            '--cds-button-separator': '#D8DEE9',
            '--cds-skeleton': '#D8DEE9'
          }
        }
      },
      dark: {
        '--background': '#2E3440', // nord0
        '--text': '#ECEFF4',       // nord6
        '--text-secondary': '#D8DEE9', // nord4
        '--card-bg': '#3B4252',    // nord1
        '--border': '#4C566A',     // nord3
        '--primary': '#88C0D0',    // nord8
        '--secondary': '#81A1C1',  // nord9
        '--accent': '#8FBCBB',     // nord7
        carbonMapping: {
          carbonTheme: "g100",
          customOverrides: {
            '--cds-background': '#2E3440',
            '--cds-layer': '#3B4252',
            '--cds-layer-accent': '#434C5E',
            '--cds-field': '#3B4252',
            '--cds-border-subtle': '#4C566A',
            '--cds-border-strong': '#D8DEE9',
            '--cds-text-primary': '#ECEFF4',
            '--cds-text-secondary': '#D8DEE9',
            '--cds-text-placeholder': '#D8DEE9',
            '--cds-text-helper': '#D8DEE9',
            '--cds-text-error': '#BF616A',
            '--cds-link-primary': '#88C0D0',
            '--cds-link-secondary': '#81A1C1',
            '--cds-icon-primary': '#ECEFF4',
            '--cds-icon-secondary': '#D8DEE9',
            '--cds-support-error': '#BF616A',
            '--cds-support-success': '#A3BE8C',
            '--cds-support-warning': '#EBCB8B',
            '--cds-support-info': '#88C0D0',
            '--cds-interactive': '#88C0D0',
            '--cds-hover-primary': '#81A1C1',
            '--cds-hover-secondary': '#8FBCBB',
            '--cds-active-primary': '#88C0D0',
            '--cds-active-secondary': '#81A1C1',
            '--cds-selected': '#88C0D0',
            '--cds-selected-light': '#8FBCBB',
            '--cds-highlight': '#8FBCBB',
            '--cds-overlay': 'rgba(46, 52, 64, 0.7)',
            '--cds-toggle-off': '#4C566A',
            '--cds-button-separator': '#4C566A',
            '--cds-skeleton': '#4C566A'
          }
        }
      },
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    variants: {
      light: { // Latte
        '--background': '#EFF1F5', // base
        '--text': '#4C4F69',       // text
        '--text-secondary': '#6C6F85', // subtext0
        '--card-bg': '#E6E9EF',    // mantle
        '--border': '#DCE0E8',     // surface2
        '--primary': '#1E66F5',    // blue
        '--secondary': '#EA76CB',  // pink
        '--accent': '#179299',     // teal
        carbonMapping: {
          carbonTheme: "white",
          customOverrides: {
            '--cds-background': '#EFF1F5',
            '--cds-layer': '#E6E9EF',
            '--cds-layer-accent': '#DCE0E8',
            '--cds-field': '#E6E9EF',
            '--cds-border-subtle': '#DCE0E8',
            '--cds-border-strong': '#6C6F85',
            '--cds-text-primary': '#4C4F69',
            '--cds-text-secondary': '#6C6F85',
            '--cds-text-placeholder': '#6C6F85',
            '--cds-text-helper': '#6C6F85',
            '--cds-text-error': '#D20F39',
            '--cds-link-primary': '#1E66F5',
            '--cds-link-secondary': '#EA76CB',
            '--cds-icon-primary': '#4C4F69',
            '--cds-icon-secondary': '#6C6F85',
            '--cds-support-error': '#D20F39',
            '--cds-support-success': '#40A02B',
            '--cds-support-warning': '#DF8E1D',
            '--cds-support-info': '#179299',
            '--cds-interactive': '#1E66F5',
            '--cds-hover-primary': '#EA76CB',
            '--cds-hover-secondary': '#179299',
            '--cds-active-primary': '#1E66F5',
            '--cds-active-secondary': '#EA76CB',
            '--cds-selected': '#1E66F5',
            '--cds-selected-light': '#179299',
            '--cds-highlight': '#179299',
            '--cds-overlay': 'rgba(76, 79, 105, 0.5)',
            '--cds-toggle-off': '#6C6F85',
            '--cds-button-separator': '#DCE0E8',
            '--cds-skeleton': '#DCE0E8'
          }
        }
      },
      dark: { // Mocha
        '--background': '#1E1E2E', // base
        '--text': '#CDD6F4',       // text
        '--text-secondary': '#A6ADC8', // subtext1
        '--card-bg': '#181825',    // mantle
        '--border': '#313244',     // surface0
        '--primary': '#89B4FA',    // blue
        '--secondary': '#F5C2E7',  // pink
        '--accent': '#94E2D5',     // teal
        carbonMapping: {
          carbonTheme: "g100",
          customOverrides: {
            '--cds-background': '#1E1E2E',
            '--cds-layer': '#181825',
            '--cds-layer-accent': '#313244',
            '--cds-field': '#181825',
            '--cds-border-subtle': '#313244',
            '--cds-border-strong': '#A6ADC8',
            '--cds-text-primary': '#CDD6F4',
            '--cds-text-secondary': '#A6ADC8',
            '--cds-text-placeholder': '#A6ADC8',
            '--cds-text-helper': '#A6ADC8',
            '--cds-text-error': '#F38BA8',
            '--cds-link-primary': '#89B4FA',
            '--cds-link-secondary': '#F5C2E7',
            '--cds-icon-primary': '#CDD6F4',
            '--cds-icon-secondary': '#A6ADC8',
            '--cds-support-error': '#F38BA8',
            '--cds-support-success': '#A6E3A1',
            '--cds-support-warning': '#F9E2AF',
            '--cds-support-info': '#94E2D5',
            '--cds-interactive': '#89B4FA',
            '--cds-hover-primary': '#F5C2E7',
            '--cds-hover-secondary': '#94E2D5',
            '--cds-active-primary': '#89B4FA',
            '--cds-active-secondary': '#F5C2E7',
            '--cds-selected': '#89B4FA',
            '--cds-selected-light': '#94E2D5',
            '--cds-highlight': '#94E2D5',
            '--cds-overlay': 'rgba(30, 30, 46, 0.7)',
            '--cds-toggle-off': '#313244',
            '--cds-button-separator': '#313244',
            '--cds-skeleton': '#313244'
          }
        }
      },
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    variants: {
      light: { // Derived light theme
        '--background': '#F8F8F2',
        '--text': '#282A36',
        '--text-secondary': '#6272A4',
        '--card-bg': '#F1F1F0',
        '--border': '#E0E0DE',
        '--primary': '#9F76CF', // Darker purple for contrast
        '--secondary': '#FF5555', // red
        '--accent': '#50FA7B', // green
        carbonMapping: {
          carbonTheme: "white",
          customOverrides: {
            '--cds-background': '#F8F8F2',
            '--cds-layer': '#F1F1F0',
            '--cds-layer-accent': '#E0E0DE',
            '--cds-field': '#F1F1F0',
            '--cds-border-subtle': '#E0E0DE',
            '--cds-border-strong': '#6272A4',
            '--cds-text-primary': '#282A36',
            '--cds-text-secondary': '#6272A4',
            '--cds-text-placeholder': '#6272A4',
            '--cds-text-helper': '#6272A4',
            '--cds-text-error': '#FF5555',
            '--cds-link-primary': '#9F76CF',
            '--cds-link-secondary': '#FF5555',
            '--cds-icon-primary': '#282A36',
            '--cds-icon-secondary': '#6272A4',
            '--cds-support-error': '#FF5555',
            '--cds-support-success': '#50FA7B',
            '--cds-support-warning': '#F1FA8C',
            '--cds-support-info': '#8BE9FD',
            '--cds-interactive': '#9F76CF',
            '--cds-hover-primary': '#FF5555',
            '--cds-hover-secondary': '#50FA7B',
            '--cds-active-primary': '#9F76CF',
            '--cds-active-secondary': '#FF5555',
            '--cds-selected': '#9F76CF',
            '--cds-selected-light': '#50FA7B',
            '--cds-highlight': '#50FA7B',
            '--cds-overlay': 'rgba(40, 42, 54, 0.5)',
            '--cds-toggle-off': '#6272A4',
            '--cds-button-separator': '#E0E0DE',
            '--cds-skeleton': '#E0E0DE'
          }
        }
      },
      dark: {
        '--background': '#282A36',
        '--text': '#F8F8F2',
        '--text-secondary': '#BD93F9',
        '--card-bg': '#44475A',
        '--border': '#6272A4',
        '--primary': '#BD93F9', // purple
        '--secondary': '#FF5555', // red
        '--accent': '#50FA7B', // green
        carbonMapping: {
          carbonTheme: "g100",
          customOverrides: {
            '--cds-background': '#282A36',
            '--cds-layer': '#44475A',
            '--cds-layer-accent': '#6272A4',
            '--cds-field': '#44475A',
            '--cds-border-subtle': '#6272A4',
            '--cds-border-strong': '#BD93F9',
            '--cds-text-primary': '#F8F8F2',
            '--cds-text-secondary': '#BD93F9',
            '--cds-text-placeholder': '#BD93F9',
            '--cds-text-helper': '#BD93F9',
            '--cds-text-error': '#FF5555',
            '--cds-link-primary': '#BD93F9',
            '--cds-link-secondary': '#FF5555',
            '--cds-icon-primary': '#F8F8F2',
            '--cds-icon-secondary': '#BD93F9',
            '--cds-support-error': '#FF5555',
            '--cds-support-success': '#50FA7B',
            '--cds-support-warning': '#F1FA8C',
            '--cds-support-info': '#8BE9FD',
            '--cds-interactive': '#BD93F9',
            '--cds-hover-primary': '#FF5555',
            '--cds-hover-secondary': '#50FA7B',
            '--cds-active-primary': '#BD93F9',
            '--cds-active-secondary': '#FF5555',
            '--cds-selected': '#BD93F9',
            '--cds-selected-light': '#50FA7B',
            '--cds-highlight': '#50FA7B',
            '--cds-overlay': 'rgba(40, 42, 54, 0.7)',
            '--cds-toggle-off': '#6272A4',
            '--cds-button-separator': '#6272A4',
            '--cds-skeleton': '#6272A4'
          }
        }
      },
    },
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa',
    variants: {
      light: { // Lotus
        '--background': '#F2F0E4', // lotusInk0
        '--text': '#363646',       // lotusInk1
        '--text-secondary': '#54546D', // lotusInk2
        '--card-bg': '#E8E6D9',    // lotusGray1
        '--border': '#D6D2C4',     // lotusGray2
        '--primary': '#4D699B',    // waveBlue1
        '--secondary': '#A38075',  // roninYellow
        '--accent': '#6F894E',     // springGreen
        carbonMapping: {
          carbonTheme: "white",
          customOverrides: {
            '--cds-background': '#F2F0E4',
            '--cds-layer': '#E8E6D9',
            '--cds-layer-accent': '#D6D2C4',
            '--cds-field': '#E8E6D9',
            '--cds-border-subtle': '#D6D2C4',
            '--cds-border-strong': '#54546D',
            '--cds-text-primary': '#363646',
            '--cds-text-secondary': '#54546D',
            '--cds-text-placeholder': '#54546D',
            '--cds-text-helper': '#54546D',
            '--cds-text-error': '#C34043',
            '--cds-link-primary': '#4D699B',
            '--cds-link-secondary': '#A38075',
            '--cds-icon-primary': '#363646',
            '--cds-icon-secondary': '#54546D',
            '--cds-support-error': '#C34043',
            '--cds-support-success': '#6F894E',
            '--cds-support-warning': '#DCA561',
            '--cds-support-info': '#7AA89F',
            '--cds-interactive': '#4D699B',
            '--cds-hover-primary': '#A38075',
            '--cds-hover-secondary': '#6F894E',
            '--cds-active-primary': '#4D699B',
            '--cds-active-secondary': '#A38075',
            '--cds-selected': '#4D699B',
            '--cds-selected-light': '#6F894E',
            '--cds-highlight': '#6F894E',
            '--cds-overlay': 'rgba(54, 54, 70, 0.5)',
            '--cds-toggle-off': '#54546D',
            '--cds-button-separator': '#D6D2C4',
            '--cds-skeleton': '#D6D2C4'
          }
        }
      },
      dark: { // Wave
        '--background': '#1F1F28', // sumiInk0
        '--text': '#DCD7BA',       // fujiWhite
        '--text-secondary': '#9593A0', // sumiInk6
        '--card-bg': '#16161D',    // sumiInk1
        '--border': '#363646',     // sumiInk3
        '--primary': '#7E9CD8',    // carpBlue
        '--secondary': '#9A7ECC',  // autumnViolet
        '--accent': '#7AA89F',     // springGreen
        carbonMapping: {
          carbonTheme: "g100",
          customOverrides: {
            '--cds-background': '#1F1F28',
            '--cds-layer': '#16161D',
            '--cds-layer-accent': '#363646',
            '--cds-field': '#16161D',
            '--cds-border-subtle': '#363646',
            '--cds-border-strong': '#9593A0',
            '--cds-text-primary': '#DCD7BA',
            '--cds-text-secondary': '#9593A0',
            '--cds-text-placeholder': '#9593A0',
            '--cds-text-helper': '#9593A0',
            '--cds-text-error': '#E82424',
            '--cds-link-primary': '#7E9CD8',
            '--cds-link-secondary': '#9A7ECC',
            '--cds-icon-primary': '#DCD7BA',
            '--cds-icon-secondary': '#9593A0',
            '--cds-support-error': '#E82424',
            '--cds-support-success': '#7AA89F',
            '--cds-support-warning': '#DCA561',
            '--cds-support-info': '#7FB4CA',
            '--cds-interactive': '#7E9CD8',
            '--cds-hover-primary': '#9A7ECC',
            '--cds-hover-secondary': '#7AA89F',
            '--cds-active-primary': '#7E9CD8',
            '--cds-active-secondary': '#9A7ECC',
            '--cds-selected': '#7E9CD8',
            '--cds-selected-light': '#7AA89F',
            '--cds-highlight': '#7AA89F',
            '--cds-overlay': 'rgba(31, 31, 40, 0.7)',
            '--cds-toggle-off': '#363646',
            '--cds-button-separator': '#363646',
            '--cds-skeleton': '#363646'
          }
        }
      },
    },
  },
];

/**
 * Applies Carbon design tokens based on the current theme variant
 * @param variant - The theme variant containing Carbon mappings
 */
export function applyCarbonTokens(variant: CarbonThemeVariant): void {
  if (typeof document === 'undefined') return;

  const { carbonTheme, customOverrides } = variant.carbonMapping;
  const targets = [document.documentElement, document.body];
  for (const el of targets) {
    el.setAttribute('data-carbon-theme', carbonTheme);
    for (const [k, v] of Object.entries(customOverrides)) el.style.setProperty(k, v);
  }
}

/**
 * Gets the appropriate Carbon theme base for a given theme variant
 * @param variant - The theme variant to get the Carbon theme for
 * @returns The Carbon theme identifier
 */
export function getCarbonTheme(variant: CarbonThemeVariant): string {
  return variant.carbonMapping.carbonTheme;
}

/**
 * Creates a mapping of custom CSS variables to Carbon design tokens
 * @param variant - The theme variant to create mappings for
 * @returns Object containing both custom and Carbon token mappings
 */
export function createThemeTokenMapping(variant: CarbonThemeVariant): Record<string, string> {
  const customTokens: Record<string, string> = {};
  
  // Copy custom theme variables
  for (const [key, value] of Object.entries(variant)) {
    if (key !== 'carbonMapping' && typeof value === 'string') {
      customTokens[key] = value;
    }
  }

  // Merge with Carbon token overrides
  return {
    ...customTokens,
    ...variant.carbonMapping.customOverrides
  };
}

/**
 * Validates that a theme variant has proper Carbon mappings
 * @param variant - The theme variant to validate
 * @returns True if the variant has valid Carbon mappings
 */
export function validateCarbonMapping(variant: CarbonThemeVariant): boolean {
  if (!variant.carbonMapping) return false;
  
  const validCarbonThemes = ["white", "g10", "g80", "g90", "g100"];
  if (!validCarbonThemes.includes(variant.carbonMapping.carbonTheme)) return false;
  
  if (!variant.carbonMapping.customOverrides || typeof variant.carbonMapping.customOverrides !== 'object') {
    return false;
  }

  return true;
}

/**
 * Gets a theme by ID with fallback to Nord theme
 * @param themeId - The ID of the theme to retrieve
 * @returns The theme object or Nord theme as fallback
 */
export function getThemeById(themeId: string): Theme {
  return themes.find(t => t.id === themeId) || themes[0];
}

/**
 * Gets a theme variant with Carbon mappings
 * @param themeId - The ID of the theme
 * @param mode - The mode (light or dark)
 * @returns The theme variant with Carbon mappings
 */
export function getThemeVariant(themeId: string, mode: 'light' | 'dark'): CarbonThemeVariant {
  const theme = getThemeById(themeId);
  return theme.variants[mode];
}