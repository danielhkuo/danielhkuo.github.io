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

export interface Theme {
  id: string;
  name: string;
  variants: {
    light: ThemeVariant;
    dark: ThemeVariant;
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
      },
    },
  },
];
