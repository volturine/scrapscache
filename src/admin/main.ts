import '@fontsource-variable/google-sans';
import '@fontsource-variable/google-sans/wght-italic.css';
import './admin.css';
import { mount } from 'svelte';
import Dashboard from './Dashboard.svelte';

// The dashboard has no theme setting of its own; it follows the system's.
const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

mount(Dashboard, { target: document.getElementById('dashboard')! });
