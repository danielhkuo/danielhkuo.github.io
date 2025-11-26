export interface Theme {
    id: string;
    name: string;
    colors: {
        light: { background: string; primary: string };
        dark: { background: string; primary: string };
    };
}

export const themes: Theme[] = [
    {
        id: 'nord',
        name: 'Nord',
        colors: {
            light: { background: '#ECEFF4', primary: '#5E81AC' },
            dark: { background: '#2E3440', primary: '#88C0D0' },
        },
    },
    {
        id: 'catppuccin',
        name: 'Catppuccin',
        colors: {
            light: { background: '#EFF1F5', primary: '#1E66F5' },
            dark: { background: '#1E1E2E', primary: '#89B4FA' },
        },
    },
    {
        id: 'dracula',
        name: 'Dracula',
        colors: {
            light: { background: '#F8F8F2', primary: '#9F76CF' },
            dark: { background: '#282A36', primary: '#BD93F9' },
        },
    },
    {
        id: 'kanagawa',
        name: 'Kanagawa',
        colors: {
            light: { background: '#F2F0E4', primary: '#4D699B' },
            dark: { background: '#1F1F28', primary: '#7E9CD8' },
        },
    },
];

export function initTheme() {
    if (typeof window === 'undefined') return;

    const theme = localStorage.getItem('theme-id') || 'nord';
    const mode = localStorage.getItem('mode') || 'system';

    // Set the theme attribute
    document.documentElement.setAttribute('data-theme', theme);

    // Handle dark/light mode
    const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-carbon-theme', 'g100');
    } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-carbon-theme', 'white');
    }
}
