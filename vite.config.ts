import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import wesl from 'wesl-plugin/vite';
import { staticBuildExtension } from 'wesl-plugin';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wesl({ extensions: [staticBuildExtension] }),
  ],
});
