import type { GenericPlugin } from './base-plugin.js'
import Decoder from './decoder.js'
import Fetcher from './fetcher.js'
import Player from './player.js'
import Renderer from './renderer.js'
import Timer from './timer.js'

export type WaveSurferOptions = {
  /** HTML element or CSS selector */
  container: HTMLElement | string
  /** The height of the waveform in pixels, or "auto" to fill the container height */
  height?: number | 'auto'
  /** The color of the waveform */
  waveColor?: string | string[] | CanvasGradient
  /** The color of the progress mask */
  progressColor?: string | string[] | CanvasGradient
  /** The color of the playpack cursor */
  cursorColor?: string
  /** The cursor width */
  cursorWidth?: number
  /** Render the waveform with bars like this: ▁ ▂ ▇ ▃ ▅ ▂ */
  barWidth?: number
  /** Spacing between bars in pixels */
  barGap?: number
  /** Rounded borders for bars */
  barRadius?: number
  /** A vertical scaling factor for the waveform */
  barHeight?: number
  /** Vertical bar alignment */
  barAlign?: 'top' | 'bottom'
  /** Minimum pixels per second of audio (i.e. zoom level) */
  minPxPerSec?: number
  /** Stretch the waveform to fill the container, true by default */
  fillParent?: boolean
  /** Audio URL */
  url?: string
  /** Pre-computed audio data */
  peaks?: Array<Float32Array | number[]>
  /** Pre-computed duration */
  duration?: number
  /** Use an existing media element instead of creating one */
  media?: HTMLMediaElement
  /** Play the audio on load */
  autoplay?: boolean
  /** Pass false to disable clicks on the waveform */
  interact?: boolean
  /** Hide the scrollbar */
  hideScrollbar?: boolean
  /** Audio rate */
  audioRate?: number
  /** Automatically scroll the container to keep the current position in viewport */
  autoScroll?: boolean
  /** If autoScroll is enabled, keep the cursor in the center of the waveform during playback */
  autoCenter?: boolean
  /** Decoding sample rate. Doesn't affect the playback. Defaults to 8000 */
  sampleRate?: number
  /** Render each audio channel as a separate waveform */
  splitChannels?: WaveSurferOptions[]
  /** Stretch the waveform to the full height */
  normalize?: boolean
  /** The list of plugins to initialize on start */
  plugins?: GenericPlugin[]
  /** Custom render function */
  renderFunction?: (peaks: Array<Float32Array | number[]>, ctx: CanvasRenderingContext2D) => void
  /** Options to pass to the fetch method */
  fetchParams?: RequestInit
}

const defaultOptions = {
  waveColor: '#999',
  progressColor: '#555',
  cursorWidth: 1,
  minPxPerSec: 0,
  fillParent: true,
  interact: true,
  autoScroll: true,
  autoCenter: true,
  sampleRate: 8000,
}

export type WaveSurferEvents = {
  /** When audio starts loading */
  load: [url: string]
  /** When the audio has been decoded */
  decode: [duration: number]
  /** When the audio is both decoded and can play */
  ready: [duration: number]
  /** When a waveform is drawn */
  redraw: []
  /** When the audio starts playing */
  play: []
  /** When the audio pauses */
  pause: []
  /** When the audio finishes playing */
  finish: []
  /** On audio position change, fires continuously during playback */
  timeupdate: [currentTime: number]
  /** An alias of timeupdate but only when the audio is playing */
  audioprocess: [currentTime: number]
  /** When the user seeks to a new position */
  seeking: [currentTime: number]
  /** When the user interacts with the waveform (i.g. clicks or drags on it) */
  interaction: [newTime: number]
  /** When the user clicks on the waveform */
  click: [relativeX: number]
  /** When the user drags the cursor */
  drag: [relativeX: number]
  /** When the waveform is scrolled (panned) */
  scroll: [visibleStartTime: number, visibleEndTime: number]
  /** When the zoom level changes */
  zoom: [minPxPerSec: number]
  /** Just before the waveform is destroyed so you can clean up your events */
  destroy: []
}

export class WaveSurfer extends Player<WaveSurferEvents> {
  public options: WaveSurferOptions & typeof defaultOptions
  private renderer: Renderer
  private timer: Timer
  private plugins: GenericPlugin[] = []
  private decodedData: AudioBuffer | null = null
  private duration: number | null = null
  protected subscriptions: Array<() => void> = []

  /** Create a new WaveSurfer instance */
  public static create(options: WaveSurferOptions) {
    return new WaveSurfer(options)
  }

  /** Create a new WaveSurfer instance */
  constructor(options: WaveSurferOptions) {
    super({
      media: options.media,
      autoplay: options.autoplay,
      playbackRate: options.audioRate,
    })

    this.options = Object.assign({}, defaultOptions, options)

    this.timer = new Timer()

    this.renderer = new Renderer(this.options)

    this.initPlayerEvents()
    this.initRendererEvents()
    this.initTimerEvents()
    this.initPlugins()

    const url = this.options.url || this.options.media?.currentSrc || this.options.media?.src
    if (url) {
      this.load(url, this.options.peaks, this.options.duration)
    }
  }

  public setOptions(options: Partial<WaveSurferOptions>) {
    this.options = Object.assign({}, this.options, options)
    this.renderer.setOptions(this.options)

    if (options.audioRate) {
      this.setPlaybackRate(options.audioRate)
    }
  }

  private initTimerEvents() {
    // The timer fires every 16ms for a smooth progress animation
    this.subscriptions.push(
      this.timer.on('tick', () => {
        const currentTime = this.getCurrentTime()
        this.renderer.renderProgress(currentTime / this.getDuration(), true)
        this.emit('timeupdate', currentTime)
        this.emit('audioprocess', currentTime)
      }),
    )
  }

  private initPlayerEvents() {
    this.subscriptions.push(
      this.onMediaEvent('timeupdate', () => {
        const currentTime = this.getCurrentTime()
        this.renderer.renderProgress(currentTime / this.getDuration(), this.isPlaying())
        this.emit('timeupdate', currentTime)
      }),

      this.onMediaEvent('play', () => {
        this.emit('play')
        this.timer.start()
      }),

      this.onMediaEvent('pause', () => {
        this.emit('pause')
        this.timer.stop()
      }),

      this.onMediaEvent('ended', () => {
        this.emit('finish')
      }),

      this.onMediaEvent('seeking', () => {
        this.emit('seeking', this.getCurrentTime())
      }),
    )
  }

  private initRendererEvents() {
    this.subscriptions.push(
      // Seek on click
      this.renderer.on('click', (relativeX) => {
        if (this.options.interact) {
          this.seekTo(relativeX)
          this.emit('interaction', this.getCurrentTime())
          this.emit('click', relativeX)
        }
      }),

      // Scroll
      this.renderer.on('scroll', (startX, endX) => {
        const duration = this.getDuration()
        this.emit('scroll', startX * duration, endX * duration)
      }),

      // Redraw
      this.renderer.on('render', () => {
        this.emit('redraw')
      }),
    )

    // Drag
    {
      let debounce: ReturnType<typeof setTimeout>
      this.subscriptions.push(
        this.renderer.on('drag', (relativeX) => {
          if (!this.options.interact) return

          // Update the visual position
          this.renderer.renderProgress(relativeX)

          // Set the audio position with a debounce
          clearTimeout(debounce)
          debounce = setTimeout(
            () => {
              this.seekTo(relativeX)
            },
            this.isPlaying() ? 0 : 200,
          )

          this.emit('interaction', relativeX * this.getDuration())
          this.emit('drag', relativeX)
        }),
      )
    }
  }

  private initPlugins() {
    if (!this.options.plugins?.length) return

    this.options.plugins.forEach((plugin) => {
      this.registerPlugin(plugin)
    })
  }

  /** Register a wavesurfer.js plugin */
  public registerPlugin<T extends GenericPlugin>(plugin: T): T {
    plugin.init(this)
    this.plugins.push(plugin)

    // Unregister plugin on destroy
    this.subscriptions.push(
      plugin.once('destroy', () => {
        this.plugins = this.plugins.filter((p) => p !== plugin)
      }),
    )

    return plugin
  }

  /** For plugins only: get the waveform wrapper div */
  public getWrapper(): HTMLElement {
    return this.renderer.getWrapper()
  }

  /** Get the current scroll position in pixels */
  public getScroll(): number {
    return this.renderer.getScroll()
  }

  /** Get all registered plugins */
  public getActivePlugins() {
    return this.plugins
  }

  /** Load an audio file by URL, with optional pre-decoded audio data */
  public async load(url: string, channelData?: WaveSurferOptions['peaks'], duration?: number) {
    if (this.isPlaying()) this.pause()

    this.decodedData = null
    this.duration = null

    this.emit('load', url)

    // Fetch the entire audio as a blob if pre-decoded data is not provided
    const blob = channelData ? undefined : await Fetcher.fetchBlob(url, this.options.fetchParams)

    // Set the mediaelement source to the URL
    this.setSrc(url, blob)

    // Wait for the audio duration
    this.duration =
      duration ||
      this.getDuration() ||
      (await new Promise((resolve) => {
        this.onceMediaEvent('loadedmetadata', () => resolve(this.getDuration()))
      })) ||
      0

    // Decode the audio data or use user-provided peaks
    if (channelData) {
      this.decodedData = Decoder.createBuffer(channelData, this.duration)
    } else if (blob) {
      const arrayBuffer = await blob.arrayBuffer()
      this.decodedData = await Decoder.decode(arrayBuffer, this.options.sampleRate)

      // Fall back to the decoded data duration if the media duration is incorrect
      if (this.duration === 0 || this.duration === Infinity) {
        this.duration = this.decodedData.duration
      }
    }

    this.emit('decode', this.duration)

    // Render the waveform
    if (this.decodedData) {
      this.renderer.render(this.decodedData)
    }

    this.emit('ready', this.duration)
  }

  /** Zoom the waveform by a given pixels-per-second factor */
  public zoom(minPxPerSec: number) {
    if (!this.decodedData) {
      throw new Error('No audio loaded')
    }
    this.renderer.zoom(minPxPerSec)
    this.emit('zoom', minPxPerSec)
  }

  /** Get the decoded audio data */
  public getDecodedData(): AudioBuffer | null {
    return this.decodedData
  }

  /** Get the duration of the audio in seconds */
  public getDuration(): number {
    if (this.duration !== null) return this.duration
    return super.getDuration()
  }

  /** Toggle if the waveform should react to clicks */
  public toggleInteraction(isInteractive: boolean) {
    this.options.interact = isInteractive
  }

  /** Seek to a percentage of audio as [0..1] (0 = beginning, 1 = end) */
  public seekTo(progress: number) {
    const time = this.getDuration() * progress
    this.setTime(time)
  }

  /** Play or pause the audio */
  public async playPause(): Promise<void> {
    return this.isPlaying() ? this.pause() : this.play()
  }

  /** Stop the audio and go to the beginning */
  public stop() {
    this.pause()
    this.setTime(0)
  }

  /** Skip N or -N seconds from the current position */
  public skip(seconds: number) {
    this.setTime(this.getCurrentTime() + seconds)
  }

  /** Empty the waveform by loading a tiny silent audio */
  public empty() {
    this.load('', [[0]], 0.001)
  }

  /** Unmount wavesurfer */
  public destroy() {
    this.emit('destroy')
    this.plugins.forEach((plugin) => plugin.destroy())
    this.subscriptions.forEach((unsubscribe) => unsubscribe())
    this.timer.destroy()
    this.renderer.destroy()
    super.destroy()
  }
}

export default WaveSurfer
