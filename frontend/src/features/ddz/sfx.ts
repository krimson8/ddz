'use client';

/**
 * Module-level sound bus for DDZ.
 *
 * Sound used to live entirely inside useSoundEffects, which meant only things
 * that could see the whole GameState were able to make a noise. UI-level cues
 * (picking a card up, the turn timer ticking) come from components that never
 * see that state, so the playback layer lives here as a singleton and the hook
 * became just the state → cue mapper on top of it.
 *
 * Deliberately built on HTMLAudioElement rather than Web Audio: the emoji voice
 * clips are .ogg, whose decodeAudioData support is still patchy on Safari, and
 * these files already work today. Pooling gives us overlap, and playbackRate
 * with preservesPitch off gives us the pitch variation that stops repeated card
 * plays sounding machine-gunned.
 */

export type SfxKey =
  | 'cardPlay'
  | 'pass'
  | 'yourTurn'
  | 'deal'
  | 'win'
  | 'lose'
  | 'landlord'
  | 'gameStart'
  | 'surrenderPending'
  | 'bomb'
  | 'rocket'
  | 'warning'
  | 'tick'
  | 'select'
  | 'deselect'
  | 'tier1'
  | 'tier2'
  | 'tier3'
  | 'tier4'
  | 'tier5';

interface SfxDef {
  src: string;
  /** Per-sound trim, applied on top of the master volume, so levels sit together. */
  gain: number;
  /** How many elements to pool — raise it for sounds that can overlap themselves. */
  pool?: number;
}

const SOUNDS: Record<SfxKey, SfxDef> = {
  // card-play.wav is the one original file and is mastered a lot quieter than
  // the generated set, so it gets unity gain while the rest are trimmed down.
  cardPlay: { src: '/sounds/card-play.wav', gain: 1.0, pool: 4 },
  pass: { src: '/sounds/pass.wav', gain: 0.75 },
  yourTurn: { src: '/sounds/your-turn.mp3', gain: 0.9 },
  deal: { src: '/sounds/deal.wav', gain: 0.7 },
  win: { src: '/sounds/win.wav', gain: 0.85 },
  lose: { src: '/sounds/lose.wav', gain: 0.75 },
  landlord: { src: '/sounds/landlord.wav', gain: 0.8 },
  gameStart: { src: '/sounds/game-ready.mp3', gain: 0.9 },
  surrenderPending: { src: '/sounds/surrender.mp3', gain: 0.8 },
  bomb: { src: '/sounds/bomb.wav', gain: 0.95 },
  rocket: { src: '/sounds/rocket.wav', gain: 0.95 },
  warning: { src: '/sounds/warning.wav', gain: 0.7 },
  tick: { src: '/sounds/tick.wav', gain: 0.5, pool: 2 },
  select: { src: '/sounds/select.wav', gain: 0.55, pool: 6 },
  deselect: { src: '/sounds/deselect.wav', gain: 0.45, pool: 6 },
  // Hit-banner stingers. Tiers 6, 7 and comeback are long music tracks and go
  // through the music channel instead — see playMusic.
  tier1: { src: '/sounds/tier-1.wav', gain: 0.5, pool: 2 },
  tier2: { src: '/sounds/tier-2.wav', gain: 0.6, pool: 2 },
  tier3: { src: '/sounds/tier-3.wav', gain: 0.7, pool: 2 },
  tier4: { src: '/sounds/tier-4.wav', gain: 0.8, pool: 2 },
  tier5: { src: '/sounds/tier-5.wav', gain: 0.9, pool: 2 },
};

const VOLUME_KEY = 'ddz_volume';

interface PlayOpts {
  /** Playback rate; also shifts pitch, since preservesPitch is disabled. */
  rate?: number;
  /** Randomise the rate by ±amount around `rate`. */
  vary?: number;
  /** Extra gain multiplier for this one hit. */
  gain?: number;
}

class SfxBus {
  private pools = new Map<SfxKey, HTMLAudioElement[]>();
  private cursors = new Map<SfxKey, number>();
  private oneShots = new Map<string, HTMLAudioElement>();
  private loops = new Map<SfxKey, HTMLAudioElement>();
  private volume = 1;
  private loaded = false;
  private unlocked = false;

  /** Read the persisted master volume. Safe to call repeatedly. */
  init(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '1');
      this.volume = Number.isNaN(v) ? 1 : Math.max(0, Math.min(1, v));
    } catch {
      this.volume = 1;
    }
  }

  getVolume(): number {
    this.init();
    return this.volume;
  }

  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.volume = clamped;
    this.loaded = true;
    for (const [key, pool] of this.pools) {
      const duck = this.ducked && SfxBus.DUCKED.includes(key);
      for (const a of pool) a.volume = duck ? 0 : clamped * SOUNDS[key].gain;
    }
    for (const a of this.oneShots.values()) a.volume = clamped;
    if (this.music) this.music.volume = clamped;
    for (const [el, gain] of this.medias) el.volume = clamped * gain;
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }

  /**
   * iOS refuses to play audio that was not started inside a user gesture, and
   * the refusal is per-element. Priming every pooled element once on the first
   * touch is what stops the first cue of a session being swallowed.
   */
  unlock(): void {
    if (this.unlocked || typeof window === 'undefined') return;
    this.unlocked = true;
    this.ensurePools();
    for (const pool of this.pools.values()) {
      for (const a of pool) {
        const restore = a.volume;
        a.volume = 0;
        a.play()
          .then(() => {
            a.pause();
            a.currentTime = 0;
            a.volume = restore;
          })
          .catch(() => {
            a.volume = restore;
          });
      }
    }
  }

  private ensurePools(): void {
    if (this.pools.size > 0 || typeof window === 'undefined') return;
    this.init();
    for (const key of Object.keys(SOUNDS) as SfxKey[]) {
      const def = SOUNDS[key];
      const pool = Array.from({ length: def.pool ?? 3 }, () => {
        const a = new Audio(def.src);
        a.preload = 'auto';
        a.volume = this.volume * def.gain;
        // Without this the browser time-stretches instead of pitch-shifting,
        // which defeats the point of varying the rate.
        a.preservesPitch = false;
        (a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;
        return a;
      });
      this.pools.set(key, pool);
      this.cursors.set(key, 0);
    }
  }

  play(key: SfxKey, opts: PlayOpts = {}): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    this.ensurePools();
    if (this.volume === 0) return null;
    const pool = this.pools.get(key);
    if (!pool?.length) return null;

    const idx = this.cursors.get(key) ?? 0;
    this.cursors.set(key, idx + 1);
    const audio = pool[idx % pool.length];

    const base = opts.rate ?? 1;
    const vary = opts.vary ?? 0;
    audio.playbackRate = vary ? base + (Math.random() * 2 - 1) * vary : base;
    const duck = this.ducked && SfxBus.DUCKED.includes(key);
    audio.volume = duck ? 0 : Math.min(1, this.volume * SOUNDS[key].gain * (opts.gain ?? 1));
    audio.loop = false;
    audio.currentTime = 0;
    audio.play().catch(() => {}); // autoplay block or missing file — stay silent
    return audio;
  }

  stop(audio: HTMLAudioElement | null | undefined): void {
    if (!audio || audio.paused) return;
    audio.pause();
    audio.currentTime = 0;
  }

  startLoop(key: SfxKey): void {
    if (typeof window === 'undefined') return;
    this.ensurePools();
    if (this.volume === 0) return;
    const existing = this.loops.get(key);
    if (existing && !existing.paused) return;
    const pool = this.pools.get(key);
    if (!pool?.length) return;
    const audio = pool[0];
    audio.loop = true;
    audio.playbackRate = 1;
    audio.volume = this.volume * SOUNDS[key].gain;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    this.loops.set(key, audio);
  }

  stopLoop(key: SfxKey): void {
    const audio = this.loops.get(key);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.loop = false;
    }
    this.loops.delete(key);
  }

  /**
   * Play an arbitrary file by path — used for the emoji voice clips, which are
   * data-driven and so cannot be keys in SOUNDS. One cached element each,
   * because a given clip retriggering itself should cut the previous one off.
   *
   * Returns the element so a caller can wait for it to finish. Null means
   * nothing is playing — muted, or off-browser — and the caller has to fall
   * back to a timer rather than to an 'ended' event that will never arrive.
   */
  playFile(src: string): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    this.init();
    if (this.volume === 0) return null;
    let audio = this.oneShots.get(src);
    if (!audio) {
      audio = new Audio(src);
      audio.preload = 'auto';
      this.oneShots.set(src, audio);
    }
    audio.volume = this.volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return audio;
  }

  // ── Music channel ─────────────────────────────────────────────────────────
  // One slot, for the long tier tracks (comeback / tier 6 / tier 7). These are
  // 30–46 second pieces, not stingers: once one starts it plays to the end and
  // keeps going straight through the end of the round. Only something that
  // outranks it can cut it off, which is what makes "a bigger bomb restarts it"
  // and "a rocket answers a bomb" fall out of one comparison.
  private music: HTMLMediaElement | null = null;
  private musicWeight = -1;
  /** True when the slot holds someone else's element rather than one of ours. */
  private musicAdopted = false;

  /**
   * Start a track. Replaces whatever is running when the incoming weight is at
   * least as high, so the same level landing again restarts it; a weaker level
   * is ignored and the running track plays out. Returns true if it took the
   * channel.
   */
  playMusic(src: string, weight: number, fadeMs = 0): boolean {
    if (typeof window === 'undefined') return false;
    this.init();
    if (this.volume === 0) return false;
    if (this.music && !this.music.ended && !this.music.paused && weight < this.musicWeight) {
      return false;                      // something bigger is playing — let it finish
    }
    this.stopMusic();
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = this.volume;
    this.music = audio;
    if (fadeMs > 0) this.fadeIn(audio, fadeMs);
    this.musicWeight = weight;
    audio.addEventListener('ended', () => {
      if (this.music === audio) {
        this.music = null;
        this.musicWeight = -1;
        this.setDuck(false);
      }
    }, { once: true });
    audio.play().catch(() => {});
    this.setDuck(true);
    return true;
  }

  /**
   * Ride a track up from silence over `ms`.
   *
   * Driven off the track's own currentTime rather than a wall clock, so a late
   * start — autoplay policy holding the first play() back, or a slow fetch —
   * fades from where the audio actually is instead of arriving already part way
   * up. The curve is squared because loudness follows roughly the square root
   * of amplitude: a straight line on `volume` reads as "already there" within a
   * second and then flat.
   *
   * The interval stops itself as soon as the channel moves on, so a fade cut
   * off mid-swell leaves nothing running.
   */
  private fadeIn(audio: HTMLAudioElement, ms: number): void {
    audio.volume = 0;
    const step = () => {
      if (this.music !== audio || audio.ended) { clearInterval(id); return; }
      const t = Math.min(1, (audio.currentTime * 1000) / ms);
      audio.volume = this.volume * t * t;
      if (t >= 1) clearInterval(id);
    };
    const id = setInterval(step, 40);
    step();
  }

  stopMusic(): void {
    if (this.music) {
      this.music.pause();
      // Rewind only what this bus opened. An adopted element is a video plate
      // that is ON SCREEN, and currentTime = 0 repaints its first frame — for
      // 閻魔刀 that is the flat green screen, unkeyed by then, painted over the
      // whole game. Its owner is already unmounting it; leave it on its last
      // frame for the frame or two that takes.
      if (!this.musicAdopted) this.music.currentTime = 0;
    }
    this.music = null;
    this.musicWeight = -1;
    this.musicAdopted = false;
    this.setDuck(false);
  }

  /**
   * Cues silenced while a tier track is playing.
   *
   * your-turn.mp3 is a 30-second alert, so a bomb landing on your turn used to
   * put two long pieces of audio on top of each other. Ducking rather than
   * skipping means a cue already in flight goes quiet immediately and comes
   * back at full volume the moment the track ends.
   */
  private static readonly DUCKED: SfxKey[] = ['yourTurn'];
  private ducked = false;

  private setDuck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    for (const key of SfxBus.DUCKED) {
      const pool = this.pools.get(key);
      if (!pool) continue;
      for (const a of pool) a.volume = on ? 0 : this.volume * SOUNDS[key].gain;
    }
  }

  /**
   * Duck the cues by hand, for audio that is not a track.
   *
   * A cold open is a one-shot cue, so it never takes the music channel and
   * nothing ducks for it — but it is a spoken line, and a 30-second turn alert
   * runs straight over the top of it. The track that follows the cue holds the
   * duck on, and stopMusic lifts it at the end of the round.
   */
  duckCues(on: boolean): void {
    this.setDuck(on);
  }

  /** True while a tier track is holding the channel. */
  isDucked(): boolean {
    return this.ducked;
  }

  isMusicPlaying(): boolean {
    return !!this.music && !this.music.paused && !this.music.ended;
  }

  /** Seconds remaining on the current track, 0 when nothing is playing. */
  musicRemaining(): number {
    const m = this.music;
    if (!m || m.paused || m.ended || !Number.isFinite(m.duration)) return 0;
    return Math.max(0, m.duration - m.currentTime);
  }

  // ── Video plates ──────────────────────────────────────────────────────────
  // A finale's clip carries its own audio, and that audio never came through
  // this bus — so the settings slider moved every sound in the game except the
  // loudest one in it. An attached element follows the master volume like any
  // pooled cue, for as long as it is mounted.
  private medias = new Map<HTMLMediaElement, number>();

  /**
   * Put a media element under the master volume. Returns the detach function,
   * which a component's cleanup must call — a <video> that has been unmounted
   * is not garbage until this map lets go of it.
   */
  attachMedia(el: HTMLMediaElement, gain = 1): () => void {
    this.init();
    this.medias.set(el, gain);
    el.volume = this.volume * gain;
    return () => { this.medias.delete(el); };
  }

  /**
   * Hand the music slot to a clip that carries its own track.
   *
   * The long tier pieces are files this bus opens itself, but 閻魔刀's music is
   * inside its video, and the end of the round asks the same three questions
   * about it: is something still playing, how much is left, and stop it. Giving
   * the element the slot answers all three without a second channel — the end
   * screen's dismiss already calls stopMusic(), which now reaches a video too.
   */
  adoptMedia(el: HTMLMediaElement, weight: number): void {
    this.init();
    this.stopMusic();
    this.music = el;
    this.musicWeight = weight;
    this.musicAdopted = true;
    el.volume = this.volume;
    el.addEventListener('ended', () => {
      if (this.music === el) {
        this.music = null;
        this.musicWeight = -1;
        this.setDuck(false);
      }
    }, { once: true });
    this.setDuck(true);
  }

  /** Warm the cache for files that are not SOUNDS keys (emoji clips). */
  preloadFiles(srcs: string[]): void {
    if (typeof window === 'undefined') return;
    for (const src of srcs) {
      if (this.oneShots.has(src)) continue;
      const a = new Audio(src);
      a.preload = 'auto';
      this.oneShots.set(src, a);
    }
  }
}

export const sfx = new SfxBus();
