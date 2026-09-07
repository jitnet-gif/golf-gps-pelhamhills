// Tailwind CSS Configuration for Golf GPS Frontend
// Version: Tailwind CSS 3.4 (with traditional config file, not v4)
// Reference: https://tailwindcss.com/docs/configuration

export default {
  // Dark mode using class strategy (data-theme attribute or .dark class)
  darkMode: ['class'],

  // Content paths for detecting class names
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],

  // Theme customization
  theme: {
    extend: {
      // Custom color palette
      colors: {
        // Using CSS custom properties for dynamic theming
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',

        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
      },

      // Custom border radius
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.1875rem',
      },

      // Custom spacing if needed
      spacing: {
        // Add custom spacing here if necessary
      },

      // Animation utilities for UI feedback
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-in-out',
        'slide-up': 'slide-up 0.3s ease-out',
      },
    },
  },

  // Plugins for additional utilities
  plugins: [],
};
