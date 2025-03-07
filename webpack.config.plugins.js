import path from 'path'
import mainConfig from './webpack.config.js'

export default {
  ...mainConfig,

  entry: {
    Envelope: './src/plugins/envelope.ts',
    Hover: './src/plugins/hover.ts',
    Minimap: './src/plugins/minimap.ts',
    Record: './src/plugins/record.ts',
    Regions: './src/plugins/regions.ts',
    Spectrogram: './src/plugins/spectrogram.ts',
    Timeline: './src/plugins/timeline.ts',
  },

  output: {
    globalObject: `typeof WaveSurfer !== 'undefined' ? WaveSurfer : this`,
    library: '[name]',
    libraryTarget: 'umd',
    libraryExport: 'default',
    filename: (entry) => `${entry.runtime.toLowerCase()}.min.cjs`,
    path: path.resolve('./dist/plugins'),
  },
}
