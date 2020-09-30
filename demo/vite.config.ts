import type { UserConfig } from 'vite'
import * as reactPlugin from 'vite-plugin-react'
import reactLazy from 'rollup-plugin-react-lazy'

const config: UserConfig = {
  jsx: 'react',
  minify: false,
  plugins: [reactPlugin],
  rollupInputOptions: {
    plugins: [
      reactLazy({
        resolver: 'src/useModuleProvider.ts',
        providers: {
          mobile: 'src/mobile',
          desktop: 'src/desktop',
        },
      }),
    ],
  },
}

export default config
